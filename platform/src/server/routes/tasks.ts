// ---------------------------------------------------------------------------
// Task routes — /api/tasks
// Platform-level job queue for async coding tasks
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import { TaskQueue } from "../../services/task-queue"

const EnqueueBody = z.object({
  prompt: z.string().min(1),
  directory: z.string().optional(),
  agentID: z.string().optional(),
  modelID: z.string().optional(),
  providerID: z.string().optional(),
  sessionID: z.string().optional(),
})

export function taskRoutes(queue: TaskQueue) {
  return new Hono()
    // Enqueue a task
    .post("/", async (c) => {
      const body = EnqueueBody.parse(await c.req.json())
      const run = queue.enqueue({
        userID: "default", // replace with real auth user
        prompt: body.prompt,
        directory: body.directory ?? process.cwd(),
        agentID: body.agentID,
        modelID: body.modelID,
        providerID: body.providerID,
        sessionID: body.sessionID,
      })
      return c.json(run, 201)
    })

    // List tasks
    .get("/", async (c) => {
      const status = c.req.query("status") as any
      const runs = queue.list({ status: status ?? undefined })
      return c.json(runs)
    })

    // Get single task
    .get("/:id", async (c) => {
      const run = queue.get(c.req.param("id"))
      if (!run) return c.json({ error: "not_found" }, 404)
      return c.json(run)
    })

    // Abort task
    .post("/:id/abort", async (c) => {
      const ok = await queue.abort(c.req.param("id"))
      if (!ok) return c.json({ error: "cannot_abort" }, 400)
      return c.json({ aborted: true })
    })
}
