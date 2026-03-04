// ---------------------------------------------------------------------------
// OpenCode engine client — typed HTTP + SSE wrapper around the self-hosted
// OpenCode server running on localhost:4096.
//
// Key contract with OpenCode:
//   • POST /session           — create session (body MUST be JSON, even {})
//   • POST /session/:id/message — send prompt
//       body: { parts: [{ type: "text", text: "…" }], agent?: "build" }
//   • Response MessageV2 parts: text, reasoning, tool, step-start,
//       step-finish, snapshot, patch, file, agent, retry, compaction, subtask
//   • info.error may be set even on 200 (e.g. ContextOverflowError)
// ---------------------------------------------------------------------------

import { env } from "../config/env"
import type {
  SessionInfo,
  MessageWithParts,
  ProjectInfo,
  ProviderInfo,
  AgentInfo,
  VcsInfo,
  FileNode,
  PromptInput,
  HealthStatus,
} from "../types"

export class OpenCodeError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: string,
  ) {
    super(message)
    this.name = "OpenCodeError"
  }
}

export class OpenCodeClient {
  private base: string
  private headers: Record<string, string>

  constructor(opts?: { url?: string; directory?: string; username?: string; password?: string }) {
    this.base = (opts?.url ?? env.OPENCODE_URL).replace(/\/$/, "")
    this.headers = {
      "content-type": "application/json",
      accept: "application/json",
    }
    if (opts?.directory ?? env.OPENCODE_DIR) {
      this.headers["x-opencode-directory"] = opts?.directory ?? env.OPENCODE_DIR
    }
    if (opts?.username || env.OPENCODE_SERVER_USERNAME) {
      const user = opts?.username ?? env.OPENCODE_SERVER_USERNAME ?? "opencode"
      const pass = opts?.password ?? env.OPENCODE_SERVER_PASSWORD ?? ""
      this.headers["authorization"] = `Basic ${btoa(`${user}:${pass}`)}`
    }
  }

  // ── Low-level helpers ────────────────────────────────────────────

  private url(path: string, params?: Record<string, string | undefined>): string {
    const u = new URL(`${this.base}${path}`)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) u.searchParams.set(k, v)
      }
    }
    return u.toString()
  }

  /**
   * Generic request.
   * IMPORTANT: POST/PUT/PATCH always send a JSON body (at least `{}`) because
   * OpenCode rejects Content-Type: application/json with no body as
   * "Malformed JSON in request body".
   */
  private async request<T>(method: string, path: string, body?: unknown, params?: Record<string, string | undefined>): Promise<T> {
    const needsBody = ["POST", "PUT", "PATCH"].includes(method.toUpperCase())
    const res = await fetch(this.url(path, params), {
      method,
      headers: this.headers,
      body: needsBody ? JSON.stringify(body ?? {}) : (body ? JSON.stringify(body) : undefined),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new OpenCodeError(res.status, `${method} ${path} failed: ${res.status}`, text)
    }
    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
  }

  private async stream(method: string, path: string, body?: unknown): Promise<ReadableStream<Uint8Array>> {
    const res = await fetch(this.url(path), {
      method,
      headers: { ...this.headers, accept: "text/event-stream" },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "")
      throw new OpenCodeError(res.status, `${method} ${path} stream failed`, text)
    }
    return res.body
  }

  // ── Health ─────────────────────────────────────────────────────

  async health(): Promise<{ ok: boolean } & HealthStatus> {
    const start = Date.now()
    try {
      await this.request("GET", "/session")
      return {
        ok: true,
        platform: "ok",
        opencode: "ok",
        uptime: Date.now() - start,
        version: "0.1.0",
      }
    } catch {
      return {
        ok: false,
        platform: "ok",
        opencode: "unreachable",
        uptime: 0,
        version: "0.1.0",
      }
    }
  }

  // ── Sessions ───────────────────────────────────────────────────

  async sessions(opts?: { limit?: number; search?: string }): Promise<SessionInfo[]> {
    return this.request("GET", "/session", undefined, {
      limit: opts?.limit?.toString(),
      search: opts?.search,
    })
  }

  async session(id: string): Promise<SessionInfo> {
    return this.request("GET", `/session/${id}`)
  }

  async createSession(opts?: { parentID?: string; title?: string; agentID?: string }): Promise<SessionInfo> {
    return this.request("POST", "/session", opts ?? {})
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.request("DELETE", `/session/${id}`)
  }

  async abortSession(id: string): Promise<boolean> {
    return this.request("POST", `/session/${id}/abort`)
  }

  async forkSession(id: string, messageID?: string): Promise<SessionInfo> {
    return this.request("POST", `/session/${id}/fork`, messageID ? { messageID } : {})
  }

  async summarizeSession(id: string): Promise<boolean> {
    return this.request("POST", `/session/${id}/summarize`)
  }

  async sessionStatus(): Promise<Record<string, string>> {
    return this.request("GET", "/session/status")
  }

  // ── Messages ───────────────────────────────────────────────────

  async messages(sessionID: string, opts?: { limit?: number }): Promise<MessageWithParts[]> {
    return this.request("GET", `/session/${sessionID}/message`, undefined, {
      limit: opts?.limit?.toString(),
    })
  }

  async message(sessionID: string, messageID: string): Promise<MessageWithParts> {
    return this.request("GET", `/session/${sessionID}/message/${messageID}`)
  }

  /**
   * Send a prompt and get the full response.
   * Transforms the Platform SDK PromptInput into OpenCode's expected format.
   */
  async prompt(sessionID: string, input: PromptInput): Promise<MessageWithParts> {
    const body = this.toOpenCodePrompt(input)
    return this.request("POST", `/session/${sessionID}/message`, body)
  }

  /**
   * Fire-and-forget prompt — returns immediately (HTTP 204).
   * Listen on the event stream to track progress.
   */
  async promptAsync(sessionID: string, input: PromptInput): Promise<void> {
    const body = this.toOpenCodePrompt(input)
    return this.request("POST", `/session/${sessionID}/prompt_async`, body)
  }

  /**
   * Returns a ReadableStream of SSE data for real-time message streaming.
   */
  async promptStream(sessionID: string, input: PromptInput): Promise<ReadableStream<Uint8Array>> {
    const body = this.toOpenCodePrompt(input)
    return this.stream("POST", `/session/${sessionID}/message`, body)
  }

  /**
   * Convert SDK PromptInput → OpenCode message body format.
   *
   * OpenCode expects:
   *   { parts: [{ type: "text", text: "..." }], agent?: "build" }
   *
   * NOT "agentID" — OpenCode uses the field name "agent" in its PromptInput schema.
   */
  private toOpenCodePrompt(input: PromptInput): Record<string, unknown> {
    const parts: Array<Record<string, unknown>> = [
      { type: "text", text: input.content },
    ]
    // Add attachments as file parts if present
    if (input.attachments?.length) {
      for (const att of input.attachments) {
        parts.push({ type: "file", url: att.url, filename: att.filename, mediaType: att.mediaType })
      }
    }
    const body: Record<string, unknown> = { parts }
    // OpenCode uses "agent" (NOT "agentID") in its PromptInput schema
    if (input.agentID) body.agent = input.agentID
    if (input.modelID) body.model = { modelID: input.modelID, providerID: input.providerID ?? "vllm" }
    return body
  }

  async deleteMessage(sessionID: string, messageID: string): Promise<boolean> {
    return this.request("DELETE", `/session/${sessionID}/message/${messageID}`)
  }

  // ── Providers ──────────────────────────────────────────────────

  async providers(): Promise<{ all: ProviderInfo[]; default: Record<string, string>; connected: string[] }> {
    return this.request("GET", "/provider")
  }

  async agents(): Promise<AgentInfo[]> {
    return this.request("GET", "/agent")
  }

  async skills(): Promise<unknown[]> {
    return this.request("GET", "/skill")
  }

  async setAuth(providerID: string, body: Record<string, unknown>): Promise<boolean> {
    await this.request("PUT", `/provider/${providerID}/auth`, body)
    return true
  }

  async removeAuth(providerID: string): Promise<boolean> {
    await this.request("DELETE", `/provider/${providerID}/auth`)
    return true
  }

  // ── Project / Files ────────────────────────────────────────────

  async currentProject(): Promise<ProjectInfo> {
    return this.request("GET", "/project")
  }

  async projects(): Promise<ProjectInfo[]> {
    return this.request("GET", "/project")
  }

  async files(dir?: string): Promise<FileNode[]> {
    return this.request("GET", "/file", undefined, { path: dir })
  }

  /** Alias used by file routes */
  async listFiles(dir?: string): Promise<FileNode[]> {
    return this.files(dir)
  }

  async readFile(path: string): Promise<{ type: string; content: string }> {
    return this.request("GET", "/file/read", undefined, { path })
  }

  async findFiles(query: string): Promise<string[]> {
    return this.request("GET", "/file/search", undefined, { q: query })
  }

  async fileStatus(): Promise<Record<string, unknown>> {
    return this.request("GET", "/file/status")
  }

  async findText(query: string): Promise<unknown[]> {
    return this.request("GET", "/file/grep", undefined, { q: query })
  }

  // ── Config / VCS ───────────────────────────────────────────────

  async config(): Promise<Record<string, unknown>> {
    return this.request("GET", "/config")
  }

  async updateConfig(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("PATCH", "/config", patch)
  }

  async vcs(): Promise<VcsInfo> {
    return this.request("GET", "/vcs")
  }

  async paths(): Promise<unknown> {
    return this.request("GET", "/path")
  }

  // ── Revert ─────────────────────────────────────────────────────

  async revert(sessionID: string): Promise<SessionInfo> {
    return this.request("POST", `/session/${sessionID}/revert`)
  }

  async unrevert(sessionID: string): Promise<SessionInfo> {
    return this.request("POST", `/session/${sessionID}/unrevert`)
  }

  // ── Event subscription ──────────────────────────────────────────

  private _eventListeners: Array<(event: any) => void> = []
  private _eventSource: EventSource | null = null

  /**
   * Subscribe to OpenCode bus events via SSE.
   * Returns an unsubscribe function.
   */
  subscribe(listener: (event: any) => void): () => void {
    this._eventListeners.push(listener)

    // Lazily start the EventSource if not already running
    if (!this._eventSource && typeof EventSource !== "undefined") {
      try {
        this._eventSource = new EventSource(`${this.base}/event`)
        this._eventSource.onmessage = (msg) => {
          try {
            const data = JSON.parse(msg.data)
            for (const fn of this._eventListeners) fn(data)
          } catch {}
        }
        this._eventSource.onerror = () => {
          // Will auto-reconnect; swallow
        }
      } catch {
        // EventSource not available (e.g. in Node without polyfill) — fall back to polling
      }
    }

    return () => {
      this._eventListeners = this._eventListeners.filter((l) => l !== listener)
      if (this._eventListeners.length === 0 && this._eventSource) {
        this._eventSource.close()
        this._eventSource = null
      }
    }
  }

  /**
   * Graceful teardown — close SSE connections.
   */
  async dispose(): Promise<void> {
    if (this._eventSource) {
      this._eventSource.close()
      this._eventSource = null
    }
    this._eventListeners = []
  }
}
