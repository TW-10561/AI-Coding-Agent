// ---------------------------------------------------------------------------
// Registry routes — /api/registry
// Thirdwave unified provider + model catalogue (local vLLM + cloud providers)
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

    /** GET /api/registry/status — compact model fleet status summary */
    .get("/status", async (c) => {
      const snapshot = await buildRegistry()
      const online  = snapshot.local.filter(p => p.status === "online")
      const offline = snapshot.local.filter(p => p.status === "offline")
      const totalModels = online.reduce((n, p) => n + p.models.length, 0)
      const cloudConfigured = snapshot.cloud.filter(p => p.configured).length
      return c.json({
        online:  online.length,
        offline: offline.length,
        totalModels,
        cloudConfigured,
        cloudTotal: snapshot.cloud.length,
        activeModel: snapshot.activeModel,
        generatedAt: snapshot.generatedAt,
        providers: snapshot.local.map(p => ({
          id: p.id,
          name: p.name,
          status: p.status,
          latencyMs: p.latencyMs,
          modelCount: p.models.length,
        })),
      })
    })

    /** POST /api/registry/cloud/:id/key — store API key for a cloud provider */
    .post("/cloud/:id/key", async (c) => {
      const providerID = c.req.param("id")
      const body = await c.req.json().catch(() => ({}))
      const apiKey = (body as any).apiKey
      if (!apiKey || typeof apiKey !== "string") {
        return c.json({ error: "apiKey is required" }, 400)
      }
      // Store the key as an environment variable for this process
      // Look up the env var name from the cloud catalogue
      const snapshot = await buildRegistry()
      const provider = snapshot.cloud.find((p: any) => p.id === providerID)
      if (!provider) {
        return c.json({ error: `Unknown provider: ${providerID}` }, 404)
      }
      const envVar = (provider as any).keyEnvVar
      if (envVar) {
        process.env[envVar] = apiKey
      }
      // Rebuild the registry so the provider shows as configured
      await buildRegistry(true)
      return c.json({ ok: true, provider: providerID, envVar })
    })
}
