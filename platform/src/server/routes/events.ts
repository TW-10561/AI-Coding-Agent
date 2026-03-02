// ---------------------------------------------------------------------------
// Event routes — /api/events
// SSE proxy from OpenCode bus events → platform clients
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { OpenCodeClient } from "../../services/opencode-client"
import { TaskQueue } from "../../services/task-queue"

export function eventRoutes(client: OpenCodeClient, queue: TaskQueue) {
  return new Hono().get("/", async (c) => {
    c.header("X-Accel-Buffering", "no")
    c.header("X-Content-Type-Options", "nosniff")

    return streamSSE(c, async (stream) => {
      // 1. Forward all OpenCode bus events
      const unsub = client.subscribe((event) => {
        stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        })
      })

      // 2. Forward task queue updates
      const unsubTasks = queue.onUpdate((run) => {
        stream.writeSSE({
          event: "task.updated",
          data: JSON.stringify({ type: "task.updated", properties: run, timestamp: Date.now() }),
        })
      })

      // 3. Heartbeat
      const heartbeat = setInterval(() => {
        stream.writeSSE({
          event: "heartbeat",
          data: JSON.stringify({ type: "heartbeat", timestamp: Date.now() }),
        })
      }, 15_000)

      // Send connected event
      stream.writeSSE({
        event: "connected",
        data: JSON.stringify({ type: "platform.connected", timestamp: Date.now() }),
      })

      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(heartbeat)
          unsub()
          unsubTasks()
          resolve()
        })
      })
    })
  })
}
