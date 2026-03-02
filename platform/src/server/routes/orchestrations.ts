// ---------------------------------------------------------------------------
// Orchestration routes — /api/orchestrations
// Multi-agent orchestration management
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import type { SubagentOrchestrator } from "../../services/subagent-orchestrator"

const PlanBody = z.object({
  name: z.string().min(1),
  tasks: z.array(z.object({
    label: z.string(),
    agentID: z.string().optional(),
    prompt: z.string(),
    dependsOn: z.array(z.string()).optional(),
    retries: z.number().optional(),
  })),
  maxConcurrency: z.number().optional(),
})

export function orchestrationRoutes(orchestrator: SubagentOrchestrator) {
  return new Hono()
    // Start an orchestration
    .post("/", async (c) => {
      const body = PlanBody.parse(await c.req.json())
      const orch = await orchestrator.start({
        name: body.name,
        userID: "default",
        tasks: body.tasks.map((t) => ({
          agentID: t.agentID ?? "default",
          prompt: t.prompt,
          dependsOn: t.dependsOn,
          maxRetries: t.retries,
        })),
      })
      return c.json(orch, 201)
    })

    // List orchestrations
    .get("/", async (c) => {
      const status = c.req.query("status") as any
      return c.json(orchestrator.list({
        status: status ?? undefined,
      }))
    })

    // Get orchestration by ID
    .get("/:id", async (c) => {
      const orch = orchestrator.get(c.req.param("id"))
      if (!orch) return c.json({ error: "not_found" }, 404)
      return c.json(orch)
    })

    // Cancel orchestration
    .post("/:id/cancel", async (c) => {
      const ok = await orchestrator.cancel(c.req.param("id"))
      if (!ok) return c.json({ error: "cannot_cancel" }, 400)
      return c.json({ cancelled: true })
    })
}
