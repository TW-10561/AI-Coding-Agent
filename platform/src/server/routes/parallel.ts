// ---------------------------------------------------------------------------
// Parallel execution routes — /api/parallel
// Fan-out/fan-in parallel task execution
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import type { ParallelExecutionManager } from "../../services/parallel-executor"

const PlanBody = z.object({
  name: z.string().min(1),
  concurrency: z.number().optional(),
  timeoutMs: z.number().optional(),
  fanInPrompt: z.string().optional(),
  tasks: z.array(z.object({
    label: z.string(),
    agentID: z.string().optional(),
    prompt: z.string(),
    dependsOn: z.array(z.string()).optional(),
    timeoutMs: z.number().optional(),
  })),
})

export function parallelRoutes(executor: ParallelExecutionManager) {
  return new Hono()
    // Execute a parallel plan
    .post("/", async (c) => {
      const body = PlanBody.parse(await c.req.json())
      const exec = await executor.execute({
        name: body.name,
        userID: "default",
        concurrency: body.concurrency,
        timeoutMs: body.timeoutMs,
        fanInPrompt: body.fanInPrompt,
        tasks: body.tasks,
      })
      return c.json(exec, 201)
    })

    // List executions
    .get("/", async (c) => {
      const status = c.req.query("status") as any
      const userID = c.req.query("userID")
      return c.json(executor.list({
        status: status ?? undefined,
        userID: userID ?? undefined,
      }))
    })

    // Get execution by ID
    .get("/:id", async (c) => {
      const exec = executor.get(c.req.param("id"))
      if (!exec) return c.json({ error: "not_found" }, 404)
      return c.json(exec)
    })

    // Get execution progress
    .get("/:id/progress", async (c) => {
      return c.json(executor.progress(c.req.param("id")))
    })

    // Cancel execution
    .post("/:id/cancel", async (c) => {
      const ok = await executor.cancel(c.req.param("id"))
      if (!ok) return c.json({ error: "cannot_cancel" }, 400)
      return c.json({ cancelled: true })
    })
}
