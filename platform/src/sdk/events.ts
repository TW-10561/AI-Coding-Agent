// ---------------------------------------------------------------------------
// Platform SDK — SSE event source helper
// ---------------------------------------------------------------------------

import type { PlatformEvent } from "../types"

export type EventHandler = (event: PlatformEvent) => void

/**
 * Thin wrapper around EventSource for the platform SSE stream.
 *
 * Usage:
 * ```ts
 * const events = new PlatformEventSource("http://localhost:3100", "my-api-key")
 * events.on("session.updated", (e) => console.log(e))
 * events.onAny((e) => console.log(e.type, e))
 * events.close()
 * ```
 */
export class PlatformEventSource {
  private es: EventSource
  private handlers = new Map<string, Set<EventHandler>>()
  private anyHandlers = new Set<EventHandler>()

  constructor(baseUrl: string, apiKey?: string) {
    const url = new URL("/api/events", baseUrl)
    if (apiKey) url.searchParams.set("token", apiKey)
    this.es = new EventSource(url.toString())

    this.es.onmessage = (raw) => {
      try {
        const event: PlatformEvent = JSON.parse(raw.data)
        event.timestamp = event.timestamp ?? Date.now()

        // Dispatch to specific handlers
        const specific = this.handlers.get(event.type)
        if (specific) {
          for (const h of specific) h(event)
        }

        // Dispatch to catch-all handlers
        for (const h of this.anyHandlers) h(event)
      } catch {}
    }
  }

  /** Subscribe to a specific event type */
  on(type: string, handler: EventHandler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(handler)
    return () => this.handlers.get(type)?.delete(handler)
  }

  /** Subscribe to all events */
  onAny(handler: EventHandler): () => void {
    this.anyHandlers.add(handler)
    return () => this.anyHandlers.delete(handler)
  }

  /** Close the connection */
  close() {
    this.es.close()
    this.handlers.clear()
    this.anyHandlers.clear()
  }

  /** Connection readyState (0=CONNECTING, 1=OPEN, 2=CLOSED) */
  get readyState() {
    return this.es.readyState
  }
}
