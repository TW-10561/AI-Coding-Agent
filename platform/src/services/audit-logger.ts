// ---------------------------------------------------------------------------
// Audit Logger — persistent, structured event log for every platform action.
// ---------------------------------------------------------------------------
// Every API call, prompt, session create/delete, task run, config change, etc.
// is recorded here. The log is append-only, stored in SQLite for query-ability
// and exported via REST for compliance / debugging.
// ---------------------------------------------------------------------------

import { Database } from "bun:sqlite"
import { ulid } from "ulid"

export type AuditAction =
  | "session.create"
  | "session.delete"
  | "session.abort"
  | "session.fork"
  | "session.summarize"
  | "prompt.send"
  | "prompt.stream"
  | "prompt.async"
  | "task.enqueue"
  | "task.abort"
  | "task.complete"
  | "task.fail"
  | "config.read"
  | "config.update"
  | "auth.success"
  | "auth.failure"
  | "budget.check"
  | "budget.exceeded"
  | "budget.update"
  | "workspace.create"
  | "workspace.delete"
  | "workspace.switch"
  | "subagent.spawn"
  | "subagent.complete"
  | "subagent.fail"
  | "parallel.start"
  | "parallel.complete"
  | "file.read"
  | "file.list"
  | "provider.list"
  | "api.request"
  | "system.startup"
  | "system.shutdown"
  | "system.error"
  | "policy.evaluate"
  | "hitl.resolved"
  | "hitl.request_created"
  | "hitl.expired"
  | "hitl.auto_decision"

export interface AuditEntry {
  id: string
  timestamp: number
  action: AuditAction
  userID: string
  sessionID?: string
  taskID?: string
  workspaceID?: string
  metadata: Record<string, unknown>
  duration?: number
  success: boolean
  error?: string
  ip?: string
}

export interface AuditQueryOptions {
  action?: AuditAction
  userID?: string
  sessionID?: string
  workspaceID?: string
  since?: number
  until?: number
  success?: boolean
  limit?: number
  offset?: number
}

export class AuditLogger {
  private db: Database
  private buffer: AuditEntry[] = []
  private flushInterval: ReturnType<typeof setInterval>
  private flushSize: number

  constructor(opts?: { dbPath?: string; flushIntervalMs?: number; flushSize?: number }) {
    const dbPath = opts?.dbPath ?? "platform-audit.db"
    this.flushSize = opts?.flushSize ?? 50
    this.db = new Database(dbPath)
    this.db.run("PRAGMA journal_mode = WAL")
    this.db.run("PRAGMA synchronous = NORMAL")

    this.db.run(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        action TEXT NOT NULL,
        user_id TEXT NOT NULL DEFAULT 'system',
        session_id TEXT,
        task_id TEXT,
        workspace_id TEXT,
        metadata TEXT DEFAULT '{}',
        duration INTEGER,
        success INTEGER NOT NULL DEFAULT 1,
        error TEXT,
        ip TEXT
      )
    `)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(timestamp)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_log(session_id)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_log(workspace_id)`)

    this.flushInterval = setInterval(() => this.flush(), opts?.flushIntervalMs ?? 5000)
  }

  /** Record an audit event. Buffered for performance. */
  log(entry: Omit<AuditEntry, "id" | "timestamp">): AuditEntry {
    const full: AuditEntry = {
      id: ulid(),
      timestamp: Date.now(),
      ...entry,
    }
    this.buffer.push(full)
    if (this.buffer.length >= this.flushSize) {
      this.flush()
    }
    return full
  }

  /** Convenience: wrap an async action with automatic audit logging */
  async wrap<T>(
    action: AuditAction,
    meta: { userID?: string; sessionID?: string; taskID?: string; workspaceID?: string; ip?: string; metadata?: Record<string, unknown> },
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = performance.now()
    try {
      const result = await fn()
      this.log({
        action,
        userID: meta.userID ?? "system",
        sessionID: meta.sessionID,
        taskID: meta.taskID,
        workspaceID: meta.workspaceID,
        ip: meta.ip,
        metadata: meta.metadata ?? {},
        duration: Math.round(performance.now() - start),
        success: true,
      })
      return result
    } catch (err) {
      this.log({
        action,
        userID: meta.userID ?? "system",
        sessionID: meta.sessionID,
        taskID: meta.taskID,
        workspaceID: meta.workspaceID,
        ip: meta.ip,
        metadata: meta.metadata ?? {},
        duration: Math.round(performance.now() - start),
        success: false,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  /** Query audit entries */
  query(opts?: AuditQueryOptions): AuditEntry[] {
    this.flush() // Ensure buffer is persisted before query
    const conditions: string[] = []
    const params: unknown[] = []

    if (opts?.action) {
      conditions.push("action = ?")
      params.push(opts.action)
    }
    if (opts?.userID) {
      conditions.push("user_id = ?")
      params.push(opts.userID)
    }
    if (opts?.sessionID) {
      conditions.push("session_id = ?")
      params.push(opts.sessionID)
    }
    if (opts?.workspaceID) {
      conditions.push("workspace_id = ?")
      params.push(opts.workspaceID)
    }
    if (opts?.since) {
      conditions.push("timestamp >= ?")
      params.push(opts.since)
    }
    if (opts?.until) {
      conditions.push("timestamp <= ?")
      params.push(opts.until)
    }
    if (opts?.success !== undefined) {
      conditions.push("success = ?")
      params.push(opts.success ? 1 : 0)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
    const limit = opts?.limit ?? 100
    const offset = opts?.offset ?? 0

    const rows = this.db
      .query(`SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
      .all(...(params as any[]), limit, offset) as any[]

    return rows.map(this.rowToEntry)
  }

  /** Get aggregate stats */
  stats(opts?: { since?: number; until?: number; userID?: string }): {
    total: number
    byAction: Record<string, number>
    errors: number
    avgDuration: number
  } {
    this.flush()
    const conditions: string[] = []
    const params: unknown[] = []
    if (opts?.since) {
      conditions.push("timestamp >= ?")
      params.push(opts.since)
    }
    if (opts?.until) {
      conditions.push("timestamp <= ?")
      params.push(opts.until)
    }
    if (opts?.userID) {
      conditions.push("user_id = ?")
      params.push(opts.userID)
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""

    const total = (this.db.query(`SELECT COUNT(*) as c FROM audit_log ${where}`).get(...(params as any[])) as any)?.c ?? 0
    const errors = (this.db.query(`SELECT COUNT(*) as c FROM audit_log ${where} ${where ? "AND" : "WHERE"} success = 0`).get(...(params as any[])) as any)?.c ?? 0
    const avgDur = (this.db.query(`SELECT AVG(duration) as d FROM audit_log ${where} ${where ? "AND" : "WHERE"} duration IS NOT NULL`).get(...(params as any[])) as any)?.d ?? 0

    const actionRows = this.db
      .query(`SELECT action, COUNT(*) as c FROM audit_log ${where} GROUP BY action`)
      .all(...(params as any[])) as any[]
    const byAction: Record<string, number> = {}
    for (const r of actionRows) byAction[r.action] = r.c

    return { total, byAction, errors, avgDuration: Math.round(avgDur) }
  }

  /** Flush buffer to SQLite */
  flush() {
    if (this.buffer.length === 0) return
    const entries = this.buffer.splice(0)
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (id, timestamp, action, user_id, session_id, task_id, workspace_id, metadata, duration, success, error, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const tx = this.db.transaction(() => {
      for (const e of entries) {
        stmt.run(
          e.id, e.timestamp, e.action, e.userID,
          e.sessionID ?? null, e.taskID ?? null, e.workspaceID ?? null,
          JSON.stringify(e.metadata), e.duration ?? null,
          e.success ? 1 : 0, e.error ?? null, e.ip ?? null,
        )
      }
    })
    tx()
  }

  /** Clean up resources */
  dispose() {
    this.flush()
    clearInterval(this.flushInterval)
    this.db.close()
  }

  private rowToEntry(row: any): AuditEntry {
    return {
      id: row.id,
      timestamp: row.timestamp,
      action: row.action,
      userID: row.user_id,
      sessionID: row.session_id ?? undefined,
      taskID: row.task_id ?? undefined,
      workspaceID: row.workspace_id ?? undefined,
      metadata: JSON.parse(row.metadata || "{}"),
      duration: row.duration ?? undefined,
      success: row.success === 1,
      error: row.error ?? undefined,
      ip: row.ip ?? undefined,
    }
  }
}
