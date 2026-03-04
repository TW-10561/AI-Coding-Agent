// ---------------------------------------------------------------------------
// Platform SDK client — typed HTTP wrapper for the slim backend
// ---------------------------------------------------------------------------

import type {
  SessionInfo,
  MessageWithParts,
  ProjectInfo,
  ProviderInfo,
  AgentInfo,
  VcsInfo,
  FileNode,
  TaskRun,
  HealthStatus,
} from "../types"

export interface PlatformClientOptions {
  /** Platform base URL, e.g. "http://localhost:3100" */
  baseUrl: string
  /** API key for authentication (sent as Bearer token) */
  apiKey?: string
  /** Custom fetch implementation (for testing or Node polyfills) */
  fetch?: typeof globalThis.fetch
}

export interface SessionCreateOptions {
  parentID?: string
  title?: string
  agentID?: string
}

export interface PromptOptions {
  content: string
  agentID?: string
  modelID?: string
  providerID?: string
  attachments?: Array<{ filename: string; url: string; mediaType: string }>
}

export interface TaskEnqueueOptions {
  prompt: string
  directory?: string
  agentID?: string
  modelID?: string
  providerID?: string
  sessionID?: string
}

export interface ListOptions {
  limit?: number
  search?: string
  status?: string
}

export class PlatformClient {
  private base: string
  private headers: Record<string, string>
  private _fetch: typeof globalThis.fetch

  constructor(opts: PlatformClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, "")
    this._fetch = opts.fetch ?? globalThis.fetch.bind(globalThis)
    this.headers = { "content-type": "application/json" }
    if (opts.apiKey) {
      this.headers["authorization"] = `Bearer ${opts.apiKey}`
    }
  }

  // ── Internal ───────────────────────────────────────────────────

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
    const res = await this._fetch(this.url(path, params), {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new PlatformApiError(res.status, `${method} ${path}: ${res.status}`, text)
    }
    if (res.status === 204) return undefined as T
    return res.json() as Promise<T>
  }

  // ── Health ─────────────────────────────────────────────────────

  async health(): Promise<HealthStatus> {
    return this.request("GET", "/health")
  }

  async ready(): Promise<{ ready: boolean }> {
    return this.request("GET", "/health/ready")
  }

  // ── Sessions ───────────────────────────────────────────────────

  async listSessions(opts?: ListOptions): Promise<SessionInfo[]> {
    return this.request("GET", "/api/sessions", undefined, {
      limit: opts?.limit?.toString(),
      search: opts?.search,
    })
  }

  async getSession(id: string): Promise<SessionInfo> {
    return this.request("GET", `/api/sessions/${id}`)
  }

  async createSession(opts?: SessionCreateOptions): Promise<SessionInfo> {
    return this.request("POST", "/api/sessions", opts)
  }

  async deleteSession(id: string): Promise<void> {
    return this.request("DELETE", `/api/sessions/${id}`)
  }

  async abortSession(id: string): Promise<void> {
    return this.request("POST", `/api/sessions/${id}/abort`)
  }

  async forkSession(id: string, messageID?: string): Promise<SessionInfo> {
    return this.request("POST", `/api/sessions/${id}/fork`, messageID ? { messageID } : undefined)
  }

  async summarizeSession(id: string): Promise<void> {
    return this.request("POST", `/api/sessions/${id}/summarize`)
  }

  // ── Messages ───────────────────────────────────────────────────

  async listMessages(sessionID: string, opts?: { limit?: number }): Promise<MessageWithParts[]> {
    return this.request("GET", `/api/sessions/${sessionID}/messages`, undefined, {
      limit: opts?.limit?.toString(),
    })
  }

  async getMessage(sessionID: string, messageID: string): Promise<MessageWithParts> {
    return this.request("GET", `/api/sessions/${sessionID}/messages/${messageID}`)
  }

  /**
   * Send a prompt and wait for the full response.
   */
  async prompt(sessionID: string, opts: PromptOptions): Promise<MessageWithParts> {
    return this.request("POST", `/api/sessions/${sessionID}/messages`, opts)
  }

  /**
   * Send a prompt and get back a ReadableStream of SSE data.
   */
  async promptStream(sessionID: string, opts: PromptOptions): Promise<ReadableStream<Uint8Array>> {
    const res = await this._fetch(this.url(`/api/sessions/${sessionID}/messages/stream`), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(opts),
    })
    if (!res.ok || !res.body) {
      throw new PlatformApiError(res.status, "Stream failed", await res.text().catch(() => ""))
    }
    return res.body
  }

  /**
   * Fire-and-forget prompt. Track via events.
   */
  async promptAsync(sessionID: string, opts: PromptOptions): Promise<void> {
    return this.request("POST", `/api/sessions/${sessionID}/messages/async`, opts)
  }

  async deleteMessage(sessionID: string, messageID: string): Promise<void> {
    return this.request("DELETE", `/api/sessions/${sessionID}/messages/${messageID}`)
  }

  async revert(sessionID: string): Promise<SessionInfo> {
    return this.request("POST", `/api/sessions/${sessionID}/revert`)
  }

  async unrevert(sessionID: string): Promise<SessionInfo> {
    return this.request("POST", `/api/sessions/${sessionID}/unrevert`)
  }

  // ── Tasks (platform-level job queue) ───────────────────────────

  async enqueueTask(opts: TaskEnqueueOptions): Promise<TaskRun> {
    return this.request("POST", "/api/tasks", opts)
  }

  async listTasks(opts?: ListOptions): Promise<TaskRun[]> {
    return this.request("GET", "/api/tasks", undefined, {
      status: opts?.status,
    })
  }

  async getTask(id: string): Promise<TaskRun> {
    return this.request("GET", `/api/tasks/${id}`)
  }

  async abortTask(id: string): Promise<void> {
    return this.request("POST", `/api/tasks/${id}/abort`)
  }

  // ── Providers ──────────────────────────────────────────────────

  async listProviders(): Promise<{ all: ProviderInfo[]; default: string; connected: string[] }> {
    return this.request("GET", "/api/providers")
  }

  async listAgents(): Promise<AgentInfo[]> {
    return this.request("GET", "/api/providers/agents")
  }

  // ── Files ──────────────────────────────────────────────────────

  async listFiles(dir?: string): Promise<FileNode[]> {
    return this.request("GET", "/api/files", undefined, { path: dir })
  }

  async readFile(path: string): Promise<{ type: string; content: string }> {
    return this.request("GET", "/api/files/content", undefined, { path })
  }

  async findFiles(query: string): Promise<string[]> {
    return this.request("GET", "/api/files/find", undefined, { q: query })
  }

  async searchText(query: string): Promise<unknown[]> {
    return this.request("GET", "/api/files/search", undefined, { q: query })
  }

  // ── Project / Config / VCS ─────────────────────────────────────

  async currentProject(): Promise<ProjectInfo> {
    return this.request("GET", "/api/project")
  }

  async listProjects(): Promise<ProjectInfo[]> {
    return this.request("GET", "/api/projects")
  }

  async getConfig(): Promise<Record<string, unknown>> {
    return this.request("GET", "/api/config")
  }

  async updateConfig(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("PATCH", "/api/config", patch)
  }

  async vcs(): Promise<VcsInfo> {
    return this.request("GET", "/api/vcs")
  }

  // ── Audit ──────────────────────────────────────────────────────

  async queryAudit(opts?: {
    action?: string; userID?: string; sessionID?: string; workspaceID?: string
    success?: boolean; from?: string; to?: string; limit?: number; offset?: number
  }): Promise<unknown[]> {
    return this.request("GET", "/api/audit", undefined, {
      action: opts?.action,
      userID: opts?.userID,
      sessionID: opts?.sessionID,
      workspaceID: opts?.workspaceID,
      success: opts?.success?.toString(),
      from: opts?.from,
      to: opts?.to,
      limit: opts?.limit?.toString(),
      offset: opts?.offset?.toString(),
    })
  }

  async auditStats(opts?: { from?: string; to?: string }): Promise<unknown> {
    return this.request("GET", "/api/audit/stats", undefined, {
      from: opts?.from,
      to: opts?.to,
    })
  }

  // ── Budget ─────────────────────────────────────────────────────

  async budgetCheck(userID?: string, tokens?: number): Promise<{ allowed: boolean; warnings: string[] }> {
    return this.request("GET", "/api/budget/check", undefined, {
      userID: userID ?? "default",
      tokens: tokens?.toString(),
    })
  }

  async budgetSummary(userID?: string): Promise<unknown> {
    return this.request("GET", "/api/budget/summary", undefined, {
      userID: userID ?? "default",
    })
  }

  async setBudgetLimits(opts: {
    userID?: string; window: string
    maxTokens?: number; maxRequests?: number; maxCostCents?: number; hardLimit?: boolean
  }): Promise<void> {
    return this.request("PUT", "/api/budget/limits", {
      window: opts.window,
      maxTokens: opts.maxTokens,
      maxRequests: opts.maxRequests,
      maxCostCents: opts.maxCostCents,
      hardLimit: opts.hardLimit,
    }, { userID: opts.userID ?? "default" })
  }

  // ── Workspaces ─────────────────────────────────────────────────

  async listWorkspaces(tag?: string): Promise<unknown[]> {
    return this.request("GET", "/api/workspaces", undefined, { tag })
  }

  async activeWorkspace(): Promise<unknown> {
    return this.request("GET", "/api/workspaces/active")
  }

  async getWorkspace(id: string): Promise<unknown> {
    return this.request("GET", `/api/workspaces/${id}`)
  }

  async createWorkspace(opts: { name: string; directory: string; tags?: string[] }): Promise<unknown> {
    return this.request("POST", "/api/workspaces", opts)
  }

  async switchWorkspace(id: string): Promise<unknown> {
    return this.request("POST", `/api/workspaces/${id}/switch`)
  }

  async deleteWorkspace(id: string): Promise<void> {
    return this.request("DELETE", `/api/workspaces/${id}`)
  }

  // ── Orchestrations ─────────────────────────────────────────────

  async startOrchestration(plan: {
    name: string
    tasks: Array<{ label: string; agentID?: string; prompt: string; dependsOn?: string[]; retries?: number }>
    maxConcurrency?: number
  }): Promise<unknown> {
    return this.request("POST", "/api/orchestrations", plan)
  }

  async listOrchestrations(status?: string): Promise<unknown[]> {
    return this.request("GET", "/api/orchestrations", undefined, { status })
  }

  async getOrchestration(id: string): Promise<unknown> {
    return this.request("GET", `/api/orchestrations/${id}`)
  }

  async cancelOrchestration(id: string): Promise<void> {
    return this.request("POST", `/api/orchestrations/${id}/cancel`)
  }

  // ── Queue ──────────────────────────────────────────────────────

  async enqueueScalable(opts: {
    prompt: string; directory?: string; agentID?: string; workspaceID?: string; priority?: number
  }): Promise<unknown> {
    return this.request("POST", "/api/queue", opts)
  }

  async queueMetrics(): Promise<unknown> {
    return this.request("GET", "/api/queue/metrics")
  }

  // ── Parallel Execution ─────────────────────────────────────────

  async executeParallel(plan: {
    name: string; concurrency?: number; timeoutMs?: number; fanInPrompt?: string
    tasks: Array<{ label: string; agentID?: string; prompt: string; dependsOn?: string[]; timeoutMs?: number }>
  }): Promise<unknown> {
    return this.request("POST", "/api/parallel", plan)
  }

  async listParallelExecutions(opts?: { status?: string; userID?: string }): Promise<unknown[]> {
    return this.request("GET", "/api/parallel", undefined, {
      status: opts?.status,
      userID: opts?.userID,
    })
  }

  async getParallelExecution(id: string): Promise<unknown> {
    return this.request("GET", `/api/parallel/${id}`)
  }

  async parallelProgress(id: string): Promise<{ percent: number; completed: number; total: number; running: number; pending: number }> {
    return this.request("GET", `/api/parallel/${id}/progress`)
  }

  async cancelParallelExecution(id: string): Promise<void> {
    return this.request("POST", `/api/parallel/${id}/cancel`)
  }

  // ── Provider Registry (Artemis Zen equivalento) ─────────────────────

  /** Full snapshot: local vLLM providers + cloud provider catalogue */
  async registry(refresh?: boolean): Promise<{
    local: Array<{
      id: string; name: string; endpoint: string
      status: "online" | "offline" | "unknown"; latencyMs?: number
      models: Array<{ id: string; name: string; contextLimit: number; outputLimit: number }>
      isPrimary: boolean
    }>
    cloud: Array<{
      id: string; name: string; apiUrl: string; docUrl: string
      keyEnvVar: string; configured: boolean
      models: Array<{ id: string; name: string; contextLimit: number; outputLimit: number; costIn: number; costOut: number }>
    }>
    activeModel: string
    generatedAt: string
  }> {
    return this.request("GET", "/api/registry", undefined, refresh ? { refresh: "true" } : undefined)
  }

  /** Force-re-probe all vLLM endpoints */
  async refreshRegistry(): Promise<{ ok: boolean; probed: number; generatedAt: string }> {
    return this.request("POST", "/api/registry/refresh")
  }

  /** Set API key for a cloud provider (stored server-side) */
  async setCloudApiKey(providerID: string, apiKey: string): Promise<{ ok: boolean }> {
    return this.request("POST", `/api/registry/cloud/${providerID}/key`, { apiKey })
  }

  // ── Direct Chat (bypasses OpenCode, talks to vLLM directly) ─────

  /** Direct chat with vLLM — no tools, no OpenCode system prompt, much faster */
  async directChat(opts: {
    message: string
    modelID?: string
    providerID?: string
    system?: string
    maxTokens?: number
    temperature?: number
    history?: Array<{ role: "user" | "assistant"; content: string }>
  }): Promise<{
    text: string
    reasoning?: string
    model: string
    provider: string
    tokens: { input: number; output: number }
    latencyMs: number
  }> {
    return this.request("POST", "/api/chat", opts)
  }

  /** List models available for direct chat */
  async chatModels(): Promise<{
    models: Array<{
      id: string; name: string; provider: string; providerName: string
      source: "local" | "cloud"; contextLimit: number; outputLimit: number
    }>
    activeModel: string
  }> {
    return this.request("GET", "/api/chat/models")
  }
}

// ── Error class ──────────────────────────────────────────────────────

export class PlatformApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: string,
  ) {
    super(message)
    this.name = "PlatformApiError"
  }
}
