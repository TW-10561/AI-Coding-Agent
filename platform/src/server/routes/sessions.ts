// ---------------------------------------------------------------------------
// Session routes — /api/sessions
// Thin mapping from platform REST API → OpenCode server
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import { OpenCodeClient } from "../../services/opencode-client"

const PromptBody = z.object({
  content: z.string().min(1),
  agentID: z.string().optional(),
  modelID: z.string().optional(),
  providerID: z.string().optional(),
  attachments: z
    .array(z.object({ filename: z.string(), url: z.string(), mediaType: z.string() }))
    .optional(),
})

const CreateBody = z.object({
  parentID: z.string().optional(),
  title: z.string().optional(),
  agentID: z.string().optional(),
}).optional()

export function sessionRoutes(client: OpenCodeClient) {
  return new Hono()
    // List sessions
    .get("/", async (c) => {
      const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined
      const search = c.req.query("search")
      const sessions = await client.sessions({ limit, search: search ?? undefined })
      return c.json(sessions)
    })

    // Get session status (all sessions)
    .get("/status", async (c) => {
      const status = await client.sessionStatus()
      return c.json(status)
    })

    // Get single session
    .get("/:id", async (c) => {
      const session = await client.session(c.req.param("id"))
      return c.json(session)
    })

    // Create session
    .post("/", async (c) => {
      const body = CreateBody.parse(await c.req.json().catch(() => undefined))
      const session = await client.createSession(body ?? undefined)
      return c.json(session, 201)
    })

    // Delete session
    .delete("/:id", async (c) => {
      await client.deleteSession(c.req.param("id"))
      return c.json({ deleted: true })
    })

    // Abort session
    .post("/:id/abort", async (c) => {
      await client.abortSession(c.req.param("id"))
      return c.json({ aborted: true })
    })

    // Fork session
    .post("/:id/fork", async (c) => {
      const body = await c.req.json().catch(() => ({}))
      const session = await client.forkSession(c.req.param("id"), body?.messageID)
      return c.json(session, 201)
    })

    // Summarize / compact
    .post("/:id/summarize", async (c) => {
      await client.summarizeSession(c.req.param("id"))
      return c.json({ summarized: true })
    })

    // ── Messages ──────────────────────────────────────────────────

    // List messages
    .get("/:id/messages", async (c) => {
      const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined
      const messages = await client.messages(c.req.param("id"), { limit })
      return c.json(messages)
    })

    // Get single message
    .get("/:id/messages/:messageID", async (c) => {
      const msg = await client.message(c.req.param("id"), c.req.param("messageID"))
      return c.json(msg)
    })

    // Send prompt (blocking, returns full response)
    .post("/:id/messages", async (c) => {
      const body = PromptBody.parse(await c.req.json())
      const result = await client.prompt(c.req.param("id"), body)
      return c.json(result)
    })

    // Send prompt (fire-and-forget)
    .post("/:id/messages/async", async (c) => {
      const body = PromptBody.parse(await c.req.json())
      await client.promptAsync(c.req.param("id"), body)
      return c.body(null, 204)
    })

    // Stream prompt (SSE pass-through)
    .post("/:id/messages/stream", async (c) => {
      const body = PromptBody.parse(await c.req.json())
      const stream = await client.promptStream(c.req.param("id"), body)
      return new Response(stream, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      })
    })

    // Delete message
    .delete("/:id/messages/:messageID", async (c) => {
      await client.deleteMessage(c.req.param("id"), c.req.param("messageID"))
      return c.json({ deleted: true })
    })

    // Revert / unrevert
    .post("/:id/revert", async (c) => {
      const session = await client.revert(c.req.param("id"))
      return c.json(session)
    })
    .post("/:id/unrevert", async (c) => {
      const session = await client.unrevert(c.req.param("id"))
      return c.json(session)
    })
}
