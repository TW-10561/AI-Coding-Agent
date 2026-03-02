// ---------------------------------------------------------------------------
// Task State Machine — persistent state tracking for all platform tasks.
// ---------------------------------------------------------------------------
// Tracks full lifecycle of every task: queued → running → completed/failed.
// Supports:
//  - State transitions with validation
//  - Persistent SQLite storage (survives restarts)
//  - Event emission on state change
//  - Progress tracking (percent, current step)
//  - Task metadata and result storage
//  - Filtering, pagination, search
// ---------------------------------------------------------------------------

import { Database } from "bun:sqlite"
import { ulid } from "ulid"

export type TaskState = "queued" | "running" | "completed" | "failed" | "aborted" | "paused" | "retrying"

export interface TrackedTask {
  id: string
  userID: string
  workspaceID?: string
  sessionID?: string
  orchestrationID?: string
  type: "prompt" | "subagent" | "parallel" | "custom"
  state: TaskState
  title: string
  prompt: string
  agentID?: string
  modelID?: string
  progress: number         // 0-100
  currentStep?: string
  result?: string
  error?: string
  retries: number
  maxRetries: number
  priority: number         // lower = higher priority
  createdAt: number
  startedAt?: number
  completedAt?: number
  metadata: Record<string, unknown>
}

// Valid state transitions
const TRANSITIONS: Record<TaskState, TaskState[]> = {
  queued:    ["running", "aborted"],
  running:   ["completed", "failed", "aborted", "paused", "retrying"],
  paused:    ["running", "aborted"],
  retrying:  ["running", "failed", "aborted"],
  completed: [],
  failed:    ["retrying", "queued"],
  aborted:   [],
}

type StateChangeCallback = (task: TrackedTask, from: TaskState, to: TaskState) => void

export class TaskStateTracker {
  private db: Database
  private listeners = new Set<StateChangeCallback>()

  constructor(opts?: { dbPath?: string }) {
    this.db = new Database(opts?.dbPath ?? "platform-tasks.db")
    this.db.run("PRAGMA journal_mode = WAL")
    this.db.run("PRAGMA synchronous = NORMAL")

    this.db.run(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'default',
        workspace_id TEXT,
        session_id TEXT,
        orchestration_id TEXT,
        type TEXT NOT NULL DEFAULT 'prompt',
        state TEXT NOT NULL DEFAULT 'queued',
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        agent_id TEXT,
        model_id TEXT,
        progress INTEGER NOT NULL DEFAULT 0,
        current_step TEXT,
        result TEXT,
        error TEXT,
        retries INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 2,
        priority INTEGER NOT NULL DEFAULT 5,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        metadata TEXT DEFAULT '{}'
      )
    `)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_task_state ON tasks(state)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_task_user ON tasks(user_id)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_task_ws ON tasks(workspace_id)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_task_orch ON tasks(orchestration_id)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_task_priority ON tasks(priority, created_at)`)
  }

  /** Create a new tracked task */
  create(opts: {
    userID?: string
    workspaceID?: string
    type?: TrackedTask["type"]
    title: string
    prompt: string
    agentID?: string
    modelID?: string
    priority?: number
    maxRetries?: number
    orchestrationID?: string
    metadata?: Record<string, unknown>
  }): TrackedTask {
    const task: TrackedTask = {
      id: ulid(),
      userID: opts.userID ?? "default",
      workspaceID: opts.workspaceID,
      type: opts.type ?? "prompt",
      state: "queued",
      title: opts.title,
      prompt: opts.prompt,
      agentID: opts.agentID,
      modelID: opts.modelID,
      progress: 0,
      retries: 0,
      maxRetries: opts.maxRetries ?? 2,
      priority: opts.priority ?? 5,
      createdAt: Date.now(),
      orchestrationID: opts.orchestrationID,
      metadata: opts.metadata ?? {},
    }

    this.db.run(`
      INSERT INTO tasks (id, user_id, workspace_id, type, state, title, prompt, agent_id, model_id,
                         progress, retries, max_retries, priority, created_at, orchestration_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [task.id, task.userID, task.workspaceID ?? null, task.type, task.state,
       task.title, task.prompt, task.agentID ?? null, task.modelID ?? null,
       task.progress, task.retries, task.maxRetries, task.priority, task.createdAt,
       task.orchestrationID ?? null, JSON.stringify(task.metadata)])

    return task
  }

  /** Transition task to a new state */
  transition(id: string, to: TaskState, opts?: { error?: string; result?: string; progress?: number; currentStep?: string }): TrackedTask {
    const task = this.get(id)
    if (!task) throw new Error(`Task not found: ${id}`)

    const allowed = TRANSITIONS[task.state]
    if (!allowed.includes(to)) {
      throw new Error(`Invalid transition: ${task.state} → ${to} (allowed: ${allowed.join(", ")})`)
    }

    const from = task.state
    const updates: Record<string, unknown> = { state: to }

    if (to === "running") {
      updates.started_at = Date.now()
    }
    if (to === "completed" || to === "failed" || to === "aborted") {
      updates.completed_at = Date.now()
    }
    if (to === "retrying") {
      updates.retries = task.retries + 1
    }
    if (opts?.error !== undefined) updates.error = opts.error
    if (opts?.result !== undefined) updates.result = opts.result
    if (opts?.progress !== undefined) updates.progress = opts.progress
    if (opts?.currentStep !== undefined) updates.current_step = opts.currentStep

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(", ")
    const values = Object.values(updates)
    this.db.run(`UPDATE tasks SET ${setClauses} WHERE id = ?`, ...(values as any[]), id)

    const updated = this.get(id)!
    for (const cb of this.listeners) cb(updated, from, to)
    return updated
  }

  /** Update task progress without state change */
  updateProgress(id: string, progress: number, currentStep?: string): void {
    this.db.run(
      "UPDATE tasks SET progress = ?, current_step = ? WHERE id = ?",
      [Math.min(100, Math.max(0, progress)), currentStep ?? null, id]
    )
  }

  /** Set the session ID once OpenCode creates it */
  setSession(id: string, sessionID: string): void {
    this.db.run("UPDATE tasks SET session_id = ? WHERE id = ?", [sessionID, id])
  }

  /** Get task by ID */
  get(id: string): TrackedTask | undefined {
    const row = this.db.query("SELECT * FROM tasks WHERE id = ?").get(id) as any
    return row ? this.rowToTask(row) : undefined
  }

  /** List tasks with filtering */
  list(opts?: {
    state?: TaskState | TaskState[]
    userID?: string
    workspaceID?: string
    orchestrationID?: string
    type?: TrackedTask["type"]
    limit?: number
    offset?: number
    sortBy?: "priority" | "createdAt" | "updatedAt"
  }): TrackedTask[] {
    const conditions: string[] = []
    const params: unknown[] = []

    if (opts?.state) {
      if (Array.isArray(opts.state)) {
        conditions.push(`state IN (${opts.state.map(() => "?").join(",")})`)
        params.push(...opts.state)
      } else {
        conditions.push("state = ?")
        params.push(opts.state)
      }
    }
    if (opts?.userID) { conditions.push("user_id = ?"); params.push(opts.userID) }
    if (opts?.workspaceID) { conditions.push("workspace_id = ?"); params.push(opts.workspaceID) }
    if (opts?.orchestrationID) { conditions.push("orchestration_id = ?"); params.push(opts.orchestrationID) }
    if (opts?.type) { conditions.push("type = ?"); params.push(opts.type) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
    const orderBy = opts?.sortBy === "priority" ? "priority ASC, created_at ASC" : "created_at DESC"
    const limit = opts?.limit ?? 100
    const offset = opts?.offset ?? 0

    const rows = this.db
      .query(`SELECT * FROM tasks ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...(params as any[]), limit, offset) as any[]

    return rows.map(this.rowToTask)
  }

  /** Get next queued task by priority */
  nextQueued(opts?: { workspaceID?: string; type?: TrackedTask["type"] }): TrackedTask | undefined {
    const conditions = ["state = 'queued'"]
    const params: unknown[] = []
    if (opts?.workspaceID) { conditions.push("workspace_id = ?"); params.push(opts.workspaceID) }
    if (opts?.type) { conditions.push("type = ?"); params.push(opts.type) }

    const row = this.db
      .query(`SELECT * FROM tasks WHERE ${conditions.join(" AND ")} ORDER BY priority ASC, created_at ASC LIMIT 1`)
      .get(...(params as any[])) as any

    return row ? this.rowToTask(row) : undefined
  }

  /** Get aggregate stats */
  stats(opts?: { userID?: string; workspaceID?: string }): Record<TaskState | "total", number> {
    const conditions: string[] = []
    const params: unknown[] = []
    if (opts?.userID) { conditions.push("user_id = ?"); params.push(opts.userID) }
    if (opts?.workspaceID) { conditions.push("workspace_id = ?"); params.push(opts.workspaceID) }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

    const rows = this.db
      .query(`SELECT state, COUNT(*) as c FROM tasks ${where} GROUP BY state`)
      .all(...(params as any[])) as any[]

    const result: any = { queued: 0, running: 0, completed: 0, failed: 0, aborted: 0, paused: 0, retrying: 0, total: 0 }
    for (const r of rows) {
      result[r.state] = r.c
      result.total += r.c
    }
    return result
  }

  /** Subscribe to state changes */
  onStateChange(cb: StateChangeCallback): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  /** Clean up old completed/failed tasks */
  cleanup(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs
    const result = this.db.run(
      "DELETE FROM tasks WHERE state IN ('completed','failed','aborted') AND completed_at < ?",
      [cutoff]
    )
    return result.changes
  }

  dispose() {
    this.db.close()
  }

  private rowToTask(row: any): TrackedTask {
    return {
      id: row.id,
      userID: row.user_id,
      workspaceID: row.workspace_id ?? undefined,
      sessionID: row.session_id ?? undefined,
      orchestrationID: row.orchestration_id ?? undefined,
      type: row.type,
      state: row.state,
      title: row.title,
      prompt: row.prompt,
      agentID: row.agent_id ?? undefined,
      modelID: row.model_id ?? undefined,
      progress: row.progress,
      currentStep: row.current_step ?? undefined,
      result: row.result ?? undefined,
      error: row.error ?? undefined,
      retries: row.retries,
      maxRetries: row.max_retries,
      priority: row.priority,
      createdAt: row.created_at,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      metadata: JSON.parse(row.metadata || "{}"),
    }
  }
}
