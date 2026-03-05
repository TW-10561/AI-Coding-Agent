// ---------------------------------------------------------------------------
// Queue routes — /api/queue
// Scalable queue management: enqueue, metrics, start/stop workers.
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import type { ScalableQueue } from "../../services/scalable-queue"

const EnqueueBody = z.object({
  title: z.string().min(1),
  prompt: z.string().min(1),
  workspaceID: z.string().optional(),
  priority: z.number().min(0).max(100).optional(),
  modelID: z.string().optional(),
  agentID: z.string().optional(),
  maxRetries: z.number().min(0).max(10).optional(),
})

export function queueRoutes(queue: ScalableQueue) {
  return new Hono()

    // Enqueue a job into the scalable queue
    .post("/", async (c) => {
      const body = EnqueueBody.parse(await c.req.json())
      const userID = "default" // TODO: replace with real auth user
      const task = queue.enqueue({
        userID,
        title: body.title,
        prompt: body.prompt,
        workspaceID: body.workspaceID,
        priority: body.priority,
        agentID: body.agentID,
        modelID: body.modelID,
        maxRetries: body.maxRetries,
      })
      return c.json(task, 201)
    })

    // Get queue metrics
    .get("/metrics", async (c) => {
      return c.json(queue.metrics())
    })

    // Start queue processing
    .post("/start", async (c) => {
      queue.start()
      return c.json({ started: true })
    })

    // Stop queue processing
    .post("/stop", async (c) => {
      await queue.stop()
      return c.json({ stopped: true })
    })
}
