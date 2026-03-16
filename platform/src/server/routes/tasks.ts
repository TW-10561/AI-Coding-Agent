// ---------------------------------------------------------------------------
// Task routes — /api/tasks
// Unified task listing that combines both legacy TaskQueue and ScalableQueue
// (TaskStateTracker) tasks. POST creates via the scalable queue; GET reads
// from both sources for backward compatibility.
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import type { TaskQueue } from "../../services/task-queue"
import type { ScalableQueue } from "../../services/scalable-queue"
import type { TaskStateTracker, TaskState } from "../../services/task-state-tracker"

const EnqueueBody = z.object({
  prompt: z.string().min(1),
  title: z.string().optional(),
  directory: z.string().optional(),
  workspaceID: z.string().optional(),
  agentID: z.string().optional(),
  modelID: z.string().optional(),
  providerID: z.string().optional(),
  sessionID: z.string().optional(),
  priority: z.number().min(0).max(100).optional(),
})

export function taskRoutes(
  queue: TaskQueue,
  scalableQueue: ScalableQueue,
  tracker: TaskStateTracker,
) {
  return new Hono()

    // Enqueue a new task — goes through scalable queue for persistence
    .post("/", async (c) => {
      const body = EnqueueBody.parse(await c.req.json())
      const userID = "default" // TODO: replace with real auth user
      const title = body.title ?? body.prompt.slice(0, 80).replace(/\n/g, " ")

      const task = scalableQueue.enqueue({
        userID,
        title,
        prompt: body.prompt,
        workspaceID: body.workspaceID ?? body.directory,
        agentID: body.agentID,
        modelID: body.modelID,
        priority: body.priority,
      })
      return c.json(task, 201)
    })

    // List tasks — reads from tracker (persistent) + legacy queue (in-memory)
    .get("/", async (c) => {
      const stateParam = c.req.query("state") ?? c.req.query("status")
      const limit = parseInt(c.req.query("limit") ?? "50", 10)
      const offset = parseInt(c.req.query("offset") ?? "0", 10)

      // Get tasks from the persistent tracker
      const tasks = tracker.list({
        state: (stateParam as TaskState) || undefined,
        limit: Math.min(limit, 200),
        offset,
      })

      // Also include any legacy in-memory runs (for backward compatibility)
      const legacyRuns = queue.list({ status: stateParam as any ?? undefined })
      const trackerIDs = new Set(tasks.map(t => t.id))

      // Convert legacy runs to a compatible format and merge
      const merged = [
        ...tasks,
        ...legacyRuns
          .filter(r => !trackerIDs.has(r.id))
          .map(r => ({
            id: r.id,
            userID: r.userID,
            type: "prompt" as const,
            state: (r.status === "queued" ? "queued" : r.status === "running" ? "running" : r.status === "completed" ? "completed" : r.status === "failed" ? "failed" : "aborted") as TaskState,
            title: r.prompt.slice(0, 80),
            prompt: r.prompt,
            sessionID: r.sessionID,
            progress: r.status === "completed" ? 100 : r.status === "running" ? 50 : 0,
            retries: 0,
            maxRetries: 0,
            priority: 5,
            createdAt: r.createdAt,
            completedAt: r.completedAt,
            error: r.error,
            metadata: {},
          })),
      ]

      return c.json(merged)
    })

    // Get queue stats (must come before /:id to avoid being matched as an ID)
    .get("/stats", async (c) => {
      return c.json(tracker.stats())
    })

    // Get task by ID — check tracker first, then legacy queue
    .get("/:id", async (c) => {
      const id = c.req.param("id")
      const task = tracker.get(id)
      if (task) return c.json(task)

      const legacyRun = queue.get(id)
      if (legacyRun) return c.json(legacyRun)

      return c.json({ error: "not_found" }, 404)
    })

    // Abort a task — try scalable queue first, then legacy
    .post("/:id/abort", async (c) => {
      const id = c.req.param("id")

      // Try scalable queue (persistent)
      const task = tracker.get(id)
      if (task) {
        if (task.state === "completed" || task.state === "failed" || task.state === "aborted") {
          return c.json({ error: "already_finished", state: task.state }, 400)
        }
        const ok = await scalableQueue.abort(id)
        if (!ok) return c.json({ error: "cannot_abort" }, 400)
        return c.json({ aborted: true })
      }

      // Try legacy queue
      const run = queue.get(id)
      if (!run) return c.json({ error: "not_found" }, 404)
      if (run.status === "completed" || run.status === "failed") {
        return c.json({ error: "already_finished", status: run.status }, 400)
      }
      await queue.abort(id)
      return c.json({ aborted: true })
    })
}
