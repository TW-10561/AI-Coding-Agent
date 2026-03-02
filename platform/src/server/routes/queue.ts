// ---------------------------------------------------------------------------
// Queue routes — /api/queue
// Scalable task queue management
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import type { ScalableQueue } from "../../services/scalable-queue"

const EnqueueBody = z.object({
  prompt: z.string().min(1),
  directory: z.string().optional(),
  agentID: z.string().optional(),
  modelID: z.string().optional(),
  providerID: z.string().optional(),
  sessionID: z.string().optional(),
  workspaceID: z.string().optional(),
  priority: z.number().optional(),
})

export function queueRoutes(queue: ScalableQueue) {
  return new Hono()
    // Enqueue a task
    .post("/", async (c) => {
      const body = EnqueueBody.parse(await c.req.json())
      const task = await queue.enqueue({
        userID: "default",
        prompt: body.prompt,
        directory: body.directory ?? process.cwd(),
        agentID: body.agentID,
        modelID: body.modelID,
        providerID: body.providerID,
        sessionID: body.sessionID,
        workspaceID: body.workspaceID,
        priority: body.priority,
      })
      return c.json(task, 201)
    })

    // Queue metrics
    .get("/metrics", async (c) => {
      return c.json(queue.metrics())
    })

    // Start the queue (admin)
    .post("/start", async (c) => {
      queue.start()
      return c.json({ started: true })
    })

    // Stop the queue (admin)
    .post("/stop", async (c) => {
      await queue.stop()
      return c.json({ stopped: true })
    })
}
