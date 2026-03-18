// ---------------------------------------------------------------------------
// HITL routes — /api/hitl
// Human-in-the-Loop approval workflow API
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import type { HITLService } from "../../services/hitl-service"

const EvalBody = z.object({
  action: z.string().min(1),
  command: z.string().optional(),
  filePath: z.string().optional(),
  url: z.string().optional(),
  role: z.enum(["admin", "developer", "readonly", "autonomous_agent"]).optional(),
  permission: z.enum(["bash", "edit", "read", "webfetch", "external_directory", "skill"]).optional(),
  agentName: z.string().optional(),
  skillName: z.string().optional(),
  isDelete: z.boolean().optional(),
  diffSize: z.number().optional(),
  description: z.string().optional(),
})

const ResolveBody = z.object({
  decision: z.enum(["approved", "denied"]),
  resolvedBy: z.string().optional(),
})

const AutonomyBody = z.object({
  agentName: z.string().min(1),
  mode: z.enum(["supervised", "semi_autonomous", "fully_autonomous"]),
})

export function hitlRoutes(hitl: HITLService) {
  return new Hono()

    // Evaluate an action — returns allow/ask/deny
    .post("/evaluate", async (c) => {
      const body = EvalBody.parse(await c.req.json())
      const result = hitl.evaluate(body)
      return c.json(result)
    })

    // Get all pending approval requests
    .get("/pending", async (c) => {
      return c.json(hitl.getPending())
    })

    // Get a specific approval request
    .get("/request/:id", async (c) => {
      const req = hitl.getRequest(c.req.param("id"))
      if (!req) return c.json({ error: "not_found" }, 404)
      return c.json(req)
    })

    // Approve or deny a pending request
    .post("/resolve/:id", async (c) => {
      const { decision, resolvedBy } = ResolveBody.parse(await c.req.json())
      const result = hitl.resolve(c.req.param("id"), decision, resolvedBy)
      if (!result) return c.json({ error: "not_found_or_expired" }, 404)
      return c.json(result)
    })

    // Get all requests (pending + resolved)
    .get("/all", async (c) => {
      const limit = parseInt(c.req.query("limit") ?? "100", 10)
      return c.json(hitl.getAll(Math.min(limit, 500)))
    })

    // Get resolved requests history
    .get("/resolved", async (c) => {
      const limit = parseInt(c.req.query("limit") ?? "50", 10)
      return c.json(hitl.getResolved(Math.min(limit, 200)))
    })

    // Get HITL stats
    .get("/stats", async (c) => {
      return c.json(hitl.getStats())
    })

    // Set agent autonomy mode
    .put("/autonomy", async (c) => {
      const body = AutonomyBody.parse(await c.req.json())
      hitl.setAutonomyMode(body.agentName, body.mode)
      return c.json({ ok: true, agentName: body.agentName, mode: body.mode })
    })
}
