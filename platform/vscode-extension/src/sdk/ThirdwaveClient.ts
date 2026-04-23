// ---------------------------------------------------------------------------
// Thirdwave SDK Client — lightweight HTTP wrapper for the VS Code extension
// Adapted from platform/src/sdk/client.ts for Node.js (VS Code) runtime
// ---------------------------------------------------------------------------

export interface ThirdwaveClientOptions {
  baseUrl: string;
  apiKey?: string;
}

export interface SessionInfo {
  id: string;
  parentID?: string;
  title: string;
  agentID: string;
  createdAt: number;
  updatedAt: number;
}

export interface MessagePart {
  id: string;
  type: string;
  [key: string]: unknown;
}

export interface MessageWithParts {
  info: { id: string; sessionID: string; role: "user" | "assistant"; createdAt: number };
  parts: MessagePart[];
}

export interface DirectChatRequest {
  message: string;
  modelID?: string;
  providerID?: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  tools?: boolean;
  maxToolRounds?: number;
  workspaceRoot?: string;
  sessionId?: string;  // VS Code session ID for chat log
}

export interface DirectChatResponse {
  text: string;
  reasoning?: string;
  model: string;
  provider: string;
  tokens: { input: number; output: number };
  latencyMs: number;
  toolCalls?: Array<{ tool: string; args: Record<string, unknown>; result: string; success: boolean }>;
}

export interface RegistryResponse {
  local: Array<{
    id: string;
    name: string;
    endpoint: string;
    status: "online" | "offline" | "unknown";
    latencyMs?: number;
    models: Array<{ id: string; name: string; contextLimit: number; outputLimit: number; isCloud?: boolean; originLabel?: string; cloudProviderName?: string }>;
    isPrimary: boolean;
  }>;
  cloud: Array<{
    id: string;
    name: string;
    apiUrl: string;
    docUrl: string;
    keyEnvVar: string;
    configured: boolean;
    models: Array<{ id: string; name: string; contextLimit: number; outputLimit: number; costIn: number; costOut: number }>;
  }>;
  activeModel: string;
  generatedAt: string;
}

export interface HealthStatus {
  platform: "ok" | "degraded" | "down";
  opencode: "ok" | "unreachable";
  uptime: number;
  version: string;
}

export class ThirdwaveClient {
  private base: string;
  private headers: Record<string, string>;

  constructor(opts: ThirdwaveClientOptions) {
    this.base = opts.baseUrl.replace(/\/$/, "");
    this.headers = { "content-type": "application/json" };
    if (opts.apiKey) {
      this.headers["authorization"] = `Bearer ${opts.apiKey}`;
    }
  }

  private url(path: string, params?: Record<string, string | undefined>): string {
    const u = new URL(`${this.base}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) { u.searchParams.set(k, v); }
      }
    }
    return u.toString();
  }

  private async request<T>(method: string, path: string, body?: unknown, params?: Record<string, string | undefined>, signal?: AbortSignal): Promise<T> {
    const res = await fetch(this.url(path, params), {
      method,
      headers: this.headers,
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${method} ${path}: ${res.status} — ${text}`);
    }
    if (res.status === 204) { return undefined as T; }
    return res.json() as Promise<T>;
  }

  // ── Health ─────────────────────────────────────────────────────

  async health(): Promise<HealthStatus> {
    return this.request("GET", "/health");
  }

  // ── Sessions ───────────────────────────────────────────────────

  async listSessions(opts?: { limit?: number }): Promise<SessionInfo[]> {
    return this.request("GET", "/api/sessions", undefined, {
      limit: opts?.limit?.toString(),
    });
  }

  async createSession(opts?: { parentID?: string; title?: string; agentID?: string }): Promise<SessionInfo> {
    return this.request("POST", "/api/sessions", opts);
  }

  async deleteSession(id: string): Promise<void> {
    return this.request("DELETE", `/api/sessions/${encodeURIComponent(id)}`);
  }

  // ── Messages ───────────────────────────────────────────────────

  async listMessages(sessionID: string, opts?: { limit?: number }): Promise<MessageWithParts[]> {
    return this.request("GET", `/api/sessions/${encodeURIComponent(sessionID)}/messages`, undefined, {
      limit: opts?.limit?.toString(),
    });
  }

  // ── Chat ───────────────────────────────────────────────────────

  async directChat(opts: DirectChatRequest, signal?: AbortSignal): Promise<DirectChatResponse> {
    return this.request("POST", "/api/chat", opts, undefined, signal);
  }

  /** Register a VS Code stream session with the backend (for admin Sessions page sync) */
  async registerChatSession(opts: { sessionId: string; title: string; model: string; messageCount: number }): Promise<void> {
    try {
      await this.request("POST", "/api/chat/sessions/register", opts);
    } catch { /* fire-and-forget — don't break UI on failure */ }
  }

  /**
   * Stream chat via SSE — returns an async iterator of text chunks.
   * Falls back to non-streaming direct chat on error.
   */
  async chatStream(opts: {
    message: string;
    model?: string;
    agent?: string;
    system?: string;
    maxTokens?: number;
    temperature?: number;
    history?: Array<{ role: string; content: string }>;
    tools?: boolean;
    workspaceRoot?: string;
    signal?: AbortSignal;
  }): Promise<AsyncIterable<{ type: "text" | "reasoning" | "done"; content: string; meta?: any }>> {
    const body = {
      message: opts.message,
      modelID: opts.model || undefined,
      system: opts.system || undefined,
      maxTokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.3,
      history: opts.history,
      tools: opts.tools,
      workspaceRoot: opts.workspaceRoot,
    };

    const res = await fetch(this.url("/api/chat/stream"), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok || !res.body) {
      // Fallback to non-streaming
      const direct = await this.directChat({
        message: opts.message,
        modelID: opts.model || undefined,
        system: opts.system,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        history: opts.history as any,
        tools: opts.tools,
        workspaceRoot: opts.workspaceRoot,
      });
      const self = direct;
      return (async function* () {
        if (self.reasoning) yield { type: "reasoning" as const, content: self.reasoning };
        yield { type: "text" as const, content: self.text };
        yield { type: "done" as const, content: "", meta: { model: self.model, provider: self.provider, tokens: self.tokens, latencyMs: self.latencyMs, toolCalls: self.toolCalls } };
      })();
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer: Array<{ type: "text" | "reasoning" | "done"; content: string; meta?: any }> = [];
    let bufferIndex = 0;
    let sseLeftover = ""; // leftover partial line from previous read

    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<{ type: "text" | "reasoning" | "done"; content: string; meta?: any }>> {
            // First, drain any buffered chunks from the last read
            if (bufferIndex < buffer.length) {
              return { done: false, value: buffer[bufferIndex++] };
            }

            while (true) {
              const { done, value } = await reader.read();
              if (done) return { done: true, value: undefined };
              const text = sseLeftover + decoder.decode(value, { stream: true });
              const lines = text.split("\n");
              // Last element may be partial — save for next read
              sseLeftover = lines.pop() || "";
              
              buffer = [];
              bufferIndex = 0;
              for (const line of lines) {
                if (line.startsWith("data: ")) {
                  const data = line.slice(6);
                  if (data === "[DONE]") {
                    buffer.push({ type: "done", content: "" });
                    continue;
                  }
                  try {
                    const parsed = JSON.parse(data);
                    // Check for reasoning/thinking content
                    const reasoning = parsed.choices?.[0]?.delta?.reasoning_content || parsed.choices?.[0]?.delta?.thinking;
                    if (reasoning) { buffer.push({ type: "reasoning", content: reasoning }); continue; }
                    const delta = parsed.choices?.[0]?.delta?.content;
                    if (delta) buffer.push({ type: "text", content: delta });
                    // Check for usage/meta in final chunk
                    if (parsed.usage) {
                      buffer.push({ type: "done", content: "", meta: { tokens: { input: parsed.usage.prompt_tokens, output: parsed.usage.completion_tokens }, model: parsed.model } });
                    }
                  } catch {
                    if (data.trim()) buffer.push({ type: "text", content: data });
                  }
                }
              }
              if (buffer.length > 0) {
                bufferIndex = 1;
                return { done: false, value: buffer[0] };
              }
            }
          },
        };
      },
    };
  }

  async chatModels(): Promise<{
    models: Array<{
      id: string; name: string; provider: string; providerName: string;
      source: "local" | "cloud"; contextLimit: number; outputLimit: number;
    }>;
    activeModel: string;
  }> {
    return this.request("GET", "/api/chat/models");
  }

  // ── Registry ───────────────────────────────────────────────────

  async registry(refresh?: boolean): Promise<RegistryResponse> {
    return this.request("GET", "/api/registry", undefined, refresh ? { refresh: "true" } : undefined);
  }

  async refreshRegistry(): Promise<{ ok: boolean; probed: number; generatedAt: string }> {
    return this.request("POST", "/api/registry/refresh");
  }

  // ── Audit ──────────────────────────────────────────────────────

  async queryAudit(opts?: {
    action?: string; limit?: number; offset?: number;
  }): Promise<unknown[]> {
    return this.request("GET", "/api/audit", undefined, {
      action: opts?.action,
      limit: opts?.limit?.toString(),
      offset: opts?.offset?.toString(),
    });
  }

  async auditStats(): Promise<unknown> {
    return this.request("GET", "/api/audit/stats");
  }

  // ── Budget ─────────────────────────────────────────────────────

  async budgetSummary(userID?: string): Promise<unknown> {
    return this.request("GET", "/api/budget/summary", undefined, {
      userID: userID ?? "default",
    });
  }

  // ── Policies ───────────────────────────────────────────────────

  async policyStatus(): Promise<unknown> {
    return this.request("GET", "/api/policies");
  }

  // ── Skills ─────────────────────────────────────────────────────

  async listSkills(): Promise<Array<{
    id: string; name: string; displayName: string; description: string; category?: string;
  }>> {
    return this.request("GET", "/api/skills");
  }

  async getSkill(id: string): Promise<{
    id: string; name: string; displayName: string; description: string; content: string; category?: string;
  }> {
    return this.request("GET", `/api/skills/${encodeURIComponent(id)}`);
  }

  async searchSkills(query: string): Promise<Array<{
    skill: { id: string; name: string; displayName: string; description: string; content: string };
    relevance: number;
  }>> {
    return this.request("GET", "/api/skills/search", undefined, { q: query });
  }

  async skillCategories(): Promise<Record<string, Array<{
    id: string; name: string; displayName: string; description: string;
  }>>> {
    return this.request("GET", "/api/skills/categories");
  }

  // ── Provider Auth ──────────────────────────────────────────────

  async setCloudProviderKey(providerID: string, apiKey: string): Promise<{ ok: boolean }> {
    return this.request("POST", `/api/registry/cloud/${encodeURIComponent(providerID)}/key`, { apiKey });
  }

  // ── HITL ───────────────────────────────────────────────────────

  async hitlPending(): Promise<unknown[]> {
    return this.request("GET", "/api/hitl/pending");
  }

  async hitlStats(): Promise<Record<string, number>> {
    return this.request("GET", "/api/hitl/stats");
  }

  async hitlResolved(): Promise<unknown[]> {
    return this.request("GET", "/api/hitl/resolved");
  }

  async resolveHitl(requestId: string, decision: "approved" | "denied"): Promise<unknown> {
    return this.request("POST", `/api/hitl/resolve/${encodeURIComponent(requestId)}`, { decision });
  }

  // ── Auth ────────────────────────────────────────────────────────

  async login(email: string, password: string): Promise<{ token: string; user: any }> {
    return this.request("POST", "/api/auth/login", { email, password });
  }

  async register(email: string, password: string, fullName?: string): Promise<any> {
    return this.request("POST", "/api/auth/register", { email, password, fullName });
  }

  async getRegistrationStatus(requestId: string): Promise<{ status: string; message?: string }> {
    return this.request("GET", `/api/auth/registration-status/${encodeURIComponent(requestId)}`);
  }

  async me(): Promise<{ user: any; token: any }> {
    return this.request("GET", "/api/auth/me");
  }

  async updateProfile(fullName: string): Promise<{ user: any }> {
    return this.request("PATCH", "/api/auth/profile", { fullName });
  }

  async listApiKeys(): Promise<{ keys: Array<any> }> {
    return this.request("GET", "/api/auth/api-keys");
  }

  async getActiveKey(): Promise<{ key: string }> {
    return this.request("GET", "/api/auth/api-keys/active");
  }

  async saveApiKey(apiKey: string, displayName?: string, gatewayUrl?: string): Promise<{
    key: any;
    gatewayVerification?: { valid: boolean; models?: string[]; error?: string };
  }> {
    return this.request("POST", "/api/auth/api-keys", { apiKey, displayName, gatewayUrl });
  }

  async verifyApiKey(apiKey: string, gatewayUrl?: string): Promise<{
    valid: boolean;
    models?: string[];
    latencyMs?: number;
    error?: string;
  }> {
    return this.request("POST", "/api/auth/api-keys/verify", { apiKey, gatewayUrl });
  }

  async revokeApiKey(id: string): Promise<{ ok: boolean }> {
    return this.request("DELETE", `/api/auth/api-keys/${encodeURIComponent(id)}`);
  }

  /** Update the Authorization header (e.g. after login) */
  setToken(token: string) {
    this.headers["authorization"] = `Bearer ${token}`;
  }

  /** Remove auth token (logout) */
  clearToken() {
    delete this.headers["authorization"];
  }
}
