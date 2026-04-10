// ---------------------------------------------------------------------------
// Provider routes — /api/providers
// Backed by our own provider-registry (no OpenCode dependency)
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import { buildRegistry } from "../../services/provider-registry"
import { SkillManager } from "../../services/skill-manager"

export function providerRoutes(skills: SkillManager) {
  return new Hono()
    .get("/", async (c) => {
      const registry = await buildRegistry()
      // Map to a shape similar to the old OpenCode response
      const all = [
        ...registry.local.map(p => ({
          id: p.id,
          name: p.name,
          type: "local" as const,
          status: p.status,
          models: p.models.map(m => m.id),
        })),
        ...registry.cloud.map(p => ({
          id: p.id,
          name: p.name,
          type: "cloud" as const,
          configured: p.configured,
          models: p.models.map(m => m.id),
        })),
      ]
      return c.json({ all, activeModel: registry.activeModel })
    })
    .get("/agents", async (c) => {
      // We are the agent — return a self-descriptor
      return c.json([
        { id: "thirdwave", name: "Thirdwave Agent", description: "Local agentic coding assistant" },
      ])
    })
    .get("/skills", async (c) => {
      return c.json(skills.listAll())
    })
    .put("/auth/:providerID", async (c) => {
      // API-key management is done via environment variables
      return c.json({ ok: false, message: "Set API keys via environment variables" }, 501)
    })
    .delete("/auth/:providerID", async (c) => {
      return c.json({ ok: false, message: "Remove API keys via environment variables" }, 501)
    })
}
