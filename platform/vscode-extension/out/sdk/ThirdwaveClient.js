"use strict";
// ---------------------------------------------------------------------------
// Thirdwave SDK Client — lightweight HTTP wrapper for the VS Code extension
// Adapted from platform/src/sdk/client.ts for Node.js (VS Code) runtime
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.ThirdwaveClient = void 0;
class ThirdwaveClient {
    base;
    headers;
    constructor(opts) {
        this.base = opts.baseUrl.replace(/\/$/, "");
        this.headers = { "content-type": "application/json" };
        if (opts.apiKey) {
            this.headers["authorization"] = `Bearer ${opts.apiKey}`;
        }
    }
    url(path, params) {
        const u = new URL(`${this.base}${path}`);
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                if (v !== undefined) {
                    u.searchParams.set(k, v);
                }
            }
        }
        return u.toString();
    }
    async request(method, path, body, params, signal) {
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
        if (res.status === 204) {
            return undefined;
        }
        return res.json();
    }
    // ── Health ─────────────────────────────────────────────────────
    async health() {
        return this.request("GET", "/health");
    }
    // ── Sessions ───────────────────────────────────────────────────
    async listSessions(opts) {
        return this.request("GET", "/api/sessions", undefined, {
            limit: opts?.limit?.toString(),
        });
    }
    async createSession(opts) {
        return this.request("POST", "/api/sessions", opts);
    }
    async deleteSession(id) {
        return this.request("DELETE", `/api/sessions/${encodeURIComponent(id)}`);
    }
    // ── Messages ───────────────────────────────────────────────────
    async listMessages(sessionID, opts) {
        return this.request("GET", `/api/sessions/${encodeURIComponent(sessionID)}/messages`, undefined, {
            limit: opts?.limit?.toString(),
        });
    }
    // ── Chat ───────────────────────────────────────────────────────
    async directChat(opts, signal) {
        return this.request("POST", "/api/chat", opts, undefined, signal);
    }
    /**
     * Stream chat via SSE — returns an async iterator of text chunks.
     * Falls back to non-streaming direct chat on error.
     */
    async chatStream(opts) {
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
                history: opts.history,
                tools: opts.tools,
                workspaceRoot: opts.workspaceRoot,
            });
            const self = direct;
            return (async function* () {
                if (self.reasoning)
                    yield { type: "reasoning", content: self.reasoning };
                yield { type: "text", content: self.text };
                yield { type: "done", content: "", meta: { model: self.model, provider: self.provider, tokens: self.tokens, latencyMs: self.latencyMs, toolCalls: self.toolCalls } };
            })();
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = [];
        let bufferIndex = 0;
        let sseLeftover = ""; // leftover partial line from previous read
        return {
            [Symbol.asyncIterator]() {
                return {
                    async next() {
                        // First, drain any buffered chunks from the last read
                        if (bufferIndex < buffer.length) {
                            return { done: false, value: buffer[bufferIndex++] };
                        }
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done)
                                return { done: true, value: undefined };
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
                                        if (reasoning) {
                                            buffer.push({ type: "reasoning", content: reasoning });
                                            continue;
                                        }
                                        const delta = parsed.choices?.[0]?.delta?.content;
                                        if (delta)
                                            buffer.push({ type: "text", content: delta });
                                        // Check for usage/meta in final chunk
                                        if (parsed.usage) {
                                            buffer.push({ type: "done", content: "", meta: { tokens: { input: parsed.usage.prompt_tokens, output: parsed.usage.completion_tokens }, model: parsed.model } });
                                        }
                                    }
                                    catch {
                                        if (data.trim())
                                            buffer.push({ type: "text", content: data });
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
    async chatModels() {
        return this.request("GET", "/api/chat/models");
    }
    // ── Registry ───────────────────────────────────────────────────
    async registry(refresh) {
        return this.request("GET", "/api/registry", undefined, refresh ? { refresh: "true" } : undefined);
    }
    async refreshRegistry() {
        return this.request("POST", "/api/registry/refresh");
    }
    // ── Audit ──────────────────────────────────────────────────────
    async queryAudit(opts) {
        return this.request("GET", "/api/audit", undefined, {
            action: opts?.action,
            limit: opts?.limit?.toString(),
            offset: opts?.offset?.toString(),
        });
    }
    async auditStats() {
        return this.request("GET", "/api/audit/stats");
    }
    // ── Budget ─────────────────────────────────────────────────────
    async budgetSummary(userID) {
        return this.request("GET", "/api/budget/summary", undefined, {
            userID: userID ?? "default",
        });
    }
    // ── Policies ───────────────────────────────────────────────────
    async policyStatus() {
        return this.request("GET", "/api/policies");
    }
    // ── Skills ─────────────────────────────────────────────────────
    async listSkills() {
        return this.request("GET", "/api/skills");
    }
    async getSkill(id) {
        return this.request("GET", `/api/skills/${encodeURIComponent(id)}`);
    }
    async searchSkills(query) {
        return this.request("GET", "/api/skills/search", undefined, { q: query });
    }
    async skillCategories() {
        return this.request("GET", "/api/skills/categories");
    }
    // ── Provider Auth ──────────────────────────────────────────────
    async setCloudProviderKey(providerID, apiKey) {
        return this.request("POST", `/api/registry/cloud/${encodeURIComponent(providerID)}/key`, { apiKey });
    }
    // ── HITL ───────────────────────────────────────────────────────
    async hitlPending() {
        return this.request("GET", "/api/hitl/pending");
    }
    async hitlStats() {
        return this.request("GET", "/api/hitl/stats");
    }
    async hitlResolved() {
        return this.request("GET", "/api/hitl/resolved");
    }
    async resolveHitl(requestId, decision) {
        return this.request("POST", `/api/hitl/resolve/${encodeURIComponent(requestId)}`, { decision });
    }
    // ── Auth ────────────────────────────────────────────────────────
    async login(email, password) {
        return this.request("POST", "/api/auth/login", { email, password });
    }
    async register(email, password, fullName) {
        return this.request("POST", "/api/auth/register", { email, password, fullName });
    }
    async me() {
        return this.request("GET", "/api/auth/me");
    }
    async updateProfile(fullName) {
        return this.request("PATCH", "/api/auth/profile", { fullName });
    }
    async listApiKeys() {
        return this.request("GET", "/api/auth/api-keys");
    }
    async getActiveKey() {
        return this.request("GET", "/api/auth/api-keys/active");
    }
    async saveApiKey(apiKey, displayName, gatewayUrl) {
        return this.request("POST", "/api/auth/api-keys", { apiKey, displayName, gatewayUrl });
    }
    async verifyApiKey(apiKey, gatewayUrl) {
        return this.request("POST", "/api/auth/api-keys/verify", { apiKey, gatewayUrl });
    }
    async revokeApiKey(id) {
        return this.request("DELETE", `/api/auth/api-keys/${encodeURIComponent(id)}`);
    }
    /** Update the Authorization header (e.g. after login) */
    setToken(token) {
        this.headers["authorization"] = `Bearer ${token}`;
    }
    /** Remove auth token (logout) */
    clearToken() {
        delete this.headers["authorization"];
    }
}
exports.ThirdwaveClient = ThirdwaveClient;
//# sourceMappingURL=ThirdwaveClient.js.map