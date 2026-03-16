// ---------------------------------------------------------------------------
// Queue routes — /api/queue
// Scalable queue management: enqueue, list, abort, metrics, start/stop workers.
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import type { ScalableQueue } from "../../services/scalable-queue"
import type { TaskStateTracker, TaskState } from "../../services/task-state-tracker"

const EnqueueBody = z.object({
  title: z.string().min(1).optional(),
  prompt: z.string().min(1),
  workspaceID: z.string().optional(),
  priority: z.number().min(0).max(100).optional(),
  modelID: z.string().optional(),
  agentID: z.string().optional(),
  maxRetries: z.number().min(0).max(10).optional(),
})

export function queueRoutes(queue: ScalableQueue, tracker: TaskStateTracker) {
  return new Hono()

    // Enqueue a job into the scalable queue
    .post("/", async (c) => {
      const body = EnqueueBody.parse(await c.req.json())
      const userID = "default" // TODO: replace with real auth user
      const title = body.title ?? body.prompt.slice(0, 80).replace(/\n/g, " ")
      const task = queue.enqueue({
        userID,
        title,
        prompt: body.prompt,
        workspaceID: body.workspaceID,
        priority: body.priority,
        agentID: body.agentID,
        modelID: body.modelID,
        maxRetries: body.maxRetries,
      })
      return c.json(task, 201)
    })

    // List tasks in the queue (with optional state filter)
    .get("/", async (c) => {
      const state = c.req.query("state") as TaskState | undefined
      const limit = parseInt(c.req.query("limit") ?? "50", 10)
      const offset = parseInt(c.req.query("offset") ?? "0", 10)
      const tasks = tracker.list({
        state: state || undefined,
        limit: Math.min(limit, 200),
        offset,
      })
      const stats = tracker.stats()
      return c.json({ tasks, stats, count: tasks.length })
    })

    // Get queue metrics
    .get("/metrics", async (c) => {
      return c.json(queue.metrics())
    })

    // Get a specific task by ID
    .get("/:id", async (c) => {
      const task = tracker.get(c.req.param("id"))
      if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404)
      return c.json(task)
    })

    // Abort a task
    .post("/:id/abort", async (c) => {
      const id = c.req.param("id")
      const task = tracker.get(id)
      if (!task) return c.json({ error: "not_found", message: "Task not found" }, 404)
      if (task.state === "completed" || task.state === "failed" || task.state === "aborted") {
        return c.json({ error: "already_finished", state: task.state }, 400)
      }
      const ok = await queue.abort(id)
      if (!ok) return c.json({ error: "cannot_abort" }, 400)
      return c.json({ aborted: true, taskID: id })
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

    // Clean up old completed/failed tasks
    .post("/cleanup", async (c) => {
      const olderThanMs = parseInt(c.req.query("olderThanMs") ?? String(7 * 24 * 60 * 60 * 1000), 10)
      const deleted = tracker.cleanup(olderThanMs)
      return c.json({ deleted })
    })
}
