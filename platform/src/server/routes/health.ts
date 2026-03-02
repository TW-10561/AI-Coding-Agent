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
      const code = oc.ok ? 200 : 503
      return c.json(status, code)
    })
    .get("/ready", async (c) => {
      const oc = await client.health()
      if (!oc.ok) return c.json({ ready: false }, 503)
      return c.json({ ready: true })
    })
}
