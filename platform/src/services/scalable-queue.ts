// ---------------------------------------------------------------------------
// Scalable Queue — priority-based, persistent work queue with concurrency
// control, backpressure, and dead-letter handling for production scaling.
// ---------------------------------------------------------------------------
// Replaces the simple in-memory TaskQueue with a persistent, fault-tolerant
// queue that:
//  - Persists jobs to SQLite (survives restarts)
//  - Supports priority ordering
//  - Configurable concurrency limits (global + per-workspace)
//  - Dead-letter queue for permanently failed jobs
//  - Automatic retries with exponential backoff
//  - Backpressure (rejects when queue too deep)
//  - Worker pool management
// ---------------------------------------------------------------------------

import { ulid } from "ulid"
import { OpenCodeClient } from "./opencode-client"
import { TaskStateTracker, type TrackedTask, type TaskState } from "./task-state-tracker"
import type { AuditLogger } from "./audit-logger"
import type { BudgetManager } from "./budget-manager"

export interface ScalableQueueOptions {
  client: OpenCodeClient
  tracker: TaskStateTracker
  audit?: AuditLogger
  budget?: BudgetManager
  concurrency?: number              // max global concurrent tasks
  maxPerWorkspace?: number           // max concurrent per-workspace
  maxQueueDepth?: number             // reject if queue exceeds this
  retryBackoffMs?: number            // initial retry backoff
  retryMaxBackoffMs?: number         // max retry backoff
  pollIntervalMs?: number            // how often to poll for work
}

interface Worker {
  id: string
  taskID: string
  startedAt: number
  workspaceID?: string
}

export class ScalableQueue {
  private client: OpenCodeClient
  private tracker: TaskStateTracker
  private audit?: AuditLogger
  private budget?: BudgetManager
  private workers = new Map<string, Worker>()
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private running = false

  private readonly concurrency: number
  private readonly maxPerWorkspace: number
  private readonly maxQueueDepth: number
  private readonly retryBackoffMs: number
  private readonly retryMaxBackoffMs: number
  private readonly pollIntervalMs: number

  constructor(opts: ScalableQueueOptions) {
    this.client = opts.client
    this.tracker = opts.tracker
    this.audit = opts.audit
    this.budget = opts.budget
    this.concurrency = opts.concurrency ?? 4
    this.maxPerWorkspace = opts.maxPerWorkspace ?? 2
    this.maxQueueDepth = opts.maxQueueDepth ?? 500
    this.retryBackoffMs = opts.retryBackoffMs ?? 2000
    this.retryMaxBackoffMs = opts.retryMaxBackoffMs ?? 60000
    this.pollIntervalMs = opts.pollIntervalMs ?? 1000
  }

  /** Start the queue processor */
  start() {
    if (this.running) return
    this.running = true

    // Recover any "running" tasks from a previous crash → re-queue them
    const stale = this.tracker.list({ state: "running" })
    for (const task of stale) {
      try {
        this.tracker.transition(task.id, "queued")
        console.log(`[queue] Recovered stale task ${task.id} → queued`)
      } catch {}
    }

    this.pollTimer = setInterval(() => this.tick(), this.pollIntervalMs)
    console.log(`[queue] Started — concurrency=${this.concurrency}, poll=${this.pollIntervalMs}ms`)
  }

  /** Stop the queue processor (graceful) */
  async stop() {
    this.running = false
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    // Wait for active workers to finish (with timeout)
    const deadline = Date.now() + 30000
    while (this.workers.size > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 500))
    }
    console.log(`[queue] Stopped — ${this.workers.size} workers remaining`)
  }

  /** Enqueue a new task (with backpressure check) */
  enqueue(opts: {
    userID?: string
    workspaceID?: string
    title: string
    prompt: string
    agentID?: string
    modelID?: string
    priority?: number
    maxRetries?: number
    type?: TrackedTask["type"]
    metadata?: Record<string, unknown>
  }): TrackedTask {
    // Backpressure: reject if too many queued
    const stats = this.tracker.stats({ workspaceID: opts.workspaceID })
    if (stats.queued >= this.maxQueueDepth) {
      throw new Error(`Queue is full (${stats.queued}/${this.maxQueueDepth}). Try again later.`)
    }

    // Budget check
    if (this.budget) {
      const check = this.budget.check(opts.userID ?? "default")
      if (!check.allowed) {
        throw new Error(`Budget exceeded: ${check.reason}`)
      }
    }

    const task = this.tracker.create({
      userID: opts.userID ?? "default",
      workspaceID: opts.workspaceID,
      type: opts.type ?? "prompt",
      title: opts.title,
      prompt: opts.prompt,
      agentID: opts.agentID,
      modelID: opts.modelID,
      priority: opts.priority ?? 5,
      maxRetries: opts.maxRetries,
      metadata: opts.metadata,
    })

    this.audit?.log({
      action: "task.enqueue",
      userID: opts.userID ?? "default",
      taskID: task.id,
      workspaceID: opts.workspaceID,
      metadata: { title: opts.title, priority: opts.priority },
      success: true,
    })

    // Immediately try to schedule
    this.tick()
    return task
  }

  /** Abort a task */
  async abort(taskID: string): Promise<boolean> {
    const task = this.tracker.get(taskID)
    if (!task) return false

    if (task.state === "queued") {
      this.tracker.transition(taskID, "aborted")
      return true
    }
    if (task.state === "running" && task.sessionID) {
      try { await this.client.abortSession(task.sessionID) } catch {}
      this.tracker.transition(taskID, "aborted")
      this.workers.delete(taskID)
      return true
    }
    return false
  }

  /** Get queue health metrics */
  metrics(): {
    running: number
    queued: number
    workers: Array<{ id: string; taskID: string; uptime: number; workspaceID?: string }>
    concurrencyLimit: number
    queueDepthLimit: number
    stats: Record<TaskState | "total", number>
  } {
    return {
      running: this.workers.size,
      queued: this.tracker.stats().queued,
      workers: [...this.workers.values()].map(w => ({
        id: w.id,
        taskID: w.taskID,
        uptime: Date.now() - w.startedAt,
        workspaceID: w.workspaceID,
      })),
      concurrencyLimit: this.concurrency,
      queueDepthLimit: this.maxQueueDepth,
      stats: this.tracker.stats(),
    }
  }

  // ── Internal scheduler ─────────────────────────────────────────

  private tick() {
    if (!this.running) return
    if (this.workers.size >= this.concurrency) return

    // Find next task by priority
    const slotsAvailable = this.concurrency - this.workers.size
    for (let i = 0; i < slotsAvailable; i++) {
      const task = this.tracker.nextQueued()
      if (!task) break

      // Per-workspace concurrency check
      if (task.workspaceID) {
        const wsWorkers = [...this.workers.values()].filter(w => w.workspaceID === task.workspaceID)
        if (wsWorkers.length >= this.maxPerWorkspace) continue
      }

      this.startWorker(task)
    }
  }

  private async startWorker(task: TrackedTask) {
    const workerID = ulid()
    const worker: Worker = {
      id: workerID,
      taskID: task.id,
      startedAt: Date.now(),
      workspaceID: task.workspaceID,
    }
    this.workers.set(task.id, worker)

    try {
      this.tracker.transition(task.id, "running")
      this.tracker.updateProgress(task.id, 10, "Creating session...")

      // Create session
      const session = await this.client.createSession({ agentID: task.agentID })
      this.tracker.setSession(task.id, session.id)
      this.tracker.updateProgress(task.id, 30, "Sending prompt to vLLM...")

      // Send prompt
      const response = await this.client.prompt(session.id, {
        content: task.prompt,
        agentID: task.agentID,
        modelID: task.modelID,
      })

      // Extract result
      let result = ""
      const parts = response.parts ?? (response as any).message?.parts ?? []
      for (const part of parts) {
        if (part.type === "text" && part.text) result += part.text
      }

      this.tracker.transition(task.id, "completed", { result, progress: 100 })

      // Record budget usage (estimate tokens from text length)
      if (this.budget) {
        this.budget.recordUsage({
          userID: task.userID,
          tokensInput: Math.ceil(task.prompt.length / 4),
          tokensOutput: Math.ceil(result.length / 4),
          sessionID: session.id,
          taskID: task.id,
        })
      }

      this.audit?.log({
        action: "task.complete",
        userID: task.userID,
        taskID: task.id,
        workspaceID: task.workspaceID,
        metadata: { resultLength: result.length, sessionID: session.id },
        success: true,
      })

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)

      // If the task was already aborted (by user), skip retry/fail transitions
      const current = this.tracker.get(task.id)
      if (current && (current.state === "aborted" || current.state === "completed" || current.state === "failed")) {
        // Terminal state — nothing to do
      } else if (task.retries < task.maxRetries) {
        // Retry logic with exponential backoff
        const backoff = Math.min(
          this.retryBackoffMs * Math.pow(2, task.retries),
          this.retryMaxBackoffMs,
        )
        this.tracker.transition(task.id, "retrying", { error })
        console.warn(`[queue] Task ${task.id} failed, retrying in ${backoff}ms (${task.retries + 1}/${task.maxRetries})`)

        setTimeout(() => {
          try {
            this.tracker.transition(task.id, "running")
            task.retries++
            this.startWorker(task)
          } catch {}
        }, backoff)
      } else {
        try {
          this.tracker.transition(task.id, "failed", { error })
        } catch {}
        this.audit?.log({
          action: "task.fail",
          userID: task.userID,
          taskID: task.id,
          workspaceID: task.workspaceID,
          metadata: { error, retries: task.retries },
          success: false,
          error,
        })
      }
    } finally {
      this.workers.delete(task.id)
    }
  }
}
