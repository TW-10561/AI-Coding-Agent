// ---------------------------------------------------------------------------
// ChatLogStore — SQLite-backed log of /api/chat conversations.
// Stores VS Code extension chat sessions so the dashboard can display them.
// ---------------------------------------------------------------------------

import { Database } from "bun:sqlite"
import { ulid } from "ulid"

export interface ChatSession {
  id: string
  title: string
  model: string
  messageCount: number
  lastMessageAt: number
  createdAt: number
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

export class ChatLogStore {
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
        created_at INTEGER NOT NULL
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

  /** Record a completed chat exchange (user message + assistant reply). */
  store(opts: {
    sessionId: string
    userMessage: string
    assistantReply: string
    model: string
    toolCallCount?: number
    latencyMs?: number
  }): void {
    const now = Date.now()
    const existing = this.db.query("SELECT id FROM chat_sessions WHERE id = ?").get(opts.sessionId) as any

    if (!existing) {
      const title = opts.userMessage.slice(0, 72) + (opts.userMessage.length > 72 ? "…" : "")
      this.db.run(
        `INSERT INTO chat_sessions (id, title, model, message_count, last_message_at, created_at)
         VALUES (?, ?, ?, 2, ?, ?)`,
        [opts.sessionId, title, opts.model, now, now]
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

  /** List recent sessions, newest first. */
  listSessions(limit = 50): ChatSession[] {
    return (this.db.query("SELECT * FROM chat_sessions ORDER BY last_message_at DESC LIMIT ?").all(limit) as any[])
      .map(r => ({
        id: r.id,
        title: r.title,
        model: r.model,
        messageCount: r.message_count,
        lastMessageAt: r.last_message_at,
        createdAt: r.created_at,
      }))
  }

  /** Get all entries for a single session. */
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
