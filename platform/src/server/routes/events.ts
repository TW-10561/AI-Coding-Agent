// ---------------------------------------------------------------------------
// Event routes — /api/events
// SSE bus for platform events → clients
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { TaskQueue } from "../../services/task-queue"

// Module-level event bus so any service can emit events
type PlatformEvent = { type: string; [key: string]: unknown }
type EventCB = (ev: PlatformEvent) => void
const _listeners = new Set<EventCB>()
export function emitPlatformEvent(ev: PlatformEvent) {
  for (const cb of _listeners) cb(ev)
}

export function eventRoutes(queue: TaskQueue) {
  return new Hono().get("/", async (c) => {
    c.header("X-Accel-Buffering", "no")
    c.header("X-Content-Type-Options", "nosniff")

    return streamSSE(c, async (stream) => {
      // 1. Forward platform-level events
      const onEvent: EventCB = (event) => {
        stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
        }).catch(() => {})
      }
      _listeners.add(onEvent)

      // 2. Forward task queue updates
      const unsubTasks = queue.onUpdate((run) => {
        stream.writeSSE({
          event: "task.updated",
          data: JSON.stringify({ type: "task.updated", properties: run, timestamp: Date.now() }),
        }).catch(() => {})
      })

      // 3. Heartbeat
      const heartbeat = setInterval(() => {
        stream.writeSSE({
          event: "heartbeat",
          data: JSON.stringify({ type: "heartbeat", timestamp: Date.now() }),
        }).catch(() => {})
      }, 15_000)

      // Send connected event
      stream.writeSSE({
        event: "connected",
        data: JSON.stringify({ type: "platform.connected", timestamp: Date.now() }),
      }).catch(() => {})

      await new Promise<void>((resolve) => {
        stream.onAbort(() => {
          clearInterval(heartbeat)
          _listeners.delete(onEvent)
          unsubTasks()
          resolve()
        })
      })
    })
  })
}
