// ---------------------------------------------------------------------------
// ChatLogStore — Stores VS Code extension chat sessions.
// Uses PostgreSQL when POSTGRES_URL is configured, otherwise falls back to
// SQLite (bun:sqlite) for local development without a database.
// ---------------------------------------------------------------------------

import { Database } from "bun:sqlite"
import { ulid } from "ulid"
import { sql as pgSql, pgEnabled } from "../config/db"

export interface ChatSession {
  id: string
  title: string
  model: string
  messageCount: number
  lastMessageAt: number
  createdAt: number
  userId?: string
}

export interface ChatEntry {
  id: string
  sessionId: string
  role: "user" | "assistant"
  content: string
  model: string
  toolCallCount: number
  latencyMs: number | null
  timestamp: number
}

// ── PostgreSQL implementation ────────────────────────────────────────

class PgChatLogStore {
  async store(opts: {
    sessionId: string
    userMessage: string
    assistantReply: string
    model: string
    toolCallCount?: number
    latencyMs?: number
    userId?: string
  }): Promise<void> {
    const now = new Date()
    const existing = await pgSql`SELECT id FROM chat_sessions WHERE id = ${opts.sessionId}`

    if (existing.length === 0) {
      const title = opts.userMessage.slice(0, 72) + (opts.userMessage.length > 72 ? "…" : "")
      await pgSql`
        INSERT INTO chat_sessions (id, title, model, message_count, last_message_at, created_at, user_id)
        VALUES (${opts.sessionId}, ${title}, ${opts.model}, 2, ${now}, ${now}, ${opts.userId ?? null})`
    } else {
      await pgSql`
        UPDATE chat_sessions
        SET message_count = message_count + 2, last_message_at = ${now}, model = ${opts.model}
        WHERE id = ${opts.sessionId}`
    }

    const userTs = new Date(now.getTime() - (opts.latencyMs ?? 0))
    await pgSql`
      INSERT INTO chat_entries (id, session_id, role, content, model, tool_call_count, latency_ms, timestamp)
      VALUES (${ulid()}, ${opts.sessionId}, 'user', ${opts.userMessage}, ${opts.model}, 0, ${null}, ${userTs})`
    await pgSql`
      INSERT INTO chat_entries (id, session_id, role, content, model, tool_call_count, latency_ms, timestamp)
      VALUES (${ulid()}, ${opts.sessionId}, 'assistant', ${opts.assistantReply}, ${opts.model}, ${opts.toolCallCount ?? 0}, ${opts.latencyMs ?? null}, ${now})`
  }

  async listSessions(limit = 50, userId?: string): Promise<ChatSession[]> {
    const rows = userId
      ? await pgSql`SELECT * FROM chat_sessions WHERE user_id = ${userId} ORDER BY last_message_at DESC LIMIT ${limit}`
      : await pgSql`SELECT * FROM chat_sessions ORDER BY last_message_at DESC LIMIT ${limit}`
    return rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      model: r.model,
      messageCount: r.message_count,
      lastMessageAt: new Date(r.last_message_at).getTime(),
      createdAt: new Date(r.created_at).getTime(),
      userId: r.user_id ?? undefined,
    }))
  }

  async getEntries(sessionId: string): Promise<ChatEntry[]> {
    const rows = await pgSql`
      SELECT * FROM chat_entries WHERE session_id = ${sessionId} ORDER BY timestamp ASC`
    return rows.map((r: any) => ({
      id: r.id,
      sessionId: r.session_id,
      role: r.role as "user" | "assistant",
      content: r.content,
      model: r.model,
      toolCallCount: r.tool_call_count,
      latencyMs: r.latency_ms,
      timestamp: new Date(r.timestamp).getTime(),
    }))
  }

  dispose() { /* PG pool is shared; no-op here */ }
}

// ── SQLite fallback implementation ───────────────────────────────────

class SqliteChatLogStore {
  private db: Database

  constructor(opts?: { dbPath?: string }) {
    this.db = new Database(opts?.dbPath ?? "chat-log.db")
    this.db.run("PRAGMA journal_mode = WAL")
    this.db.run("PRAGMA synchronous = NORMAL")

    this.db.run(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        message_count INTEGER NOT NULL DEFAULT 0,
        last_message_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        user_id TEXT
      )
    `)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS chat_entries (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        tool_call_count INTEGER NOT NULL DEFAULT 0,
        latency_ms INTEGER,
        timestamp INTEGER NOT NULL
      )
    `)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_entry_session ON chat_entries(session_id)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_session_time ON chat_sessions(last_message_at DESC)`)
  }

  store(opts: {
    sessionId: string
    userMessage: string
    assistantReply: string
    model: string
    toolCallCount?: number
    latencyMs?: number
    userId?: string
  }): void {
    const now = Date.now()
    const existing = this.db.query("SELECT id FROM chat_sessions WHERE id = ?").get(opts.sessionId) as any

    if (!existing) {
      const title = opts.userMessage.slice(0, 72) + (opts.userMessage.length > 72 ? "…" : "")
      this.db.run(
        `INSERT INTO chat_sessions (id, title, model, message_count, last_message_at, created_at, user_id)
         VALUES (?, ?, ?, 2, ?, ?, ?)`,
        [opts.sessionId, title, opts.model, now, now, opts.userId ?? null]
      )
    } else {
      this.db.run(
        `UPDATE chat_sessions SET message_count = message_count + 2, last_message_at = ?, model = ? WHERE id = ?`,
        [now, opts.model, opts.sessionId]
      )
    }

    const userTs = now - (opts.latencyMs ?? 0)
    this.db.run(
      `INSERT INTO chat_entries (id, session_id, role, content, model, tool_call_count, latency_ms, timestamp)
       VALUES (?, ?, 'user', ?, ?, 0, NULL, ?)`,
      [ulid(), opts.sessionId, opts.userMessage, opts.model, userTs]
    )
    this.db.run(
      `INSERT INTO chat_entries (id, session_id, role, content, model, tool_call_count, latency_ms, timestamp)
       VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`,
      [ulid(), opts.sessionId, opts.assistantReply, opts.model, opts.toolCallCount ?? 0, opts.latencyMs ?? null, now]
    )
  }

  listSessions(limit = 50, userId?: string): ChatSession[] {
    const query = userId
      ? this.db.query("SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY last_message_at DESC LIMIT ?").all(userId, limit)
      : this.db.query("SELECT * FROM chat_sessions ORDER BY last_message_at DESC LIMIT ?").all(limit)
    return (query as any[]).map(r => ({
      id: r.id,
      title: r.title,
      model: r.model,
      messageCount: r.message_count,
      lastMessageAt: r.last_message_at,
      createdAt: r.created_at,
      userId: r.user_id ?? undefined,
    }))
  }

  getEntries(sessionId: string): ChatEntry[] {
    return (this.db.query("SELECT * FROM chat_entries WHERE session_id = ? ORDER BY timestamp ASC").all(sessionId) as any[])
      .map(r => ({
        id: r.id,
        sessionId: r.session_id,
        role: r.role as "user" | "assistant",
        content: r.content,
        model: r.model,
        toolCallCount: r.tool_call_count,
        latencyMs: r.latency_ms,
        timestamp: r.timestamp,
      }))
  }

  dispose() { this.db.close() }
}

// ── Unified ChatLogStore ─────────────────────────────────────────────
// Wraps PG or SQLite and normalizes sync/async so callers don't care.

export class ChatLogStore {
  private impl: PgChatLogStore | SqliteChatLogStore

  constructor(opts?: { dbPath?: string }) {
    if (pgEnabled) {
      this.impl = new PgChatLogStore()
      console.log("[chat-log] Using PostgreSQL backend")
    } else {
      this.impl = new SqliteChatLogStore(opts)
      console.log("[chat-log] Using SQLite backend (POSTGRES_URL not set)")
    }
  }

  store(opts: {
    sessionId: string
    userMessage: string
    assistantReply: string
    model: string
    toolCallCount?: number
    latencyMs?: number
    userId?: string
  }): void {
    const result = this.impl.store(opts)
    // PG store is async but callers use fire-and-forget; catch errors silently
    if (result instanceof Promise) {
      result.catch((err: any) => console.error("[chat-log] PG store error:", err))
    }
  }

  async listSessions(limit = 50, userId?: string): Promise<ChatSession[]> {
    return this.impl.listSessions(limit, userId)
  }

  async getEntries(sessionId: string): Promise<ChatEntry[]> {
    return this.impl.getEntries(sessionId)
  }

  dispose() { this.impl.dispose() }
}
