// ---------------------------------------------------------------------------
// Budget Manager — tracks and enforces per-user token/request/cost limits.
// ---------------------------------------------------------------------------
// Every prompt deducts from the user's budget. The budget system supports:
//  - Token limits (input + output)
//  - Request count limits
//  - Cost caps (for future paid providers)
//  - Per-hour, per-day, per-month windows
//  - Hard limits (reject) and soft limits (warn + log)
// ---------------------------------------------------------------------------

import { Database } from "bun:sqlite"
import { ulid } from "ulid"

export type BudgetWindow = "hour" | "day" | "month" | "total"

export interface BudgetLimit {
  id: string
  userID: string
  window: BudgetWindow
  maxTokens?: number       // max input+output tokens
  maxRequests?: number     // max prompt requests
  maxCostCents?: number    // max cost in cents (0 for local models)
  hardLimit: boolean       // true = reject, false = warn only
}

export interface BudgetUsage {
  userID: string
  window: BudgetWindow
  windowStart: number
  tokensUsed: number
  requestCount: number
  costCents: number
}

export interface BudgetCheckResult {
  allowed: boolean
  reason?: string
  usage: BudgetUsage
  limit?: BudgetLimit
  remaining: {
    tokens?: number
    requests?: number
    costCents?: number
  }
}

export class BudgetManager {
  private db: Database

  constructor(opts?: { dbPath?: string }) {
    this.db = new Database(opts?.dbPath ?? "platform-budget.db")
    this.db.run("PRAGMA journal_mode = WAL")
    this.db.run("PRAGMA synchronous = NORMAL")

    // Budget limits table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS budget_limits (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        window TEXT NOT NULL CHECK(window IN ('hour','day','month','total')),
        max_tokens INTEGER,
        max_requests INTEGER,
        max_cost_cents INTEGER,
        hard_limit INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        UNIQUE(user_id, window)
      )
    `)

    // Usage tracking table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS budget_usage (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tokens_input INTEGER NOT NULL DEFAULT 0,
        tokens_output INTEGER NOT NULL DEFAULT 0,
        cost_cents INTEGER NOT NULL DEFAULT 0,
        session_id TEXT,
        task_id TEXT,
        model_id TEXT
      )
    `)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_usage_user ON budget_usage(user_id)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_usage_ts ON budget_usage(timestamp)`)

    // Insert default limits for 'default' user (generous for local models)
    this.ensureDefaultLimits()
  }

  private ensureDefaultLimits() {
    const existing = this.db.query("SELECT COUNT(*) as c FROM budget_limits WHERE user_id = 'default'").get() as any
    if (existing.c > 0) return

    const defaults: Array<Omit<BudgetLimit, "id">> = [
      { userID: "default", window: "hour", maxTokens: 500_000, maxRequests: 100, hardLimit: false },
      { userID: "default", window: "day", maxTokens: 5_000_000, maxRequests: 1000, hardLimit: false },
      { userID: "default", window: "month", maxTokens: 100_000_000, maxRequests: 30000, hardLimit: false },
    ]
    for (const d of defaults) {
      this.setLimit({ ...d, id: ulid(), hardLimit: d.hardLimit })
    }
  }

  /** Set or update a budget limit for a user+window */
  setLimit(limit: BudgetLimit): BudgetLimit {
    this.db.run(`
      INSERT INTO budget_limits (id, user_id, window, max_tokens, max_requests, max_cost_cents, hard_limit, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, window)
      DO UPDATE SET max_tokens=excluded.max_tokens, max_requests=excluded.max_requests,
                    max_cost_cents=excluded.max_cost_cents, hard_limit=excluded.hard_limit
    `, [limit.id, limit.userID, limit.window, limit.maxTokens ?? null,
       limit.maxRequests ?? null, limit.maxCostCents ?? null,
       limit.hardLimit ? 1 : 0, Date.now()])
    return limit
  }

  /** Get all limits for a user */
  getLimits(userID: string): BudgetLimit[] {
    const rows = this.db.query("SELECT * FROM budget_limits WHERE user_id = ?").all(userID) as any[]
    return rows.map(r => ({
      id: r.id,
      userID: r.user_id,
      window: r.window,
      maxTokens: r.max_tokens ?? undefined,
      maxRequests: r.max_requests ?? undefined,
      maxCostCents: r.max_cost_cents ?? undefined,
      hardLimit: r.hard_limit === 1,
    }))
  }

  /** Record usage from a prompt */
  recordUsage(entry: {
    userID: string
    tokensInput: number
    tokensOutput: number
    costCents?: number
    sessionID?: string
    taskID?: string
    modelID?: string
  }): void {
    this.db.run(`
      INSERT INTO budget_usage (id, user_id, timestamp, tokens_input, tokens_output, cost_cents, session_id, task_id, model_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [ulid(), entry.userID, Date.now(), entry.tokensInput, entry.tokensOutput,
       entry.costCents ?? 0, entry.sessionID ?? null, entry.taskID ?? null, entry.modelID ?? null])
  }

  /** Check if a user can make a request (pre-flight check) */
  check(userID: string): BudgetCheckResult {
    const limits = this.getLimits(userID)
    if (limits.length === 0) {
      // No limits set — allow everything
      return {
        allowed: true,
        usage: { userID, window: "total", windowStart: 0, tokensUsed: 0, requestCount: 0, costCents: 0 },
        remaining: {},
      }
    }

    // Check all limits — hard limits always win over soft limits
    let softDenial: BudgetCheckResult | null = null

    for (const limit of limits) {
      const windowStart = this.windowStart(limit.window)
      const usage = this.getUsage(userID, windowStart)

      const remaining = {
        tokens: limit.maxTokens !== undefined ? limit.maxTokens - usage.tokensUsed : undefined,
        requests: limit.maxRequests !== undefined ? limit.maxRequests - usage.requestCount : undefined,
        costCents: limit.maxCostCents !== undefined ? limit.maxCostCents - usage.costCents : undefined,
      }

      const exceeded =
        (limit.maxTokens !== undefined && usage.tokensUsed >= limit.maxTokens) ||
        (limit.maxRequests !== undefined && usage.requestCount >= limit.maxRequests) ||
        (limit.maxCostCents !== undefined && usage.costCents >= limit.maxCostCents)

      if (!exceeded) continue

      const reason =
        limit.maxTokens !== undefined && usage.tokensUsed >= limit.maxTokens
          ? `Token limit exceeded for ${limit.window} window (${usage.tokensUsed}/${limit.maxTokens})`
          : limit.maxRequests !== undefined && usage.requestCount >= limit.maxRequests
            ? `Request limit exceeded for ${limit.window} window (${usage.requestCount}/${limit.maxRequests})`
            : `Cost limit exceeded for ${limit.window} window (${usage.costCents}/${limit.maxCostCents} cents)`

      const result: BudgetCheckResult = {
        allowed: !limit.hardLimit,
        reason,
        usage: { ...usage, window: limit.window, windowStart },
        limit,
        remaining,
      }

      // Hard limit exceeded → immediate deny
      if (limit.hardLimit) return result

      // Remember the first soft denial (but keep checking for hard limits)
      if (!softDenial) softDenial = result
    }

    // If we had soft denials but no hard denials, return the first soft denial (allowed: true with warning)
    if (softDenial) return softDenial

    // All checks passed
    const usage = this.getUsage(userID, 0)
    return { allowed: true, usage: { ...usage, window: "total", windowStart: 0 }, remaining: {} }
  }

  /** Get aggregated usage for a user from a given start time */
  getUsage(userID: string, since: number): BudgetUsage {
    const row = this.db.query(`
      SELECT
        COALESCE(SUM(tokens_input + tokens_output), 0) as tokens_used,
        COUNT(*) as request_count,
        COALESCE(SUM(cost_cents), 0) as cost_cents
      FROM budget_usage
      WHERE user_id = ? AND timestamp >= ?
    `).get(userID, since) as any

    return {
      userID,
      window: "total",
      windowStart: since,
      tokensUsed: row.tokens_used,
      requestCount: row.request_count,
      costCents: row.cost_cents,
    }
  }

  /** Get per-window usage summary */
  summary(userID: string): Record<BudgetWindow, BudgetUsage> {
    const windows: BudgetWindow[] = ["hour", "day", "month", "total"]
    const result: Record<string, BudgetUsage> = {}
    for (const w of windows) {
      const start = this.windowStart(w)
      result[w] = { ...this.getUsage(userID, start), window: w, windowStart: start }
    }
    return result as Record<BudgetWindow, BudgetUsage>
  }

  private windowStart(window: BudgetWindow): number {
    const now = Date.now()
    switch (window) {
      case "hour": return now - 60 * 60 * 1000
      case "day": return now - 24 * 60 * 60 * 1000
      case "month": return now - 30 * 24 * 60 * 60 * 1000
      case "total": return 0
    }
  }

  dispose() {
    this.db.close()
  }
}
