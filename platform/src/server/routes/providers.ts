// ---------------------------------------------------------------------------
// Provider routes — /api/providers
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import { OpenCodeClient } from "../../services/opencode-client"

export function providerRoutes(client: OpenCodeClient) {
  return new Hono()
    .get("/", async (c) => {
      const providers = await client.providers()
      return c.json(providers)
    })
    .get("/agents", async (c) => {
      const agents = await client.agents()
      return c.json(agents)
    })
    .get("/skills", async (c) => {
      const skills = await client.skills()
      return c.json(skills)
    })
    .put("/auth/:providerID", async (c) => {
      const body = await c.req.json()
      const result = await client.setAuth(c.req.param("providerID"), body)
      return c.json({ ok: result })
    })
    .delete("/auth/:providerID", async (c) => {
      const result = await client.removeAuth(c.req.param("providerID"))
      return c.json({ ok: result })
    })
}
