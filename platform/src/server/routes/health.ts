// ---------------------------------------------------------------------------
// Health route — /health
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import { dbHealth, pgEnabled } from "../../config/db"
import type { HealthStatus } from "../../types"

const startedAt = Date.now()

export function healthRoutes() {
  return new Hono()
    .get("/", async (c) => {
      const status: HealthStatus = {
        platform: "ok",
        opencode: "standalone",
        uptime: Date.now() - startedAt,
        version: "0.1.0",
      }
      return c.json(status, 200)
    })
    .get("/ready", async (c) => {
      return c.json({ ready: true, standalone: true })
    })
    // ── Database health (Phase 1) ─────────────────────────────────────
    .get("/db", async (c) => {
      const health = await dbHealth()
      const httpStatus = health.status === "ok" ? 200 : health.status === "degraded" ? 200 : 503
      return c.json(health, httpStatus)
    })
}
