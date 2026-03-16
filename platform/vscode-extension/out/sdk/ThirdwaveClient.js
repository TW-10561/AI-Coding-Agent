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
    async request(method, path, body, params) {
        const res = await fetch(this.url(path, params), {
            method,
            headers: this.headers,
            body: body ? JSON.stringify(body) : undefined,
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
    async directChat(opts) {
        return this.request("POST", "/api/chat", opts);
    }
    /**
     * Stream chat via SSE — returns an async iterator of text chunks.
     * Falls back to non-streaming direct chat on error.
     */
    async chatStream(opts) {
        const body = {
            message: opts.message,
            modelID: opts.model || undefined,
            maxTokens: opts.maxTokens ?? 4096,
            temperature: opts.temperature ?? 0.3,
            history: opts.history,
        };
        const res = await fetch(this.url("/api/chat/stream"), {
            method: "POST",
            headers: this.headers,
            body: JSON.stringify(body),
        });
        if (!res.ok || !res.body) {
            // Fallback to non-streaming
            const direct = await this.directChat({
                message: opts.message,
                modelID: opts.model || undefined,
                maxTokens: opts.maxTokens,
                temperature: opts.temperature,
                history: opts.history,
            });
            return (async function* () { yield direct.text; })();
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        return {
            [Symbol.asyncIterator]() {
                return {
                    async next() {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done)
                                return { done: true, value: undefined };
                            const text = decoder.decode(value, { stream: true });
                            // Parse SSE: lines starting with "data: "
                            const chunks = [];
                            for (const line of text.split("\n")) {
                                if (line.startsWith("data: ")) {
                                    const data = line.slice(6);
                                    if (data === "[DONE]")
                                        continue;
                                    try {
                                        const parsed = JSON.parse(data);
                                        const delta = parsed.choices?.[0]?.delta?.content;
                                        if (delta)
                                            chunks.push(delta);
                                    }
                                    catch {
                                        // Not JSON — might be raw text
                                        if (data.trim())
                                            chunks.push(data);
                                    }
                                }
                            }
                            if (chunks.length > 0)
                                return { done: false, value: chunks.join("") };
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
}
exports.ThirdwaveClient = ThirdwaveClient;
//# sourceMappingURL=ThirdwaveClient.js.map