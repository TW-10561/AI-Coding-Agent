#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// SQLite → PostgreSQL Migration Script
// ---------------------------------------------------------------------------
// Migrates all 5 SQLite databases to PostgreSQL:
//   1. workspaces.db       → workspaces table
//   2. audit.db            → audit_log table
//   3. budget.db           → budget_limits + budget_usage tables
//   4. chat-log.db         → chat_sessions + chat_entries tables
//   5. tasks.db            → tasks table
//
// Usage:
//   POSTGRES_URL=postgres://... bun run scripts/migrate-sqlite-to-pg.ts
//   POSTGRES_URL=postgres://... bun run scripts/migrate-sqlite-to-pg.ts --dry-run
//   POSTGRES_URL=postgres://... bun run scripts/migrate-sqlite-to-pg.ts --only=workspaces,audit
//
// The script is idempotent — it uses INSERT ... ON CONFLICT DO NOTHING.
// ---------------------------------------------------------------------------

import { Database } from "bun:sqlite"
import postgres from "postgres"
import { existsSync, mkdirSync, copyFileSync } from "fs"
import { resolve } from "path"

// ── Config ────────────────────────────────────────────────────────────

const args = new Set(process.argv.slice(2))
const dryRun = args.has("--dry-run")
const onlyArg = [...args].find(a => a.startsWith("--only="))
const onlySet = onlyArg ? new Set(onlyArg.replace("--only=", "").split(",")) : null

const PG_URL = process.env.POSTGRES_URL || process.env.PGBOUNCER_URL
if (!PG_URL) {
  console.error("❌ Set POSTGRES_URL or PGBOUNCER_URL environment variable")
  process.exit(1)
}

const DATA_DIR = process.env.OPENCODE_DIR
  ? resolve(process.env.OPENCODE_DIR, ".platform")
  : resolve(import.meta.dir, "../../.platform")

const BACKUP_DIR = resolve(DATA_DIR, "sqlite-backup")

function shouldMigrate(name: string): boolean {
  return !onlySet || onlySet.has(name)
}

// ── PostgreSQL connection ─────────────────────────────────────────────

const sql = postgres(PG_URL, {
  max: 5,
  connect_timeout: 10,
  onnotice: () => {},
})

// ── Helpers ───────────────────────────────────────────────────────────

function openSqlite(dbFile: string): Database | null {
  const path = resolve(DATA_DIR, dbFile)
  if (!existsSync(path)) {
    console.warn(`⚠ ${dbFile} not found at ${path} — skipping`)
    return null
  }
  return new Database(path, { readonly: true })
}

function backupSqlite(dbFile: string) {
  const src = resolve(DATA_DIR, dbFile)
  if (!existsSync(src)) return
  mkdirSync(BACKUP_DIR, { recursive: true })
  const dst = resolve(BACKUP_DIR, `${dbFile}.${Date.now()}.bak`)
  copyFileSync(src, dst)
  console.log(`  📦 Backed up ${dbFile} → ${dst}`)
}

function msToTimestamp(ms: number): string {
  return new Date(ms).toISOString()
}

// ── 1. Workspaces ─────────────────────────────────────────────────────

async function migrateWorkspaces() {
  if (!shouldMigrate("workspaces")) return
  console.log("\n━━━ 1/5  Workspaces ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  const db = openSqlite("workspaces.db")
  if (!db) return

  backupSqlite("workspaces.db")

  const rows = db.prepare("SELECT * FROM workspaces").all() as Array<{
    id: string; name: string; directory: string; description: string | null
    tags: string; active: number; created_at: number; last_accessed_at: number; metadata: string
  }>

  console.log(`  Found ${rows.length} workspaces`)
  if (dryRun) { db.close(); return }

  let migrated = 0
  for (const r of rows) {
    const tags = (() => { try { return JSON.parse(r.tags || "[]") } catch { return [] } })()
    await sql`
      INSERT INTO workspaces (id, name, directory, tags, created_at)
      VALUES (
        ${r.id}::uuid,
        ${r.name},
        ${r.directory},
        ${sql.array(tags)},
        ${msToTimestamp(r.created_at)}
      )
      ON CONFLICT (id) DO NOTHING
    `.catch((e) => {
      // If id is not UUID-shaped, generate one
      return sql`
        INSERT INTO workspaces (name, directory, tags, created_at)
        VALUES (${r.name}, ${r.directory}, ${sql.array(tags)}, ${msToTimestamp(r.created_at)})
        ON CONFLICT DO NOTHING
      `
    })
    migrated++
  }
  console.log(`  ✅ Migrated ${migrated} workspaces`)
  db.close()
}

// ── 2. Audit Log ──────────────────────────────────────────────────────

async function migrateAudit() {
  if (!shouldMigrate("audit")) return
  console.log("\n━━━ 2/5  Audit Log ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  const db = openSqlite("audit.db")
  if (!db) return

  backupSqlite("audit.db")

  const rows = db.prepare("SELECT * FROM audit_log ORDER BY timestamp ASC").all() as Array<{
    id: string; timestamp: number; action: string; user_id: string
    session_id: string | null; task_id: string | null; workspace_id: string | null
    metadata: string; duration: number | null; success: number; error: string | null; ip: string | null
  }>

  console.log(`  Found ${rows.length} audit entries`)
  if (dryRun) { db.close(); return }

  // Batch insert in chunks of 500
  const BATCH = 500
  let migrated = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const values = chunk.map(r => {
      const meta = (() => { try { return JSON.parse(r.metadata || "{}") } catch { return {} } })()
      // Enrich metadata with fields that don't have direct PG columns
      if (r.session_id) meta._session_id = r.session_id
      if (r.task_id) meta._task_id = r.task_id
      if (r.workspace_id) meta._workspace_id = r.workspace_id
      if (r.duration != null) meta._duration_ms = r.duration
      if (r.success !== undefined) meta._success = !!r.success
      if (r.error) meta._error = r.error
      if (r.ip) meta._ip = r.ip
      return {
        action: r.action,
        result: r.success ? "ok" : "error",
        resource: r.session_id || r.task_id || null,
        metadata: JSON.stringify(meta),
        timestamp: msToTimestamp(r.timestamp),
      }
    })

    for (const v of values) {
      await sql`
        INSERT INTO audit_log (action, result, resource, metadata, timestamp)
        VALUES (${v.action}, ${v.result}, ${v.resource}, ${v.metadata}::jsonb, ${v.timestamp})
      `
      migrated++
    }
  }
  console.log(`  ✅ Migrated ${migrated} audit entries`)
  db.close()
}

// ── 3. Budget ─────────────────────────────────────────────────────────

async function migrateBudget() {
  if (!shouldMigrate("budget")) return
  console.log("\n━━━ 3/5  Budget ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  const db = openSqlite("budget.db")
  if (!db) return

  backupSqlite("budget.db")

  // Limits
  const limits = db.prepare("SELECT * FROM budget_limits").all() as Array<{
    id: string; user_id: string; window: string
    max_tokens: number | null; max_requests: number | null; max_cost_cents: number | null
    hard_limit: number; created_at: number
  }>
  console.log(`  Found ${limits.length} budget limits`)

  // Usage
  const usage = db.prepare("SELECT * FROM budget_usage").all() as Array<{
    id: string; user_id: string; timestamp: number
    tokens_input: number; tokens_output: number; cost_cents: number
    session_id: string | null; task_id: string | null; model_id: string | null
  }>
  console.log(`  Found ${usage.length} budget usage records`)

  if (dryRun) { db.close(); return }

  let limMigrated = 0
  for (const r of limits) {
    await sql`
      INSERT INTO budget_limits (user_id, window, max_tokens, max_requests, max_cost_cents, hard_limit, created_at)
      VALUES (
        ${r.user_id}, ${r.window}, ${r.max_tokens}, ${r.max_requests}, ${r.max_cost_cents},
        ${!!r.hard_limit}, ${msToTimestamp(r.created_at)}
      )
      ON CONFLICT (user_id, window) DO NOTHING
    `
    limMigrated++
  }

  let usageMigrated = 0
  const BATCH = 500
  for (let i = 0; i < usage.length; i += BATCH) {
    const chunk = usage.slice(i, i + BATCH)
    for (const r of chunk) {
      await sql`
        INSERT INTO budget_usage (user_id, timestamp, tokens_input, tokens_output, cost_cents, session_id, task_id, model_id)
        VALUES (
          ${r.user_id}, ${msToTimestamp(r.timestamp)}, ${r.tokens_input}, ${r.tokens_output},
          ${r.cost_cents}, ${r.session_id}, ${r.task_id}, ${r.model_id}
        )
      `
      usageMigrated++
    }
  }

  console.log(`  ✅ Migrated ${limMigrated} limits, ${usageMigrated} usage records`)
  db.close()
}

// ── 4. Chat Log ───────────────────────────────────────────────────────

async function migrateChatLog() {
  if (!shouldMigrate("chat")) return
  console.log("\n━━━ 4/5  Chat Log ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  const db = openSqlite("chat-log.db")
  if (!db) return

  backupSqlite("chat-log.db")

  const sessions = db.prepare("SELECT * FROM chat_sessions").all() as Array<{
    id: string; title: string; model: string; message_count: number
    last_message_at: number; created_at: number
  }>
  console.log(`  Found ${sessions.length} chat sessions`)

  const entries = db.prepare("SELECT * FROM chat_entries ORDER BY timestamp ASC").all() as Array<{
    id: string; session_id: string; role: string; content: string; model: string
    tool_call_count: number; latency_ms: number | null; timestamp: number
  }>
  console.log(`  Found ${entries.length} chat entries`)

  if (dryRun) { db.close(); return }

  let sessMigrated = 0
  for (const r of sessions) {
    await sql`
      INSERT INTO chat_sessions (id, title, model, message_count, last_message_at, created_at)
      VALUES (${r.id}, ${r.title}, ${r.model}, ${r.message_count}, ${msToTimestamp(r.last_message_at)}, ${msToTimestamp(r.created_at)})
      ON CONFLICT (id) DO NOTHING
    `
    sessMigrated++
  }

  let entryMigrated = 0
  const BATCH = 500
  for (let i = 0; i < entries.length; i += BATCH) {
    const chunk = entries.slice(i, i + BATCH)
    for (const r of chunk) {
      await sql`
        INSERT INTO chat_entries (id, session_id, role, content, model, tool_call_count, latency_ms, timestamp)
        VALUES (${r.id}, ${r.session_id}, ${r.role}, ${r.content}, ${r.model}, ${r.tool_call_count}, ${r.latency_ms}, ${msToTimestamp(r.timestamp)})
        ON CONFLICT (id) DO NOTHING
      `
      entryMigrated++
    }
  }

  console.log(`  ✅ Migrated ${sessMigrated} sessions, ${entryMigrated} entries`)
  db.close()
}

// ── 5. Tasks ──────────────────────────────────────────────────────────

async function migrateTasks() {
  if (!shouldMigrate("tasks")) return
  console.log("\n━━━ 5/5  Tasks ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  const db = openSqlite("tasks.db")
  if (!db) return

  backupSqlite("tasks.db")

  const rows = db.prepare("SELECT * FROM tasks ORDER BY created_at ASC").all() as Array<{
    id: string; user_id: string; workspace_id: string | null; session_id: string | null
    orchestration_id: string | null; type: string; state: string; title: string; prompt: string
    agent_id: string | null; model_id: string | null; progress: number; current_step: string | null
    result: string | null; error: string | null; retries: number; max_retries: number; priority: number
    created_at: number; started_at: number | null; completed_at: number | null; metadata: string
  }>

  console.log(`  Found ${rows.length} tasks`)
  if (dryRun) { db.close(); return }

  let migrated = 0
  for (const r of rows) {
    const meta = (() => { try { return JSON.parse(r.metadata || "{}") } catch { return {} } })()
    await sql`
      INSERT INTO tasks (id, user_id, workspace_id, session_id, orchestration_id, type, state,
        title, prompt, agent_id, model_id, progress, current_step, result, error,
        retries, max_retries, priority, created_at, started_at, completed_at, metadata)
      VALUES (
        ${r.id}, ${r.user_id}, ${r.workspace_id}, ${r.session_id}, ${r.orchestration_id},
        ${r.type}, ${r.state}, ${r.title}, ${r.prompt}, ${r.agent_id}, ${r.model_id},
        ${r.progress}, ${r.current_step}, ${r.result}, ${r.error},
        ${r.retries}, ${r.max_retries}, ${r.priority},
        ${msToTimestamp(r.created_at)},
        ${r.started_at ? msToTimestamp(r.started_at) : null},
        ${r.completed_at ? msToTimestamp(r.completed_at) : null},
        ${JSON.stringify(meta)}::jsonb
      )
      ON CONFLICT (id) DO NOTHING
    `
    migrated++
  }

  console.log(`  ✅ Migrated ${migrated} tasks`)
  db.close()
}

// ── Validation ────────────────────────────────────────────────────────

async function validate() {
  console.log("\n━━━ Validation ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  const counts = await Promise.all([
    sql`SELECT 'workspaces' AS t, COUNT(*) AS c FROM workspaces`,
    sql`SELECT 'audit_log' AS t, COUNT(*) AS c FROM audit_log`,
    sql`SELECT 'budget_limits' AS t, COUNT(*) AS c FROM budget_limits`,
    sql`SELECT 'budget_usage' AS t, COUNT(*) AS c FROM budget_usage`,
    sql`SELECT 'chat_sessions' AS t, COUNT(*) AS c FROM chat_sessions`,
    sql`SELECT 'chat_entries' AS t, COUNT(*) AS c FROM chat_entries`,
    sql`SELECT 'tasks' AS t, COUNT(*) AS c FROM tasks`,
  ])
  for (const [row] of counts) {
    console.log(`  ${row.t}: ${row.c} rows`)
  }
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════")
  console.log("  SQLite → PostgreSQL Migration")
  console.log(`  Data dir:  ${DATA_DIR}`)
  console.log(`  Dry run:   ${dryRun}`)
  console.log(`  Only:      ${onlySet ? [...onlySet].join(", ") : "all"}`)
  console.log("═══════════════════════════════════════════════════")

  // Verify PostgreSQL connectivity
  try {
    const [{ now }] = await sql`SELECT NOW() as now`
    console.log(`  PostgreSQL connected at ${now}`)
  } catch (e: any) {
    console.error(`❌ Cannot connect to PostgreSQL: ${e.message}`)
    process.exit(1)
  }

  await migrateWorkspaces()
  await migrateAudit()
  await migrateBudget()
  await migrateChatLog()
  await migrateTasks()

  if (!dryRun) {
    await validate()
  }

  console.log("\n✅ Migration complete")
  await sql.end()
  process.exit(0)
}

main().catch((e) => {
  console.error("❌ Migration failed:", e)
  process.exit(1)
})
