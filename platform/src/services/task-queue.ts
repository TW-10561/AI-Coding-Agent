// ---------------------------------------------------------------------------
// Task queue — enqueue prompts, track status, persist runs.
// Provides the async job layer backed by AgentExecutor (local tools + LLM).
// ---------------------------------------------------------------------------

import { ulid } from "ulid"
import { AgentExecutor } from "./agent-executor"
import type { TaskRun, PromptInput } from "../types"

type TaskCallback = (run: TaskRun) => void

export class TaskQueue {
  private runs = new Map<string, TaskRun>()
  private queue: string[] = []
  private active = 0
  private concurrency: number
  private executor: AgentExecutor
  private listeners = new Set<TaskCallback>()

  constructor(opts: { executor?: AgentExecutor; concurrency?: number }) {
    this.executor = opts.executor ?? new AgentExecutor()
    this.concurrency = opts.concurrency ?? 1
  }

  /** Enqueue a coding task. Returns the TaskRun immediately. */
  enqueue(input: {
    userID: string
    prompt: string
    directory: string
    agentID?: string
    modelID?: string
    providerID?: string
    sessionID?: string
  }): TaskRun {
    const id = ulid()
    const run: TaskRun = {
      id,
      userID: input.userID,
      sessionID: input.sessionID ?? "",
      status: "queued",
      prompt: input.prompt,
      directory: input.directory,
      createdAt: Date.now(),
    }
    this.runs.set(id, run)
    this.queue.push(id)
    this.emit(run)
    this.tick()
    return run
  }

  /** Get a run by ID */
  get(id: string): TaskRun | undefined {
    return this.runs.get(id)
  }

  /** List all runs, optionally filtered */
  list(filter?: { userID?: string; status?: TaskRun["status"] }): TaskRun[] {
    let result = [...this.runs.values()]
    if (filter?.userID) result = result.filter((r) => r.userID === filter.userID)
    if (filter?.status) result = result.filter((r) => r.status === filter.status)
    return result.sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Abort a running or queued task */
  async abort(id: string): Promise<boolean> {
    const run = this.runs.get(id)
    if (!run) return false
    if (run.status === "queued") {
      run.status = "aborted"
      this.queue = this.queue.filter((qid) => qid !== id)
      this.emit(run)
      return true
    }
    if (run.status === "running") {
      run.status = "aborted"
      run.completedAt = Date.now()
      this.emit(run)
      return true
    }
    return false
  }

  /** Subscribe to run state changes */
  onUpdate(cb: TaskCallback): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  // ── Internal ─────────────────────────────────────────────────────

  private emit(run: TaskRun) {
    for (const cb of this.listeners) cb(run)
  }

  private async tick() {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const id = this.queue.shift()!
      const run = this.runs.get(id)
      if (!run || run.status !== "queued") continue
      this.active++
      this.execute(run).finally(() => {
        this.active--
        this.tick()
      })
    }
  }

  private async execute(run: TaskRun) {
    try {
      run.status = "running"
      this.emit(run)

      // Run via AgentExecutor — calls LLM + tools locally
      const result = await this.executor.run({
        prompt: run.prompt,
        workspaceRoot: run.directory,
      })

      run.sessionID = run.id // Use task ID as session reference
      run.status = "completed"
      run.completedAt = Date.now()
    } catch (err) {
      run.status = "failed"
      run.completedAt = Date.now()
      run.error = err instanceof Error ? err.message : String(err)
    }
    this.emit(run)
  }
}
