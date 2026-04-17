// ---------------------------------------------------------------------------
// Parallel routes — /api/parallel
// Parallel execution management: execute plans, track progress, cancel.
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import type { ParallelExecutionManager } from "../../services/parallel-executor"

const PlanBody = z.object({
  name: z.string().min(1),
  tasks: z.array(z.object({
    label: z.string(),
    agentID: z.string().optional(),
    prompt: z.string(),
    dependsOn: z.array(z.string()).optional(),
    timeoutMs: z.number().optional(),
  })),
  concurrency: z.number().optional(),
  timeoutMs: z.number().optional(),
  fanInPrompt: z.string().optional(),
  workspaceID: z.string().optional(),
})

export function parallelRoutes(executor: ParallelExecutionManager) {
  return new Hono()

    // Execute a parallel plan
    .post("/", async (c) => {
      const body = PlanBody.parse(await c.req.json())
      const user = (c.var as any).user || {}
      const userID = user.sub || "default"

      const exec = await executor.execute({
        name: body.name,
        userID,
        workspaceID: body.workspaceID,
        concurrency: body.concurrency,
        timeoutMs: body.timeoutMs,
        fanInPrompt: body.fanInPrompt,
        tasks: body.tasks.map((t) => ({
          label: t.label,
          agentID: t.agentID,
          prompt: t.prompt,
          dependsOn: t.dependsOn ?? [],
          timeoutMs: t.timeoutMs,
        })),
      })
      return c.json(exec, 201)
    })

    // List all parallel executions
    .get("/", async (c) => {
      const status = c.req.query("status") as any
      const user = (c.var as any).user || {}
      const userID = user.sub || undefined
      return c.json(executor.list({ status: status ?? undefined, userID }))
    })

    // List ad-hoc parallel tool executions from the agent loop
    .get("/tool-executions", async (c) => {
      const limit = Number(c.req.query("limit") ?? 50)
      return c.json(executor.listToolExecutions(limit))
    })

    // Get a specific execution
    .get("/:id", async (c) => {
      const exec = executor.get(c.req.param("id"))
      if (!exec) return c.json({ error: "not_found" }, 404)
      return c.json(exec)
    })

    // Get execution progress
    .get("/:id/progress", async (c) => {
      const exec = executor.get(c.req.param("id"))
      if (!exec) return c.json({ error: "not_found" }, 404)
      return c.json(executor.progress(c.req.param("id")))
    })

    // Cancel an execution
    .post("/:id/cancel", async (c) => {
      const ok = await executor.cancel(c.req.param("id"))
      if (!ok) return c.json({ error: "cannot_cancel" }, 400)
      return c.json({ cancelled: true })
    })
}
