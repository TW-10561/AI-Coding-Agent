// ---------------------------------------------------------------------------
// Task routes — /api/tasks
// Enqueue coding tasks and track their status through the task queue.
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import type { TaskQueue } from "../../services/task-queue"

const EnqueueBody = z.object({
  prompt: z.string().min(1),
  directory: z.string().min(1),
  agentID: z.string().optional(),
  modelID: z.string().optional(),
  providerID: z.string().optional(),
  sessionID: z.string().optional(),
})

export function taskRoutes(queue: TaskQueue) {
  return new Hono()

    // Enqueue a new task
    .post("/", async (c) => {
      const body = EnqueueBody.parse(await c.req.json())
      const userID = "default" // TODO: replace with real auth user
      const run = queue.enqueue({
        userID,
        prompt: body.prompt,
        directory: body.directory,
        agentID: body.agentID,
        modelID: body.modelID,
        providerID: body.providerID,
        sessionID: body.sessionID,
      })
      return c.json(run, 201)
    })

    // List tasks (all runs)
    .get("/", async (c) => {
      const status = c.req.query("status") as any
      const runs = queue.list({ status: status ?? undefined })
      return c.json(runs)
    })

    // Get task by ID
    .get("/:id", async (c) => {
      const run = queue.get(c.req.param("id"))
      if (!run) return c.json({ error: "not_found" }, 404)
      return c.json(run)
    })

    // Abort a running task
    .post("/:id/abort", async (c) => {
      const id = c.req.param("id")
      const run = queue.get(id)
      if (!run) return c.json({ error: "not_found" }, 404)
      if (run.status === "completed" || run.status === "failed") {
        return c.json({ error: "already_finished", status: run.status }, 400)
      }
      await queue.abort(id)
      return c.json({ aborted: true })
    })
}
