// ---------------------------------------------------------------------------
// OpenCode engine client — typed HTTP + SSE wrapper around the self-hosted
// OpenCode server running on localhost:4096.
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
  CommandInput,
  ShellInput,
  HealthStatus,
} from "../types"

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

  private async request<T>(method: string, path: string, body?: unknown, params?: Record<string, string | undefined>): Promise<T> {
    const res = await fetch(this.url(path, params), {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
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

  // ── Health ──────────────────────────────────────────────────────

  async health(): Promise<{ ok: boolean; url: string }> {
    try {
      const res = await fetch(this.url("/path"), { headers: this.headers })
      return { ok: res.ok, url: this.base }
    } catch {
      return { ok: false, url: this.base }
    }
  }

  // ── Projects ───────────────────────────────────────────────────

  async projects(): Promise<ProjectInfo[]> {
    return this.request("GET", "/project")
  }

  async currentProject(): Promise<ProjectInfo> {
    return this.request("GET", "/project/current")
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
    return this.request("POST", "/session", opts)
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.request("DELETE", `/session/${id}`)
  }

  async abortSession(id: string): Promise<boolean> {
    return this.request("POST", `/session/${id}/abort`)
  }

  async forkSession(id: string, messageID?: string): Promise<SessionInfo> {
    return this.request("POST", `/session/${id}/fork`, messageID ? { messageID } : undefined)
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
   * Send a prompt and get the full streamed response body.
   * For raw SSE streaming, use `promptStream()`.
   */
  async prompt(sessionID: string, input: PromptInput): Promise<MessageWithParts> {
    // OpenCode expects { parts: [{ type: "text", text: "..." }] }
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

  /** Convert SDK PromptInput → OpenCode message body format */
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
    if (input.agentID) body.agentID = input.agentID
    if (input.modelID) body.modelID = input.modelID
    if (input.providerID) body.providerID = input.providerID
    return body
  }

  async deleteMessage(sessionID: string, messageID: string): Promise<boolean> {
    return this.request("DELETE", `/session/${sessionID}/message/${messageID}`)
  }

  async revert(sessionID: string): Promise<SessionInfo> {
    return this.request("POST", `/session/${sessionID}/revert`)
  }

  async unrevert(sessionID: string): Promise<SessionInfo> {
    return this.request("POST", `/session/${sessionID}/unrevert`)
  }

  // ── Commands & shell ───────────────────────────────────────────

  async command(sessionID: string, input: CommandInput): Promise<MessageWithParts> {
    return this.request("POST", `/session/${sessionID}/command`, input)
  }

  async shell(sessionID: string, input: ShellInput): Promise<MessageWithParts> {
    return this.request("POST", `/session/${sessionID}/shell`, input)
  }

  // ── Providers & models ─────────────────────────────────────────

  async providers(): Promise<{ all: ProviderInfo[]; default: string; connected: string[] }> {
    return this.request("GET", "/provider")
  }

  async setAuth(providerID: string, info: Record<string, unknown>): Promise<boolean> {
    return this.request("PUT", `/auth/${providerID}`, info)
  }

  async removeAuth(providerID: string): Promise<boolean> {
    return this.request("DELETE", `/auth/${providerID}`)
  }

  // ── Agents & skills ────────────────────────────────────────────

  async agents(): Promise<AgentInfo[]> {
    return this.request("GET", "/agent")
  }

  async skills(): Promise<unknown[]> {
    return this.request("GET", "/skill")
  }

  // ── Config ─────────────────────────────────────────────────────

  async config(): Promise<Record<string, unknown>> {
    return this.request("GET", "/config")
  }

  async updateConfig(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("PATCH", "/config", patch)
  }

  // ── Files ──────────────────────────────────────────────────────

  async findFiles(query: string): Promise<string[]> {
    return this.request("GET", "/find/file", undefined, { query })
  }

  async findText(query: string): Promise<unknown[]> {
    return this.request("GET", "/find", undefined, { query })
  }

  async listFiles(dir?: string): Promise<FileNode[]> {
    return this.request("GET", "/file", undefined, { path: dir })
  }

  async readFile(path: string): Promise<{ type: string; content: string }> {
    return this.request("GET", "/file/content", undefined, { path })
  }

  async fileStatus(): Promise<unknown[]> {
    return this.request("GET", "/file/status")
  }

  // ── VCS ────────────────────────────────────────────────────────

  async vcs(): Promise<VcsInfo> {
    return this.request("GET", "/vcs")
  }

  // ── Paths ──────────────────────────────────────────────────────

  async paths(): Promise<{ home: string; state: string; config: string; worktree: string; directory: string }> {
    return this.request("GET", "/path")
  }

  // ── Events (SSE) ──────────────────────────────────────────────

  events(): EventSource {
    return new EventSource(this.url("/event"))
  }

  /**
   * Subscribe to all OpenCode events via SSE. Returns an unsubscribe function.
   */
  subscribe(handler: (event: { type: string; properties: unknown }) => void): () => void {
    const es = this.events()
    const onMessage = (e: MessageEvent) => {
      try {
        handler(JSON.parse(e.data))
      } catch {}
    }
    es.addEventListener("message", onMessage)
    return () => {
      es.removeEventListener("message", onMessage)
      es.close()
    }
  }

  // ── Instance lifecycle ─────────────────────────────────────────

  async dispose(): Promise<boolean> {
    return this.request("POST", "/instance/dispose")
  }
}

// ── Error type ───────────────────────────────────────────────────────

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
