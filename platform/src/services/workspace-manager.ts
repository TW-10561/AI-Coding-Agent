// ---------------------------------------------------------------------------
// Workspace Manager — manages multiple project workspaces & directories.
// ---------------------------------------------------------------------------
// Supports PostgreSQL (preferred) with SQLite fallback.
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
}

export interface WorkspaceCreateOptions {
  name: string
  directory: string
  description?: string
  tags?: string[]
  metadata?: Record<string, unknown>
}

export class WorkspaceManager {
  private db: Database
  private _activeID: string | null = null
  private usePG: boolean

  constructor(opts?: { dbPath?: string }) {
    this.usePG = pgEnabled
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
        metadata TEXT DEFAULT '{}'
      )
    `)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_ws_active ON workspaces(active)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_ws_dir ON workspaces(directory)`)

    // Load currently active workspace
    const active = this.db.query("SELECT id FROM workspaces WHERE active = 1 LIMIT 1").get() as any
    if (active) this._activeID = active.id
  }

  /** Create and register a new workspace */
  create(opts: WorkspaceCreateOptions): Workspace {
    const absDir = path.resolve(opts.directory)

    // Validate directory exists
    if (!fs.existsSync(absDir)) {
      throw new Error(`Directory does not exist: ${absDir}`)
    }
    if (!fs.statSync(absDir).isDirectory()) {
      throw new Error(`Not a directory: ${absDir}`)
    }

    // Check not already registered
    const existing = this.db.query("SELECT id FROM workspaces WHERE directory = ?").get(absDir) as any
    if (existing) {
      throw new Error(`Directory already registered as workspace ${existing.id}`)
    }

    const ws: Workspace = {
      id: ulid(),
      name: opts.name,
      directory: absDir,
      description: opts.description,
      tags: opts.tags ?? [],
      active: false,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      metadata: opts.metadata ?? {},
    }

    this.db.run(`
      INSERT INTO workspaces (id, name, directory, description, tags, active, created_at, last_accessed_at, metadata)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    `, [ws.id, ws.name, ws.directory, ws.description ?? null,
       JSON.stringify(ws.tags), ws.createdAt, ws.lastAccessedAt, JSON.stringify(ws.metadata)])

    // Mirror to PostgreSQL
    if (this.usePG) {
      pgSql`
        INSERT INTO workspaces (id, name, directory, tags, created_at)
        VALUES (${ws.id}::uuid, ${ws.name}, ${ws.directory}, ${pgSql.array(ws.tags)}, ${new Date(ws.createdAt).toISOString()})
        ON CONFLICT (id) DO NOTHING
      `.catch(e => console.warn(`[workspace-pg] write error: ${e.message}`))
    }

    return ws
  }

  /** Switch active workspace */
  switchTo(id: string): Workspace {
    const ws = this.get(id)
    if (!ws) throw new Error(`Workspace not found: ${id}`)

    // Validate directory still exists
    if (!fs.existsSync(ws.directory)) {
      throw new Error(`Workspace directory no longer exists: ${ws.directory}`)
    }

    // Deactivate all, activate this one
    this.db.run("UPDATE workspaces SET active = 0")
    this.db.run("UPDATE workspaces SET active = 1, last_accessed_at = ? WHERE id = ?", [Date.now(), id])
    this._activeID = id
    ws.active = true
    ws.lastAccessedAt = Date.now()
    return ws
  }

  /** Get workspace by ID */
  get(id: string): Workspace | undefined {
    const row = this.db.query("SELECT * FROM workspaces WHERE id = ?").get(id) as any
    return row ? this.rowToWorkspace(row) : undefined
  }

  /** Find workspace by directory */
  findByDirectory(directory: string): Workspace | undefined {
    const absDir = path.resolve(directory)
    const row = this.db.query("SELECT * FROM workspaces WHERE directory = ?").get(absDir) as any
    return row ? this.rowToWorkspace(row) : undefined
  }

  /** Get the currently active workspace */
  active(): Workspace | undefined {
    if (!this._activeID) return undefined
    return this.get(this._activeID)
  }

  /** List all workspaces */
  list(opts?: { tag?: string }): Workspace[] {
    let rows: any[]
    if (opts?.tag) {
      rows = this.db.query("SELECT * FROM workspaces WHERE tags LIKE ? ORDER BY last_accessed_at DESC")
        .all("%" + JSON.stringify(opts.tag).slice(0, 200) + "%") as any[]
    } else {
      rows = this.db.query("SELECT * FROM workspaces ORDER BY last_accessed_at DESC").all() as any[]
    }
    return rows.map(this.rowToWorkspace)
  }

  /** Update workspace metadata */
  update(id: string, patch: Partial<Pick<Workspace, "name" | "description" | "tags" | "metadata">>): Workspace {
    const ws = this.get(id)
    if (!ws) throw new Error(`Workspace not found: ${id}`)

    if (patch.name !== undefined) this.db.run("UPDATE workspaces SET name = ? WHERE id = ?", [patch.name, id])
    if (patch.description !== undefined) this.db.run("UPDATE workspaces SET description = ? WHERE id = ?", [patch.description, id])
    if (patch.tags !== undefined) this.db.run("UPDATE workspaces SET tags = ? WHERE id = ?", [JSON.stringify(patch.tags), id])
    if (patch.metadata !== undefined) this.db.run("UPDATE workspaces SET metadata = ? WHERE id = ?", [JSON.stringify(patch.metadata), id])

    // Mirror to PostgreSQL
    if (this.usePG) {
      const updated = this.get(id)!
      pgSql`
        UPDATE workspaces SET name = ${updated.name}, tags = ${pgSql.array(updated.tags)}
        WHERE id = ${id}::uuid
      `.catch(e => console.warn(`[workspace-pg] update error: ${e.message}`))
    }

    return this.get(id)!
  }

  /** Remove a workspace registration (does NOT delete the directory) */
  delete(id: string): boolean {
    const ws = this.get(id)
    if (!ws) return false
    this.db.run("DELETE FROM workspaces WHERE id = ?", [id])
    if (this._activeID === id) this._activeID = null

    if (this.usePG) {
      pgSql`DELETE FROM workspaces WHERE id = ${id}::uuid`.catch(e => console.warn(`[workspace-pg] delete error: ${e.message}`))
    }

    return true
  }

  /** Get workspace stats */
  stats(): { total: number; active: string | null; directories: string[] } {
    const total = (this.db.query("SELECT COUNT(*) as c FROM workspaces").get() as any).c
    const dirs = (this.db.query("SELECT directory FROM workspaces ORDER BY last_accessed_at DESC").all() as any[])
      .map(r => r.directory)
    return { total, active: this._activeID, directories: dirs }
  }

  dispose() {
    this.db.close()
  }

  private rowToWorkspace(row: any): Workspace {
    return {
      id: row.id,
      name: row.name,
      directory: row.directory,
      description: row.description ?? undefined,
      tags: JSON.parse(row.tags || "[]"),
      active: row.active === 1,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
      metadata: JSON.parse(row.metadata || "{}"),
    }
  }
}
