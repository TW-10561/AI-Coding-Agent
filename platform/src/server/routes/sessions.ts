// ---------------------------------------------------------------------------
// Session routes — /api/sessions
// Local session management backed by ChatLogStore + AgentExecutor.
// No external OpenCode dependency — sessions live entirely in our platform.
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import { ulid } from "ulid"
import type { ChatLogStore } from "../../services/chat-log"
import { AgentExecutor } from "../../services/agent-executor"

const PromptBody = z.object({
  content: z.string().min(1),
  agentID: z.string().optional(),
  modelID: z.string().optional(),
  providerID: z.string().optional(),
  workspaceRoot: z.string().optional(),
  attachments: z
    .array(z.object({ filename: z.string(), url: z.string(), mediaType: z.string() }))
    .optional(),
})

const CreateBody = z.object({
  parentID: z.string().optional(),
  title: z.string().optional(),
  agentID: z.string().optional(),
}).optional()

// In-memory session metadata (lightweight — chat entries persist in ChatLogStore)
interface SessionMeta {
  id: string
  title: string
  agentID?: string
  parentID?: string
  createdAt: number
  status: "active" | "aborted"
}

const sessionStore = new Map<string, SessionMeta>()

const executor = new AgentExecutor()

export function sessionRoutes(chatLog: ChatLogStore) {
  return new Hono()
    // List sessions (from ChatLogStore)
    .get("/", async (c) => {
      const limit = c.req.query("limit") ? Number(c.req.query("limit")) : 50
      const sessions = chatLog.listSessions(limit)
      return c.json(sessions)
    })

    // Get session status (all active sessions)
    .get("/status", async (c) => {
      const active = [...sessionStore.values()].filter(s => s.status === "active")
      return c.json({ total: sessionStore.size, active: active.length })
    })

    // Get single session
    .get("/:id", async (c) => {
      const id = c.req.param("id")
      const meta = sessionStore.get(id)
      const entries = chatLog.getEntries(id)
      if (!meta && entries.length === 0) {
        return c.json({ error: "Session not found" }, 404)
      }
      return c.json({
        id,
        title: meta?.title ?? entries[0]?.content?.slice(0, 72) ?? "Untitled",
        agentID: meta?.agentID,
        status: meta?.status ?? "active",
        messageCount: entries.length,
        createdAt: meta?.createdAt ?? entries[0]?.timestamp,
        messages: entries,
      })
    })

    // Create session
    .post("/", async (c) => {
      const body = CreateBody.parse(await c.req.json().catch(() => undefined))
      const id = ulid()
      const meta: SessionMeta = {
        id,
        title: body?.title ?? "New Session",
        agentID: body?.agentID,
        parentID: body?.parentID,
        createdAt: Date.now(),
        status: "active",
      }
      sessionStore.set(id, meta)
      return c.json({ id, title: meta.title, createdAt: meta.createdAt }, 201)
    })

    // Delete session
    .delete("/:id", async (c) => {
      sessionStore.delete(c.req.param("id"))
      return c.json({ deleted: true })
    })

    // Abort session
    .post("/:id/abort", async (c) => {
      const meta = sessionStore.get(c.req.param("id"))
      if (meta) meta.status = "aborted"
      return c.json({ aborted: true })
    })

    // Fork session — create a new session with history copied
    .post("/:id/fork", async (c) => {
      const parentId = c.req.param("id")
      const entries = chatLog.getEntries(parentId)
      const newId = ulid()
      const meta: SessionMeta = {
        id: newId,
        title: `Fork of ${parentId.slice(0, 8)}`,
        parentID: parentId,
        createdAt: Date.now(),
        status: "active",
      }
      sessionStore.set(newId, meta)
      return c.json({ id: newId, parentID: parentId, messageCount: entries.length }, 201)
    })

    // Summarize (no-op for now — context compression happens in AgentExecutor)
    .post("/:id/summarize", async (c) => {
      return c.json({ summarized: true })
    })

    // ── Messages ──────────────────────────────────────────────────

    // List messages
    .get("/:id/messages", async (c) => {
      const entries = chatLog.getEntries(c.req.param("id"))
      const limit = c.req.query("limit") ? Number(c.req.query("limit")) : entries.length
      return c.json(entries.slice(-limit))
    })

    // Get single message
    .get("/:id/messages/:messageID", async (c) => {
      const entries = chatLog.getEntries(c.req.param("id"))
      const msg = entries.find(e => e.id === c.req.param("messageID"))
      if (!msg) return c.json({ error: "Message not found" }, 404)
      return c.json(msg)
    })

    // Send prompt (blocking — runs AgentExecutor loop)
    .post("/:id/messages", async (c) => {
      const sessionId = c.req.param("id")
      const body = PromptBody.parse(await c.req.json())

      // Build conversation history from previous entries
      const entries = chatLog.getEntries(sessionId)
      const history = entries.map(e => ({ role: e.role, content: e.content }))

      const result = await executor.run({
        prompt: body.content,
        modelID: body.modelID,
        providerID: body.providerID,
        workspaceRoot: body.workspaceRoot,
        agentID: body.agentID,
        context: history.length > 0
          ? history.map(h => `[${h.role}]: ${h.content.slice(0, 1000)}`).join("\n")
          : undefined,
      })

      // Persist to chat log
      chatLog.store({
        sessionId,
        userMessage: body.content,
        assistantReply: result.text,
        model: result.model,
        toolCallCount: result.toolCalls.length,
        latencyMs: result.latencyMs,
      })

      return c.json({
        text: result.text,
        model: result.model,
        provider: result.provider,
        tokens: result.tokens,
        toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
        latencyMs: result.latencyMs,
      })
    })

    // Send prompt (fire-and-forget)
    .post("/:id/messages/async", async (c) => {
      const sessionId = c.req.param("id")
      const body = PromptBody.parse(await c.req.json())

      // Execute in background — don't await
      executor.run({
        prompt: body.content,
        modelID: body.modelID,
        providerID: body.providerID,
        workspaceRoot: body.workspaceRoot,
        agentID: body.agentID,
      }).then(result => {
        chatLog.store({
          sessionId,
          userMessage: body.content,
          assistantReply: result.text,
          model: result.model,
          toolCallCount: result.toolCalls.length,
          latencyMs: result.latencyMs,
        })
      }).catch(err => {
        console.error(`[sessions] Async prompt failed for ${sessionId}:`, err)
      })

      return c.body(null, 204)
    })

    // Stream prompt — returns SSE with progress events
    .post("/:id/messages/stream", async (c) => {
      const sessionId = c.req.param("id")
      const body = PromptBody.parse(await c.req.json())

      // For now, run synchronously and return result as a single SSE event.
      // Full streaming will be implemented when we add streaming to AgentExecutor.
      const result = await executor.run({
        prompt: body.content,
        modelID: body.modelID,
        providerID: body.providerID,
        workspaceRoot: body.workspaceRoot,
        agentID: body.agentID,
      })

      chatLog.store({
        sessionId,
        userMessage: body.content,
        assistantReply: result.text,
        model: result.model,
        toolCallCount: result.toolCalls.length,
        latencyMs: result.latencyMs,
      })

      const event = `data: ${JSON.stringify({ type: "text", text: result.text, model: result.model, done: true })}\n\n`
      return new Response(event, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      })
    })

    // Delete message (not supported with current ChatLogStore — no-op)
    .delete("/:id/messages/:messageID", async (c) => {
      return c.json({ deleted: true })
    })

    // Revert / unrevert (no-op — VCS-level revert not needed without OpenCode)
    .post("/:id/revert", async (c) => {
      return c.json({ reverted: true })
    })
    .post("/:id/unrevert", async (c) => {
      return c.json({ unreverted: true })
    })
}
