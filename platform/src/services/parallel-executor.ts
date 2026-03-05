// ---------------------------------------------------------------------------
// Parallel Execution Manager — runs multiple tasks concurrently with
// dependency resolution, fan-out/fan-in patterns, and result aggregation.
// ---------------------------------------------------------------------------
// Supports:
//  - Fan-out: split one task into N parallel subtasks
//  - Fan-in: aggregate results when all subtasks complete
//  - Dependency graph (DAG) execution
//  - Concurrency limits per execution
//  - Timeout per task and per execution
//  - Progress tracking across all parallel tasks
//  - Cancellation of entire execution
// ---------------------------------------------------------------------------

import { ulid } from "ulid"
import { OpenCodeClient } from "./opencode-client"
import type { TaskStateTracker } from "./task-state-tracker"
import type { AuditLogger } from "./audit-logger"

export type ParallelStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "timeout"

export interface ParallelTask {
  id: string
  label: string
  agentID?: string
  prompt: string
  dependsOn: string[]        // task IDs in this execution
  status: ParallelStatus
  sessionID?: string
  result?: string
  error?: string
  startedAt?: number
  completedAt?: number
  timeoutMs?: number          // per-task timeout
}

export interface ParallelExecution {
  id: string
  name: string
  userID: string
  workspaceID?: string
  status: ParallelStatus
  tasks: ParallelTask[]
  concurrency: number
  aggregatedResult?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
  timeoutMs: number           // whole-execution timeout
  fanInPrompt?: string        // prompt template to aggregate results
}

export interface ParallelPlan {
  name: string
  userID: string
  workspaceID?: string
  concurrency?: number
  timeoutMs?: number
  fanInPrompt?: string
  tasks: Array<{
    label: string
    agentID?: string
    prompt: string
    dependsOn?: string[]      // use label names for dependency
    timeoutMs?: number
  }>
}

type ExecutionCallback = (exec: ParallelExecution) => void

export class ParallelExecutionManager {
  private executions = new Map<string, ParallelExecution>()
  private client: OpenCodeClient
  private tracker?: TaskStateTracker
  private audit?: AuditLogger
  private listeners = new Set<ExecutionCallback>()

  constructor(opts: {
    client: OpenCodeClient
    tracker?: TaskStateTracker
    audit?: AuditLogger
  }) {
    this.client = opts.client
    this.tracker = opts.tracker
    this.audit = opts.audit
  }

  /** Execute a parallel plan */
  async execute(plan: ParallelPlan): Promise<ParallelExecution> {
    const execID = ulid()

    // Build label→id map for dependency resolution
    const labelToID = new Map<string, string>()
    const tasks: ParallelTask[] = plan.tasks.map((t) => {
      const id = ulid()
      labelToID.set(t.label, id)
      return {
        id,
        label: t.label,
        agentID: t.agentID,
        prompt: t.prompt,
        dependsOn: [],
        status: "pending" as ParallelStatus,
        timeoutMs: t.timeoutMs,
      }
    })

    // Resolve dependencies by label
    plan.tasks.forEach((t, i) => {
      if (t.dependsOn) {
        tasks[i].dependsOn = t.dependsOn
          .map(label => labelToID.get(label))
          .filter((id): id is string => !!id)
      }
    })

    // Validate no cycles in dependency graph
    this.validateDAG(tasks)

    const exec: ParallelExecution = {
      id: execID,
      name: plan.name,
      userID: plan.userID,
      workspaceID: plan.workspaceID,
      status: "running",
      tasks,
      concurrency: plan.concurrency ?? 3,
      createdAt: Date.now(),
      startedAt: Date.now(),
      timeoutMs: plan.timeoutMs ?? 5 * 60 * 1000, // 5 min default
      fanInPrompt: plan.fanInPrompt,
    }

    this.executions.set(execID, exec)
    this.audit?.log({
      action: "parallel.start",
      userID: plan.userID,
      workspaceID: plan.workspaceID,
      metadata: { executionID: execID, taskCount: tasks.length, concurrency: exec.concurrency },
      success: true,
    })
    this.emit(exec)

    // Start execution in background
    this.runExecution(exec)
    return exec
  }

  /** Get execution by ID */
  get(id: string): ParallelExecution | undefined {
    return this.executions.get(id)
  }

  /** List all executions */
  list(opts?: { userID?: string; status?: ParallelStatus }): ParallelExecution[] {
    let result = [...this.executions.values()]
    if (opts?.userID) result = result.filter(e => e.userID === opts.userID)
    if (opts?.status) result = result.filter(e => e.status === opts.status)
    return result.sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Cancel an execution */
  async cancel(id: string): Promise<boolean> {
    const exec = this.executions.get(id)
    if (!exec || exec.status !== "running") return false

    for (const task of exec.tasks) {
      if (task.status === "pending") task.status = "cancelled"
      if (task.status === "running" && task.sessionID) {
        try { await this.client.abortSession(task.sessionID) } catch {}
        task.status = "cancelled"
        task.completedAt = Date.now()
      }
    }

    exec.status = "cancelled"
    exec.completedAt = Date.now()
    this.emit(exec)
    return true
  }

  /** Get execution progress as percentage */
  progress(id: string): { percent: number; completed: number; total: number; running: number; pending: number } {
    const exec = this.executions.get(id)
    if (!exec) return { percent: 0, completed: 0, total: 0, running: 0, pending: 0 }

    const completed = exec.tasks.filter(t => t.status === "completed").length
    const running = exec.tasks.filter(t => t.status === "running").length
    const pending = exec.tasks.filter(t => t.status === "pending").length
    const total = exec.tasks.length

    return {
      percent: total > 0 ? Math.round((completed / total) * 100) : 0,
      completed,
      total,
      running,
      pending,
    }
  }

  /** Subscribe to execution updates */
  onUpdate(cb: ExecutionCallback): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  // ── Internal execution engine ─────────────────────────────────

  private async runExecution(exec: ParallelExecution) {
    const timeout = setTimeout(() => {
      if (exec.status === "running") {
        for (const task of exec.tasks) {
          if (task.status === "pending" || task.status === "running") {
            task.status = "timeout"
            task.completedAt = Date.now()
          }
        }
        exec.status = "timeout"
        exec.completedAt = Date.now()
        this.emit(exec)
      }
    }, exec.timeoutMs)

    try {
      await this.scheduleLoop(exec)

      clearTimeout(timeout)

      // Fan-in: aggregate results if fan-in prompt specified
      if (exec.fanInPrompt && exec.status === "completed") {
        await this.fanIn(exec)
      }
    } catch (err) {
      clearTimeout(timeout)
      exec.status = "failed"
      exec.completedAt = Date.now()
      this.emit(exec)
    }
  }

  private async scheduleLoop(exec: ParallelExecution) {
    while (exec.status === "running") {
      const running = exec.tasks.filter(t => t.status === "running")
      const ready = exec.tasks.filter(t => this.isReady(t, exec))
      const allDone = exec.tasks.every(t => t.status !== "pending" && t.status !== "running")

      if (allDone) {
        const anyFailed = exec.tasks.some(t => t.status === "failed" || t.status === "timeout")
        exec.status = anyFailed ? "failed" : "completed"
        exec.completedAt = Date.now()

        this.audit?.log({
          action: "parallel.complete",
          userID: exec.userID,
          workspaceID: exec.workspaceID,
          metadata: {
            executionID: exec.id,
            completed: exec.tasks.filter(t => t.status === "completed").length,
            failed: exec.tasks.filter(t => t.status === "failed").length,
            duration: exec.completedAt - (exec.startedAt ?? exec.createdAt),
          },
          success: !anyFailed,
        })

        this.emit(exec)
        return
      }

      // Start as many ready tasks as concurrency allows
      const slotsAvailable = exec.concurrency - running.length
      const toStart = ready.slice(0, slotsAvailable)

      if (toStart.length > 0) {
        const promises = toStart.map(task => this.runTask(exec, task))
        await Promise.race([
          Promise.allSettled(promises),
          new Promise(r => setTimeout(r, 1000)), // check again after 1s even if nothing finishes
        ])
      } else if (running.length > 0) {
        // Wait a bit for running tasks to finish
        await new Promise(r => setTimeout(r, 500))
      } else {
        // No ready, no running, but not all done — deadlock or dep failure
        const blocked = exec.tasks.filter(t => t.status === "pending")
        for (const t of blocked) {
          t.status = "failed"
          t.error = "Blocked: dependency failed or missing"
          t.completedAt = Date.now()
        }
      }
    }
  }

  private isReady(task: ParallelTask, exec: ParallelExecution): boolean {
    if (task.status !== "pending") return false
    if (task.dependsOn.length === 0) return true
    return task.dependsOn.every(depID => {
      const dep = exec.tasks.find(t => t.id === depID)
      return dep?.status === "completed"
    })
  }

  private async runTask(exec: ParallelExecution, task: ParallelTask): Promise<void> {
    task.status = "running"
    task.startedAt = Date.now()
    this.emit(exec)

    // Per-task timeout
    const taskTimeout = task.timeoutMs ?? exec.timeoutMs

    try {
      const session = await this.client.createSession({ agentID: task.agentID })
      task.sessionID = session.id

      // Build context from dependencies
      let context = ""
      if (task.dependsOn.length > 0) {
        const depResults = task.dependsOn
          .map(id => exec.tasks.find(t => t.id === id))
          .filter(t => t?.result)
          .map(t => `[${t!.label}]: ${t!.result!.slice(0, 3000)}`)
        if (depResults.length > 0) {
          context = `Previous results:\n${depResults.join("\n\n")}\n\n`
        }
      }

      // Send with timeout
      const response = await Promise.race([
        this.client.prompt(session.id, {
          content: context + task.prompt,
          agentID: task.agentID,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Task timeout")), taskTimeout)
        ),
      ])

      // Extract text
      let text = ""
      const parts = (response as any).parts ?? (response as any).message?.parts ?? []
      for (const part of parts) {
        if (part.type === "text" && part.text) text += part.text
      }

      task.result = text
      task.status = "completed"
      task.completedAt = Date.now()
    } catch (err) {
      task.status = "failed"
      task.error = err instanceof Error ? err.message : String(err)
      task.completedAt = Date.now()
    }

    this.emit(exec)
  }

  private async fanIn(exec: ParallelExecution) {
    if (!exec.fanInPrompt) return

    try {
      const results = exec.tasks
        .filter(t => t.status === "completed" && t.result)
        .map(t => `[${t.label}]:\n${t.result}`)
        .join("\n\n---\n\n")

      const session = await this.client.createSession()
      const response = await this.client.prompt(session.id, {
        content: `${exec.fanInPrompt}\n\n${results}`,
      })

      let text = ""
      const parts = (response as any).parts ?? (response as any).message?.parts ?? []
      for (const part of parts) {
        if (part.type === "text" && part.text) text += part.text
      }

      exec.aggregatedResult = text
    } catch (err) {
      exec.aggregatedResult = `[Fan-in failed: ${err}]`
    }

    this.emit(exec)
  }

  private validateDAG(tasks: ParallelTask[]) {
    const visited = new Set<string>()
    const visiting = new Set<string>()
    const taskMap = new Map(tasks.map(t => [t.id, t]))

    function visit(id: string) {
      if (visited.has(id)) return
      if (visiting.has(id)) throw new Error(`Circular dependency detected involving task ${id}`)
      visiting.add(id)
      const task = taskMap.get(id)
      if (task) {
        for (const dep of task.dependsOn) visit(dep)
      }
      visiting.delete(id)
      visited.add(id)
    }

    for (const task of tasks) visit(task.id)
  }

  private emit(exec: ParallelExecution) {
    for (const cb of this.listeners) cb(exec)
  }
}
