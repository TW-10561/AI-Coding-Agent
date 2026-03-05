// ---------------------------------------------------------------------------
// Health route — /health
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import { OpenCodeClient } from "../../services/opencode-client"
import type { HealthStatus } from "../../types"

const startedAt = Date.now()

export function healthRoutes(client: OpenCodeClient) {
  return new Hono()
    .get("/", async (c) => {
      const oc = await client.health()
      const status: HealthStatus = {
        platform: "ok",
        opencode: oc.ok ? "ok" : "unreachable",
        uptime: Date.now() - startedAt,
        version: "0.1.0",
      }
      // Platform is always healthy if it can respond; OpenCode being down is degraded, not failed
      return c.json(status, 200)
    })
    .get("/ready", async (c) => {
      const oc = await client.health()
      // Ready means platform is up; OpenCode is optional
      return c.json({ ready: true, opencode: oc.ok })
    })
}
