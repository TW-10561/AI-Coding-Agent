// ---------------------------------------------------------------------------
// Workspace Manager — manages multiple project workspaces & directories.
// ---------------------------------------------------------------------------
// Uses PostgreSQL when POSTGRES_URL is configured, otherwise SQLite fallback.
// ---------------------------------------------------------------------------

import { Database } from "bun:sqlite"
import { ulid } from "ulid"
import * as fs from "fs"
import * as path from "path"
import { sql as pgSql, pgEnabled } from "../config/db"

export interface Workspace {
  id: string
  name: string
  directory: string
  description?: string
  tags: string[]
  active: boolean
  createdAt: number
  lastAccessedAt: number
  metadata: Record<string, unknown>
  ownerId?: string
  ownerEmail?: string
}

export interface WorkspaceCreateOptions {
  name: string
  directory: string
  description?: string
  tags?: string[]
  metadata?: Record<string, unknown>
  ownerId?: string
}

// ── PostgreSQL implementation ────────────────────────────────────────

class PgWorkspaceManager {
  private _activeID: string | null = null

  async init(): Promise<void> {
    // Ensure extra columns exist (idempotent ALTER for upgrades)
    try {
      await pgSql`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS description TEXT`
      await pgSql`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT FALSE`
      await pgSql`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS last_accessed_at TIMESTAMPTZ DEFAULT NOW()`
      await pgSql`ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'`
    } catch {}
    const active = await pgSql`SELECT id FROM workspaces WHERE active = TRUE LIMIT 1`
    if (active.length > 0) this._activeID = active[0].id
  }

  async create(opts: WorkspaceCreateOptions): Promise<Workspace> {
    const absDir = path.resolve(opts.directory)
    if (!fs.existsSync(absDir)) throw new Error(`Directory does not exist: ${absDir}`)
    if (!fs.statSync(absDir).isDirectory()) throw new Error(`Not a directory: ${absDir}`)

    // Check per-user uniqueness — same user cannot register the same directory twice
    if (opts.ownerId) {
      const userExisting = await pgSql`SELECT id FROM workspaces WHERE directory = ${absDir} AND owner_id = ${opts.ownerId}`
      if (userExisting.length > 0) throw new Error(`Directory already registered as workspace ${userExisting[0].id}`)
    }

    const now = new Date()
    const tags = opts.tags ?? []
    const metadata = opts.metadata ?? {}

    const [row] = await pgSql`
      INSERT INTO workspaces (name, directory, description, tags, active, created_at, last_accessed_at, metadata, owner_id)
      VALUES (${opts.name}, ${absDir}, ${opts.description ?? null}, ${pgSql.array(tags)}, FALSE, ${now}, ${now}, ${JSON.stringify(metadata)}, ${opts.ownerId ?? null})
      RETURNING id`

    return {
      id: row.id,
      name: opts.name,
      directory: absDir,
      description: opts.description,
      tags,
      active: false,
      createdAt: now.getTime(),
      lastAccessedAt: now.getTime(),
      metadata,
      ownerId: opts.ownerId,
    }
  }

  async switchTo(id: string, ownerId?: string): Promise<Workspace> {
    const ws = await this.get(id, ownerId)
    if (!ws) throw new Error(`Workspace not found: ${id}`)
    if (!fs.existsSync(ws.directory)) throw new Error(`Workspace directory no longer exists: ${ws.directory}`)

    if (ownerId) {
      await pgSql`UPDATE workspaces SET active = FALSE WHERE owner_id = ${ownerId}`
    } else {
      await pgSql`UPDATE workspaces SET active = FALSE`
    }
    await pgSql`UPDATE workspaces SET active = TRUE, last_accessed_at = NOW() WHERE id = ${id}`
    this._activeID = id
    ws.active = true
    ws.lastAccessedAt = Date.now()
    return ws
  }

  async get(id: string, ownerId?: string): Promise<Workspace | undefined> {
    const rows = ownerId
      ? await pgSql`
          SELECT w.*, u.email AS owner_email
          FROM workspaces w
          LEFT JOIN users u ON u.id = w.owner_id
          WHERE w.id = ${id} AND w.owner_id = ${ownerId}
        `
      : await pgSql`
          SELECT w.*, u.email AS owner_email
          FROM workspaces w
          LEFT JOIN users u ON u.id = w.owner_id
          WHERE w.id = ${id}
        `
    return rows.length > 0 ? this.rowToWorkspace(rows[0]) : undefined
  }

  async findByDirectory(directory: string, ownerId?: string): Promise<Workspace | undefined> {
    const absDir = path.resolve(directory)
    const rows = ownerId
      ? await pgSql`
          SELECT w.*, u.email AS owner_email
          FROM workspaces w
          LEFT JOIN users u ON u.id = w.owner_id
          WHERE w.directory = ${absDir} AND w.owner_id = ${ownerId}
        `
      : await pgSql`
          SELECT w.*, u.email AS owner_email
          FROM workspaces w
          LEFT JOIN users u ON u.id = w.owner_id
          WHERE w.directory = ${absDir}
        `
    return rows.length > 0 ? this.rowToWorkspace(rows[0]) : undefined
  }

  async active(ownerId?: string): Promise<Workspace | undefined> {
    if (ownerId) {
      const rows = await pgSql`
        SELECT w.*, u.email AS owner_email
        FROM workspaces w
        LEFT JOIN users u ON u.id = w.owner_id
        WHERE w.owner_id = ${ownerId} AND w.active = TRUE
        ORDER BY w.last_accessed_at DESC
        LIMIT 1
      `
      return rows.length > 0 ? this.rowToWorkspace(rows[0]) : undefined
    }
    if (!this._activeID) return undefined
    return this.get(this._activeID)
  }

  async list(opts?: { tag?: string; ownerId?: string }): Promise<Workspace[]> {
    let rows: any[]
    if (opts?.tag && opts?.ownerId) {
      rows = await pgSql`
        SELECT w.*, u.email AS owner_email
        FROM workspaces w
        LEFT JOIN users u ON u.id = w.owner_id
        WHERE ${opts.tag} = ANY(w.tags) AND w.owner_id = ${opts.ownerId}
        ORDER BY w.last_accessed_at DESC
      `
    } else if (opts?.tag) {
      rows = await pgSql`
        SELECT w.*, u.email AS owner_email
        FROM workspaces w
        LEFT JOIN users u ON u.id = w.owner_id
        WHERE ${opts.tag} = ANY(w.tags)
        ORDER BY w.last_accessed_at DESC
      `
    } else if (opts?.ownerId) {
      rows = await pgSql`
        SELECT w.*, u.email AS owner_email
        FROM workspaces w
        LEFT JOIN users u ON u.id = w.owner_id
        WHERE w.owner_id = ${opts.ownerId}
        ORDER BY w.last_accessed_at DESC
      `
    } else {
      rows = await pgSql`
        SELECT w.*, u.email AS owner_email
        FROM workspaces w
        LEFT JOIN users u ON u.id = w.owner_id
        ORDER BY w.last_accessed_at DESC
      `
    }
    return rows.map((r: any) => this.rowToWorkspace(r))
  }

  async update(id: string, patch: Partial<Pick<Workspace, "name" | "description" | "tags" | "metadata">>, ownerId?: string): Promise<Workspace> {
    const ws = await this.get(id, ownerId)
    if (!ws) throw new Error(`Workspace not found: ${id}`)

    if (patch.name !== undefined) await pgSql`UPDATE workspaces SET name = ${patch.name} WHERE id = ${id}`
    if (patch.description !== undefined) await pgSql`UPDATE workspaces SET description = ${patch.description} WHERE id = ${id}`
    if (patch.tags !== undefined) await pgSql`UPDATE workspaces SET tags = ${pgSql.array(patch.tags)} WHERE id = ${id}`
    if (patch.metadata !== undefined) await pgSql`UPDATE workspaces SET metadata = ${JSON.stringify(patch.metadata)} WHERE id = ${id}`
    // Touch last_accessed_at on any update
    await pgSql`UPDATE workspaces SET last_accessed_at = NOW() WHERE id = ${id}`

    return (await this.get(id, ownerId))!
  }

  async delete(id: string, ownerId?: string): Promise<boolean> {
    const ws = await this.get(id, ownerId)
    if (!ws) return false
    if (ownerId) {
      await pgSql`DELETE FROM workspaces WHERE id = ${id} AND owner_id = ${ownerId}`
    } else {
      await pgSql`DELETE FROM workspaces WHERE id = ${id}`
    }
    if (this._activeID === id) this._activeID = null
    return true
  }

  async stats(): Promise<{ total: number; active: string | null; directories: string[] }> {
    const [{ count }] = await pgSql`SELECT COUNT(*)::int AS count FROM workspaces`
    const dirs = await pgSql`SELECT directory FROM workspaces ORDER BY last_accessed_at DESC`
    return { total: count, active: this._activeID, directories: dirs.map((r: any) => r.directory) }
  }

  dispose() { /* PG pool is shared; no-op */ }

  private rowToWorkspace(row: any): Workspace {
    return {
      id: row.id,
      name: row.name,
      directory: row.directory,
      description: row.description ?? undefined,
      tags: Array.isArray(row.tags) ? row.tags : [],
      active: row.active === true,
      createdAt: new Date(row.created_at).getTime(),
      lastAccessedAt: new Date(row.last_accessed_at).getTime(),
      metadata: typeof row.metadata === "object" ? row.metadata : JSON.parse(row.metadata || "{}"),
      ownerId: row.owner_id ?? undefined,
      ownerEmail: row.owner_email ?? undefined,
    }
  }
}

// ── SQLite fallback ──────────────────────────────────────────────────

class SqliteWorkspaceManager {
  private db: Database
  private _activeID: string | null = null

  constructor(opts?: { dbPath?: string }) {
    this.db = new Database(opts?.dbPath ?? "platform-workspaces.db")
    this.db.run("PRAGMA journal_mode = WAL")
    this.db.run("PRAGMA synchronous = NORMAL")

    this.db.run(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        directory TEXT NOT NULL UNIQUE,
        description TEXT,
        tags TEXT DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        metadata TEXT DEFAULT '{}',
        owner_id TEXT,
        owner_email TEXT
      )
    `)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_ws_active ON workspaces(active)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_ws_dir ON workspaces(directory)`)

    const active = this.db.query("SELECT id FROM workspaces WHERE active = 1 LIMIT 1").get() as any
    if (active) this._activeID = active.id
  }

  create(opts: WorkspaceCreateOptions): Workspace {
    const absDir = path.resolve(opts.directory)
    if (!fs.existsSync(absDir)) throw new Error(`Directory does not exist: ${absDir}`)
    if (!fs.statSync(absDir).isDirectory()) throw new Error(`Not a directory: ${absDir}`)

    const existing = this.db.query("SELECT id FROM workspaces WHERE directory = ?").get(absDir) as any
    if (existing) throw new Error(`Directory already registered as workspace ${existing.id}`)

    const ws: Workspace = {
      id: ulid(), name: opts.name, directory: absDir, description: opts.description,
      tags: opts.tags ?? [], active: false, createdAt: Date.now(), lastAccessedAt: Date.now(),
      metadata: opts.metadata ?? {}, ownerId: opts.ownerId,
    }
    this.db.run(
      `INSERT INTO workspaces (id, name, directory, description, tags, active, created_at, last_accessed_at, metadata, owner_id)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [ws.id, ws.name, ws.directory, ws.description ?? null,
       JSON.stringify(ws.tags), ws.createdAt, ws.lastAccessedAt, JSON.stringify(ws.metadata), opts.ownerId ?? null]
    )
    return ws
  }

  switchTo(id: string, ownerId?: string): Workspace {
    const ws = this.get(id, ownerId)
    if (!ws) throw new Error(`Workspace not found: ${id}`)
    if (!fs.existsSync(ws.directory)) throw new Error(`Workspace directory no longer exists: ${ws.directory}`)
    if (ownerId) {
      this.db.run("UPDATE workspaces SET active = 0 WHERE owner_id = ?", [ownerId])
    } else {
      this.db.run("UPDATE workspaces SET active = 0")
    }
    this.db.run("UPDATE workspaces SET active = 1, last_accessed_at = ? WHERE id = ?", [Date.now(), id])
    this._activeID = id
    ws.active = true
    ws.lastAccessedAt = Date.now()
    return ws
  }

  get(id: string, ownerId?: string): Workspace | undefined {
    const row = ownerId
      ? this.db.query("SELECT * FROM workspaces WHERE id = ? AND owner_id = ?").get(id, ownerId) as any
      : this.db.query("SELECT * FROM workspaces WHERE id = ?").get(id) as any
    return row ? this.rowToWorkspace(row) : undefined
  }

  findByDirectory(directory: string, ownerId?: string): Workspace | undefined {
    const absDir = path.resolve(directory)
    const row = ownerId
      ? this.db.query("SELECT * FROM workspaces WHERE directory = ? AND owner_id = ?").get(absDir, ownerId) as any
      : this.db.query("SELECT * FROM workspaces WHERE directory = ?").get(absDir) as any
    return row ? this.rowToWorkspace(row) : undefined
  }

  active(ownerId?: string): Workspace | undefined {
    if (ownerId) {
      const row = this.db.query("SELECT * FROM workspaces WHERE owner_id = ? AND active = 1 ORDER BY last_accessed_at DESC LIMIT 1").get(ownerId) as any
      return row ? this.rowToWorkspace(row) : undefined
    }
    if (!this._activeID) return undefined
    return this.get(this._activeID)
  }

  list(opts?: { tag?: string; ownerId?: string }): Workspace[] {
    let rows: any[]
    if (opts?.tag && opts?.ownerId) {
      rows = this.db.query("SELECT * FROM workspaces WHERE tags LIKE ? AND owner_id = ? ORDER BY last_accessed_at DESC")
        .all("%" + JSON.stringify(opts.tag).slice(0, 200) + "%", opts.ownerId) as any[]
    } else if (opts?.tag) {
      rows = this.db.query("SELECT * FROM workspaces WHERE tags LIKE ? ORDER BY last_accessed_at DESC")
        .all("%" + JSON.stringify(opts.tag).slice(0, 200) + "%") as any[]
    } else if (opts?.ownerId) {
      rows = this.db.query("SELECT * FROM workspaces WHERE owner_id = ? ORDER BY last_accessed_at DESC")
        .all(opts.ownerId) as any[]
    } else {
      rows = this.db.query("SELECT * FROM workspaces ORDER BY last_accessed_at DESC").all() as any[]
    }
    return rows.map(this.rowToWorkspace)
  }

  update(id: string, patch: Partial<Pick<Workspace, "name" | "description" | "tags" | "metadata">>, ownerId?: string): Workspace {
    const ws = this.get(id, ownerId)
    if (!ws) throw new Error(`Workspace not found: ${id}`)
    if (patch.name !== undefined) this.db.run("UPDATE workspaces SET name = ? WHERE id = ?", [patch.name, id])
    if (patch.description !== undefined) this.db.run("UPDATE workspaces SET description = ? WHERE id = ?", [patch.description, id])
    if (patch.tags !== undefined) this.db.run("UPDATE workspaces SET tags = ? WHERE id = ?", [JSON.stringify(patch.tags), id])
    if (patch.metadata !== undefined) this.db.run("UPDATE workspaces SET metadata = ? WHERE id = ?", [JSON.stringify(patch.metadata), id])
    return this.get(id, ownerId)!
  }

  delete(id: string, ownerId?: string): boolean {
    const ws = this.get(id, ownerId)
    if (!ws) return false
    if (ownerId) {
      this.db.run("DELETE FROM workspaces WHERE id = ? AND owner_id = ?", [id, ownerId])
    } else {
      this.db.run("DELETE FROM workspaces WHERE id = ?", [id])
    }
    if (this._activeID === id) this._activeID = null
    return true
  }

  stats(): { total: number; active: string | null; directories: string[] } {
    const total = (this.db.query("SELECT COUNT(*) as c FROM workspaces").get() as any).c
    const dirs = (this.db.query("SELECT directory FROM workspaces ORDER BY last_accessed_at DESC").all() as any[])
      .map((r: any) => r.directory)
    return { total, active: this._activeID, directories: dirs }
  }

  dispose() { this.db.close() }

  private rowToWorkspace(row: any): Workspace {
    return {
      id: row.id, name: row.name, directory: row.directory, description: row.description ?? undefined,
      tags: JSON.parse(row.tags || "[]"), active: row.active === 1,
      createdAt: row.created_at, lastAccessedAt: row.last_accessed_at,
      metadata: JSON.parse(row.metadata || "{}"), ownerId: row.owner_id ?? undefined,
      ownerEmail: row.owner_email ?? undefined,
    }
  }
}

// ── Unified WorkspaceManager ─────────────────────────────────────────

export class WorkspaceManager {
  private impl: PgWorkspaceManager | SqliteWorkspaceManager

  constructor(opts?: { dbPath?: string }) {
    if (pgEnabled) {
      const pg = new PgWorkspaceManager()
      this.impl = pg
      // Fire-and-forget init (ALTER TABLE idempotent upgrades)
      pg.init().catch((err: any) => console.error("[workspace-mgr] PG init error:", err))
      console.log("[workspace-mgr] Using PostgreSQL backend")
    } else {
      this.impl = new SqliteWorkspaceManager(opts)
      console.log("[workspace-mgr] Using SQLite backend")
    }
  }

  async create(opts: WorkspaceCreateOptions): Promise<Workspace> { return this.impl.create(opts) }
  async switchTo(id: string, ownerId?: string): Promise<Workspace> { return this.impl.switchTo(id, ownerId) }
  async get(id: string, ownerId?: string): Promise<Workspace | undefined> { return this.impl.get(id, ownerId) }
  async findByDirectory(dir: string, ownerId?: string): Promise<Workspace | undefined> { return this.impl.findByDirectory(dir, ownerId) }
  async active(ownerId?: string): Promise<Workspace | undefined> { return this.impl.active(ownerId) }
  async list(opts?: { tag?: string; ownerId?: string }): Promise<Workspace[]> { return this.impl.list(opts) }
  async update(id: string, patch: Partial<Pick<Workspace, "name" | "description" | "tags" | "metadata">>, ownerId?: string): Promise<Workspace> { return this.impl.update(id, patch, ownerId) }
  async delete(id: string, ownerId?: string): Promise<boolean> { return this.impl.delete(id, ownerId) }
  async stats(): Promise<{ total: number; active: string | null; directories: string[] }> { return this.impl.stats() }
  dispose() { this.impl.dispose() }
}
