// ---------------------------------------------------------------------------
// Registry routes — /api/registry
// Artemis unified provider + model catalogue (local vLLM + cloud providers)
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import { buildRegistry } from "../../services/provider-registry"

export function registryRoutes() {
  return new Hono()

    /** GET /api/registry — full snapshot of local + cloud providers */
    .get("/", async (c) => {
      const force = c.req.query("refresh") === "true"
      const snapshot = await buildRegistry(force)
      return c.json(snapshot)
    })

    /** GET /api/registry/local — only local vLLM providers (with live status) */
    .get("/local", async (c) => {
      const snapshot = await buildRegistry()
      return c.json(snapshot.local)
    })

    /** GET /api/registry/cloud — only cloud providers */
    .get("/cloud", async (c) => {
      const snapshot = await buildRegistry()
      return c.json(snapshot.cloud)
    })

    /** POST /api/registry/refresh — force-invalidate cache and re-probe */
    .post("/refresh", async (c) => {
      const snapshot = await buildRegistry(true)
      return c.json({ ok: true, probed: snapshot.local.length, generatedAt: snapshot.generatedAt })
    })
}
