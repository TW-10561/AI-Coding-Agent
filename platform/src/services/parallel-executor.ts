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
import { sql as pgSql, pgEnabled } from "../config/db"

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
    // Load persisted executions on startup (delay to allow PG connection to establish)
    setTimeout(() => {
      this.loadFromDB().catch(err => console.error("[parallel] Failed to load from DB:", err))
    }, 5000)
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
    // Persist to DB on every state change
    this.persistToDB(exec).catch(err => console.error("[parallel] Persist error:", err))
  }

  // ── Database persistence ─────────────────────────────────────
  private dbInitialized: Promise<void> | null = null

  private initDB(): Promise<void> {
    if (!pgEnabled) return Promise.resolve()
    if (!this.dbInitialized) {
      this.dbInitialized = this._doInitDB()
    }
    return this.dbInitialized
  }

  private async _doInitDB(): Promise<void> {
    await pgSql`
      CREATE TABLE IF NOT EXISTS parallel_executions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        workspace_id TEXT,
        status TEXT NOT NULL,
        concurrency INTEGER NOT NULL DEFAULT 3,
        aggregated_result TEXT,
        fan_in_prompt TEXT,
        timeout_ms INTEGER NOT NULL DEFAULT 300000,
        created_at BIGINT NOT NULL,
        started_at BIGINT,
        completed_at BIGINT,
        tasks JSONB NOT NULL DEFAULT '[]'
      )`
    console.log("[parallel] DB tables initialized")
  }

  private async persistToDB(exec: ParallelExecution): Promise<void> {
    if (!pgEnabled) return
    await this.initDB()
    const tasksJson = JSON.stringify(exec.tasks)
    await pgSql`
      INSERT INTO parallel_executions (id, name, user_id, workspace_id, status, concurrency, aggregated_result, fan_in_prompt, timeout_ms, created_at, started_at, completed_at, tasks)
      VALUES (${exec.id}, ${exec.name}, ${exec.userID}, ${exec.workspaceID ?? null}, ${exec.status}, ${exec.concurrency}, ${exec.aggregatedResult ?? null}, ${exec.fanInPrompt ?? null}, ${exec.timeoutMs}, ${exec.createdAt}, ${exec.startedAt ?? null}, ${exec.completedAt ?? null}, ${tasksJson})
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        aggregated_result = EXCLUDED.aggregated_result,
        started_at = EXCLUDED.started_at,
        completed_at = EXCLUDED.completed_at,
        tasks = EXCLUDED.tasks
    `
  }

  private async loadFromDB(): Promise<void> {
    if (!pgEnabled) return
    await this.initDB()
    try {
      const rows = await pgSql`SELECT * FROM parallel_executions ORDER BY created_at DESC LIMIT 200`
      for (const r of rows) {
        const exec: ParallelExecution = {
          id: r.id,
          name: r.name,
          userID: r.user_id,
          workspaceID: r.workspace_id ?? undefined,
          status: r.status as ParallelStatus,
          tasks: typeof r.tasks === 'string' ? JSON.parse(r.tasks) : r.tasks,
          concurrency: r.concurrency,
          aggregatedResult: r.aggregated_result ?? undefined,
          createdAt: Number(r.created_at),
          startedAt: r.started_at ? Number(r.started_at) : undefined,
          completedAt: r.completed_at ? Number(r.completed_at) : undefined,
          timeoutMs: r.timeout_ms,
          fanInPrompt: r.fan_in_prompt ?? undefined,
        }
        this.executions.set(exec.id, exec)
      }
      if (rows.length > 0) console.log(`[parallel] Loaded ${rows.length} executions from DB`)
    } catch (err) {
      console.error("[parallel] loadFromDB query error:", err)
    }
  }

  // ── Lightweight tool-execution tracking ──────────────────────
  // Records ad-hoc parallel tool calls originating from the agent
  // loop (chat.ts), so they appear in the "Parallel" dashboard tab.

  private toolExecutions: ToolExecution[] = []

  /** Record a set of tool calls that ran in parallel during a chat round */
  recordToolExecution(record: {
    sessionId?: string
    round: number
    prompt?: string
    tools: Array<{ name: string; args: Record<string, any>; success: boolean; durationMs: number }>
  }): string {
    const id = ulid()
    const now = Date.now()
    const exec: ToolExecution = {
      id,
      type: "tool-calls",
      sessionId: record.sessionId,
      round: record.round,
      prompt: record.prompt,
      tools: record.tools,
      status: record.tools.every(t => t.success) ? "completed" : "failed",
      createdAt: now,
      completedAt: now,
    }
    this.toolExecutions.push(exec)
    // Keep last 200 entries
    if (this.toolExecutions.length > 200) this.toolExecutions.splice(0, this.toolExecutions.length - 200)
    // Persist to DB
    this.persistToolExecution(exec).catch(err => console.error("[parallel] Tool exec persist error:", err))
    return id
  }

  /** List tool executions (for dashboard) */
  listToolExecutions(limit = 50): ToolExecution[] {
    return this.toolExecutions.slice(-limit).reverse()
  }

  private async persistToolExecution(exec: ToolExecution): Promise<void> {
    if (!pgEnabled) return
    try {
      await pgSql`
        CREATE TABLE IF NOT EXISTS parallel_tool_executions (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          round INTEGER NOT NULL,
          prompt TEXT,
          tools JSONB NOT NULL DEFAULT '[]',
          status TEXT NOT NULL,
          created_at BIGINT NOT NULL,
          completed_at BIGINT NOT NULL
        )`
      await pgSql`
        INSERT INTO parallel_tool_executions (id, session_id, round, prompt, tools, status, created_at, completed_at)
        VALUES (${exec.id}, ${exec.sessionId ?? null}, ${exec.round}, ${exec.prompt ?? null}, ${JSON.stringify(exec.tools)}, ${exec.status}, ${exec.createdAt}, ${exec.completedAt})
        ON CONFLICT (id) DO NOTHING
      `
    } catch {}
  }
}

// Lightweight record for ad-hoc parallel tool calls from the agent loop
export interface ToolExecution {
  id: string
  type: "tool-calls"
  sessionId?: string
  round: number
  prompt?: string
  tools: Array<{ name: string; args: Record<string, any>; success: boolean; durationMs: number }>
  status: "completed" | "failed"
  createdAt: number
  completedAt: number
}
