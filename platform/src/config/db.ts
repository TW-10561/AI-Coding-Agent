// ---------------------------------------------------------------------------
// PostgreSQL connection — single shared pool for the platform
// ---------------------------------------------------------------------------
// Uses postgres.js (https://github.com/porsager/postgres) for its excellent
// Bun support, tagged-template query safety, and automatic connection pooling.
//
// Usage:
//   import { sql, dbReady } from "../config/db"
//   await dbReady                       // ensure connection is live
//   const rows = await sql`SELECT ...`  // parameterized, injection-safe
// ---------------------------------------------------------------------------

import postgres from "postgres"
import { env } from "./env"

// Resolve connection URL: prefer PgBouncer, fall back to direct Postgres
const connectionUrl = env.PGBOUNCER_URL ?? env.POSTGRES_URL

if (!connectionUrl) {
  console.warn("[db] POSTGRES_URL is not set — PostgreSQL features are disabled")
}

/** Shared SQL connection pool.  All queries go through this. */
export const sql = connectionUrl
  ? postgres(connectionUrl, {
      max: 20,                // max connections in pool
      idle_timeout: 30,       // close idle connections after 30 s
      connect_timeout: 10,    // give up connecting after 10 s
      onnotice: () => {},     // suppress NOTICE messages
    })
  : (null as unknown as postgres.Sql)

/** True when a POSTGRES_URL is configured and the pool is available. */
export const pgEnabled = !!connectionUrl

/**
 * Resolves when the database connection is verified.
 * Rejects if the connection fails after retries.
 */
export const dbReady: Promise<void> = pgEnabled
  ? (async () => {
      const maxRetries = 5
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await sql`SELECT 1`
          console.log(`[db] PostgreSQL connected (attempt ${attempt})`)
          return
        } catch (err) {
          console.warn(`[db] Connection attempt ${attempt}/${maxRetries} failed: ${err}`)
          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, 2000 * attempt))
          }
        }
      }
      throw new Error("[db] Failed to connect to PostgreSQL after retries")
    })()
  : Promise.resolve()

/**
 * Health check — returns table count and connection status.
 * Used by GET /health/db
 */
export async function dbHealth(): Promise<{
  status: "ok" | "degraded" | "unavailable"
  tables: number
  latencyMs: number
}> {
  if (!pgEnabled) {
    return { status: "unavailable", tables: 0, latencyMs: 0 }
  }
  const start = Date.now()
  try {
    const [{ count }] = await sql`
      SELECT COUNT(*)::int AS count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
    `
    return {
      status: count >= 14 ? "ok" : "degraded",
      tables: count,
      latencyMs: Date.now() - start,
    }
  } catch {
    return { status: "unavailable", tables: 0, latencyMs: Date.now() - start }
  }
}

/**
 * Graceful shutdown — drain all connections.
 * Call this on SIGTERM / SIGINT before process exit.
 */
export async function dbClose(): Promise<void> {
  if (pgEnabled) {
    await sql.end()
    console.log("[db] PostgreSQL connections closed")
  }
}
