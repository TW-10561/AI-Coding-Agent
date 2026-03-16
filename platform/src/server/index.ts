// ---------------------------------------------------------------------------
// Platform server — slim Hono backend that wraps self-hosted OpenCode
// ---------------------------------------------------------------------------
//
// Architecture:
//   Client  →  Platform (:3100)  →  OpenCode engine (:4096)
//
// The platform adds:  auth, rate-limiting, task queue, event fan-out,
// clean REST API, and the SDK entry-point.
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import { cors } from "hono/cors"
import { env } from "../config/env"
import { OpenCodeClient } from "../services/opencode-client"
import { TaskQueue } from "../services/task-queue"
import { AuditLogger } from "../services/audit-logger"
import { BudgetManager } from "../services/budget-manager"
import { SubagentOrchestrator } from "../services/subagent-orchestrator"
import { WorkspaceManager } from "../services/workspace-manager"
import { TaskStateTracker } from "../services/task-state-tracker"
import { ScalableQueue } from "../services/scalable-queue"
import { ParallelExecutionManager } from "../services/parallel-executor"
import { authMiddleware } from "../middleware/auth"
import { loggerMiddleware } from "../middleware/logger"
import { rateLimitMiddleware, rateLimitCleanupInterval } from "../middleware/rate-limit"
import { healthRoutes } from "./routes/health"
import { sessionRoutes } from "./routes/sessions"
import { taskRoutes } from "./routes/tasks"
import { providerRoutes } from "./routes/providers"
import { fileRoutes } from "./routes/files"
import { eventRoutes } from "./routes/events"
import { auditRoutes } from "./routes/audit"
import { budgetRoutes } from "./routes/budget"
import { workspaceRoutes } from "./routes/workspaces"
import { orchestrationRoutes } from "./routes/orchestrations"
import { queueRoutes } from "./routes/queue"
import { parallelRoutes } from "./routes/parallel"
import { registryRoutes } from "./routes/registry"
import { chatRoutes } from "./routes/chat"
import { skillRoutes } from "./routes/skills"
import { policyRoutes } from "./routes/policies"
import { SkillManager } from "../services/skill-manager"
import { PolicyEngine } from "../services/policy-engine"
import { buildRegistry, startRegistryPolling } from "../services/provider-registry"

// ── Instantiate services ──────────────────────────────────────────────

const client = new OpenCodeClient({
  url: env.OPENCODE_URL,
  directory: env.OPENCODE_DIR,
  username: env.OPENCODE_SERVER_USERNAME,
  password: env.OPENCODE_SERVER_PASSWORD,
})

const queue = new TaskQueue({ client, concurrency: 4 })

// ── New production services ──────────────────────────────────────────

const dataDir = env.OPENCODE_DIR + "/.platform"

// Ensure data directory exists
import { mkdirSync, readFileSync } from "fs"
import { resolve } from "path"
try { mkdirSync(dataDir, { recursive: true }) } catch {}

const audit = new AuditLogger({ dbPath: dataDir + "/audit.db" })
const budget = new BudgetManager({ dbPath: dataDir + "/budget.db" })
const workspaces = new WorkspaceManager({ dbPath: dataDir + "/workspaces.db" })
const taskTracker = new TaskStateTracker({ dbPath: dataDir + "/tasks.db" })
const scalableQueue = new ScalableQueue({
  client,
  tracker: taskTracker,
  audit,
  budget,
  concurrency: 4,
  maxQueueDepth: 200,
})
const orchestrator = new SubagentOrchestrator({ client, audit })
const parallelExecutor = new ParallelExecutionManager({
  client,
  tracker: taskTracker,
  audit,
})

// Skill knowledge base
const skills = new SkillManager({
  skillsDir: env.OPENCODE_DIR + "/platform/skills",
})
skills.load()
console.log(`[skills] Loaded ${skills.count()} skills`)

// Policy engine
const policyEngine = new PolicyEngine({}, audit)
console.log(`[policies] Security policy engine initialized`)

// Wire audit into the module-level default policy engine (used by chat + tools)
import { defaultPolicyEngine } from "../services/policy-engine"
defaultPolicyEngine.setAudit(audit)

// Start the scalable queue
scalableQueue.start()

// Start gateway polling — probes every 30 s and logs status changes
startRegistryPolling(30_000)

// ── Build app ─────────────────────────────────────────────────────────

const app = new Hono()

// Global middleware
app.use("*", loggerMiddleware)
app.use("*", cors({ origin: "*" }))
app.use("/api/*", rateLimitMiddleware)
app.use("/api/*", authMiddleware)

// Audit middleware — wraps all API calls
app.use("/api/*", async (c, next) => {
  const start = Date.now()
  const method = c.req.method
  const path = c.req.path
  try {
    await next()
    audit.log({
      action: "api.request",
      userID: "default",
      metadata: { method, path, status: c.res.status, duration: Date.now() - start },
      success: c.res.status < 400,
    })
  } catch (err) {
    audit.log({
      action: "api.request",
      userID: "default",
      metadata: { method, path, error: String(err), duration: Date.now() - start },
      success: false,
    })
    throw err
  }
})

// ── Root landing page ────────────────────────────────────────────────
app.get("/", async (c) => {
  const health = await client.health().catch(() => ({ ok: false }))
  // Use our provider registry — not OpenCode
  let registry: any = { local: [], cloud: [] }
  try { registry = await buildRegistry() } catch {}

  // Escape HTML to prevent XSS from dynamic model/provider names
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thirdwave AI Coding Platform</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', -apple-system, sans-serif; background: #0a0a0f; color: #e0e0e8; min-height: 100vh; }
    .container { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
    h1 { font-size: 2rem; font-weight: 700; background: linear-gradient(135deg, #6366f1, #a855f7, #ec4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 4px; }
    .subtitle { color: #888; font-size: 0.9rem; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; margin-bottom: 24px; }
    .card { background: #13131a; border: 1px solid #1e1e2e; border-radius: 12px; padding: 18px; }
    .card h3 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; color: #666; margin-bottom: 10px; }
    .status { display: flex; align-items: center; gap: 8px; font-size: 1rem; font-weight: 600; }
    .dot { width: 10px; height: 10px; border-radius: 50%; }
    .dot.ok { background: #22c55e; box-shadow: 0 0 8px #22c55e88; }
    .dot.err { background: #ef4444; box-shadow: 0 0 8px #ef444488; }

    .tabs { display: flex; gap: 4px; margin-bottom: 16px; flex-wrap: wrap; }
    .tab { background: #1a1a24; border: 1px solid #2a2a3a; border-radius: 8px; padding: 8px 16px; cursor: pointer; color: #888; font-size: 0.85rem; transition: all 0.2s; }
    .tab:hover { background: #22223a; color: #e0e0e8; }
    .tab.active { background: #6366f1; border-color: #6366f1; color: #fff; }
    .panel { display: none; }
    .panel.active { display: block; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; padding: 8px 12px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: #555; border-bottom: 1px solid #1e1e2e; }
    td { padding: 7px 12px; font-size: 0.85rem; border-bottom: 1px solid #111118; }
    td a { color: #818cf8; text-decoration: none; }
    td a:hover { text-decoration: underline; }
    code { background: #1a1a24; padding: 2px 6px; border-radius: 4px; font-size: 0.82rem; color: #a78bfa; }
    .ok-text { color: #22c55e; } .err-text { color: #ef4444; } .warn-text { color: #f59e0b; }
    .footer { margin-top: 32px; color: #333; font-size: 0.75rem; text-align: center; }
    pre { background: #0e0e16; border: 1px solid #1e1e2e; border-radius: 8px; padding: 14px; overflow-x: auto; font-size: 0.82rem; color: #c4b5fd; max-height: 400px; overflow-y: auto; }
    .btn { background: #6366f1; color: #fff; border: none; border-radius: 8px; padding: 8px 18px; cursor: pointer; font-size: 0.85rem; margin: 4px; transition: background 0.2s; }
    .btn:hover { background: #4f46e5; }
    .btn.secondary { background: #1e1e2e; color: #a78bfa; border: 1px solid #2e2e3e; }
    .btn.secondary:hover { background: #2a2a3e; }
    .stat-num { font-size: 1.8rem; font-weight: 700; color: #e0e0e8; }
    .stat-label { font-size: 0.75rem; color: #666; margin-top: 2px; }
    #output { margin-top: 12px; }
    .refresh-note { color: #555; font-size: 0.75rem; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Thirdwave AI Coding Platform</h1>
    <p class="subtitle">Self-hosted AI coding engine powered by local vLLM &mdash; no cloud APIs</p>

    <div class="grid">
      <div class="card">
        <h3>Platform</h3>
        <div class="status"><span class="dot ok"></span> Running on :${env.PORT}</div>
      </div>
      <div class="card">
        <h3>OpenCode Engine</h3>
        <div class="status"><span class="dot ${health.ok ? 'ok' : 'err'}"></span> ${health.ok ? 'Connected' : 'Unreachable'}</div>
      </div>
      <div class="card">
        <h3>LLM Provider</h3>
        <div class="status"><span class="dot ${registry.local.length > 0 ? 'ok' : 'err'}"></span> ${registry.local.length} local vLLM + ${registry.cloud.filter((p: any) => p.configured).length} cloud</div>
      </div>
    </div>

    <!-- Tabbed Dashboard -->
    <div class="tabs">
      <div class="tab active" data-tab="audit">Audit Logs</div>
      <div class="tab" data-tab="budget">Budget</div>
      <div class="tab" data-tab="workspaces">Workspaces</div>
      <div class="tab" data-tab="queue">Queue</div>
      <div class="tab" data-tab="orchestrations">Orchestrations</div>
      <div class="tab" data-tab="parallel">Parallel</div>
      <div class="tab" data-tab="sessions">Sessions</div>
      <div class="tab" data-tab="models">Models</div>
      <div class="tab" data-tab="api">API Reference</div>
    </div>

    <!-- AUDIT PANEL -->
    <div class="panel active" id="panel-audit">
      <div class="card">
        <h3>Audit Statistics</h3>
        <div class="grid" id="audit-stats" style="margin-bottom:0"><div style="color:#666">Loading...</div></div>
      </div>
      <div class="card" style="margin-top:14px">
        <h3>Recent Audit Entries <button class="btn secondary" style="float:right;padding:4px 12px;font-size:0.75rem" onclick="loadAudit()">Refresh</button></h3>
        <pre id="audit-entries">Loading...</pre>
      </div>
    </div>

    <!-- BUDGET PANEL -->
    <div class="panel" id="panel-budget">
      <div class="card">
        <h3>Budget Check <button class="btn secondary" style="float:right;padding:4px 12px;font-size:0.75rem" onclick="loadBudget()">Refresh</button></h3>
        <div id="budget-check" style="margin-bottom:12px;color:#666">Loading...</div>
        <h3>Usage Summary</h3>
        <pre id="budget-summary">Loading...</pre>
      </div>
    </div>

    <!-- WORKSPACES PANEL -->
    <div class="panel" id="panel-workspaces">
      <div class="card">
        <h3>Workspaces <button class="btn secondary" style="float:right;padding:4px 12px;font-size:0.75rem" onclick="loadWorkspaces()">Refresh</button></h3>
        <pre id="workspaces-list">Loading...</pre>
      </div>
    </div>

    <!-- QUEUE PANEL -->
    <div class="panel" id="panel-queue">
      <div class="card">
        <h3>Queue Metrics <button class="btn secondary" style="float:right;padding:4px 12px;font-size:0.75rem" onclick="loadQueue()">Refresh</button></h3>
        <pre id="queue-metrics">Loading...</pre>
      </div>
    </div>

    <!-- ORCHESTRATIONS PANEL -->
    <div class="panel" id="panel-orchestrations">
      <div class="card">
        <h3>Orchestrations <button class="btn secondary" style="float:right;padding:4px 12px;font-size:0.75rem" onclick="loadOrchestrations()">Refresh</button></h3>
        <pre id="orchestrations-list">Loading...</pre>
      </div>
    </div>

    <!-- PARALLEL PANEL -->
    <div class="panel" id="panel-parallel">
      <div class="card">
        <h3>Parallel Executions <button class="btn secondary" style="float:right;padding:4px 12px;font-size:0.75rem" onclick="loadParallel()">Refresh</button></h3>
        <pre id="parallel-list">Loading...</pre>
      </div>
    </div>

    <!-- SESSIONS PANEL -->
    <div class="panel" id="panel-sessions">
      <div class="card">
        <h3>Sessions <button class="btn secondary" style="float:right;padding:4px 12px;font-size:0.75rem" onclick="loadSessions()">Refresh</button></h3>
        <pre id="sessions-list">Loading...</pre>
      </div>
    </div>

    <!-- MODELS PANEL -->
    <div class="panel" id="panel-models">
      <div class="card">
        <h3>Local vLLM Models <button class="btn secondary" style="float:right;padding:4px 12px;font-size:0.75rem" onclick="loadModels()">Refresh</button></h3>
        <div id="local-models">
          ${registry.local.map((p: any) => `
            <div style="margin-bottom:14px;padding:12px;background:#0e0e16;border:1px solid #1e1e2e;border-radius:8px">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                <span class="dot ${p.status === 'online' ? 'ok' : 'err'}"></span>
                <strong style="color:#e0e0e8">${esc(p.name)}</strong>
                <span style="color:${p.status === 'online' ? '#22c55e' : '#ef4444'};font-size:0.85rem">${esc(p.status)}${p.latencyMs ? ' (' + p.latencyMs + 'ms)' : ''}</span>
              </div>
              <div style="color:#666;font-size:0.8rem;margin-bottom:4px">${esc(p.endpoint)}</div>
              ${p.models.map((m: any) => `
                <div style="color:#a78bfa;font-size:0.85rem;padding:2px 0 2px 16px">
                  → ${esc(m.name || m.id)} ${m.contextLimit ? '<span style="color:#555">ctx:' + Math.floor(m.contextLimit/1000) + 'k</span>' : ''} ${m.outputLimit ? '<span style="color:#555">out:' + m.outputLimit + '</span>' : ''}
                </div>
              `).join('')}
            </div>
          `).join('')}
          ${registry.local.length === 0 ? '<div style="color:#666;padding:12px">No vLLM endpoints configured</div>' : ''}
        </div>
      </div>
      <div class="card" style="margin-top:14px">
        <h3>Cloud Providers</h3>
        <div id="cloud-providers">
          <div style="color:#666;font-size:0.85rem">Loading...</div>
        </div>
      </div>
    </div>

    <!-- API PANEL -->
    <div class="panel" id="panel-api">
      <div class="card">
        <h3>API Endpoints</h3>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
          <tbody>
            <tr><td><code>GET</code></td><td><a href="/health">/health</a></td><td>Health status</td></tr>
            <tr><td><code>GET</code></td><td><a href="/api/providers">/api/providers</a></td><td>List providers &amp; models</td></tr>
            <tr><td><code>GET</code></td><td><a href="/api/sessions">/api/sessions</a></td><td>List chat sessions</td></tr>
            <tr><td><code>POST</code></td><td>/api/sessions</td><td>Create new session</td></tr>
            <tr><td><code>POST</code></td><td>/api/sessions/:id/prompt</td><td>Send prompt to LLM</td></tr>
            <tr><td><code>GET</code></td><td><a href="/api/audit">/api/audit</a></td><td>Audit logs</td></tr>
            <tr><td><code>GET</code></td><td><a href="/api/audit/stats">/api/audit/stats</a></td><td>Audit statistics</td></tr>
            <tr><td><code>GET</code></td><td><a href="/api/budget/summary">/api/budget/summary</a></td><td>Budget usage</td></tr>
            <tr><td><code>GET</code></td><td><a href="/api/budget/check">/api/budget/check</a></td><td>Budget check</td></tr>
            <tr><td><code>GET</code></td><td><a href="/api/workspaces">/api/workspaces</a></td><td>List workspaces</td></tr>
            <tr><td><code>GET</code></td><td><a href="/api/queue/metrics">/api/queue/metrics</a></td><td>Queue metrics</td></tr>
            <tr><td><code>GET</code></td><td><a href="/api/orchestrations">/api/orchestrations</a></td><td>Orchestrations</td></tr>
            <tr><td><code>GET</code></td><td><a href="/api/parallel">/api/parallel</a></td><td>Parallel executions</td></tr>
            <tr><td><code>GET</code></td><td><a href="/api/config">/api/config</a></td><td>Configuration</td></tr>
            <tr><td><code>GET</code></td><td><a href="/api/project">/api/project</a></td><td>Project info</td></tr>
            <tr><td><code>GET</code></td><td><a href="/api/files">/api/files</a></td><td>Project files</td></tr>
            <tr><td><code>GET</code></td><td><a href="/api/vcs">/api/vcs</a></td><td>VCS status</td></tr>
            <tr><td><code>GET</code></td><td><a href="/api/registry">/api/registry</a></td><td>Provider registry (vLLM + cloud)</td></tr>
            <tr><td><code>POST</code></td><td>/api/chat</td><td>Direct LLM chat</td></tr>
            <tr><td><code>GET</code></td><td><a href="/api/skills">/api/skills</a></td><td>List all skills</td></tr>
            <tr><td><code>GET</code></td><td>/api/skills/search?q=</td><td>Search skills</td></tr>
            <tr><td><code>GET</code></td><td><a href="/api/skills/categories">/api/skills/categories</a></td><td>Skills by category</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="footer">Thirdwave v0.1.0 &mdash; OpenCode Engine &mdash; vLLM Local Inference</div>
  </div>

  <script>
    const API = '';
    async function fetchJSON(path) {
      const res = await fetch(API + path);
      return res.json();
    }
    function pretty(obj) { return JSON.stringify(obj, null, 2); }
    function esc(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
        // Auto-load data for the tab
        const loaders = { audit: loadAudit, budget: loadBudget, workspaces: loadWorkspaces, queue: loadQueue, orchestrations: loadOrchestrations, parallel: loadParallel, sessions: loadSessions, models: loadModels };
        if (loaders[tab.dataset.tab]) loaders[tab.dataset.tab]();
      });
    });

    async function loadAudit() {
      try {
        const stats = await fetchJSON('/api/audit/stats');
        document.getElementById('audit-stats').innerHTML =
          '<div class="card" style="padding:12px;text-align:center"><div class="stat-num">' + (stats.total||0) + '</div><div class="stat-label">Total Requests</div></div>' +
          '<div class="card" style="padding:12px;text-align:center"><div class="stat-num ' + (stats.errors > 0 ? 'err-text' : 'ok-text') + '">' + (stats.errors||0) + '</div><div class="stat-label">Errors</div></div>' +
          '<div class="card" style="padding:12px;text-align:center"><div class="stat-num">' + (stats.avgDuration||0) + '</div><div class="stat-label">Avg Duration (ms)</div></div>';

        const entries = await fetchJSON('/api/audit?limit=20');
        if (entries.length === 0) {
          document.getElementById('audit-entries').textContent = 'No audit entries yet.';
        } else {
          document.getElementById('audit-entries').textContent = entries.map(e => {
            const t = new Date(e.timestamp).toLocaleTimeString();
            const meta = typeof e.metadata === 'object' ? (e.metadata || {}) : (e.metadata ? JSON.parse(e.metadata) : {});
            return (e.success ? 'OK' : 'ERR') + '  ' + t + '  ' + e.action + '  ' + (meta.method||'') + ' ' + (meta.path||'');
          }).join('\\n');
        }
      } catch(e) { document.getElementById('audit-entries').textContent = 'Error: ' + e; }
    }

    async function loadBudget() {
      try {
        const check = await fetchJSON('/api/budget/check');
        document.getElementById('budget-check').innerHTML =
          '<span class="' + (check.allowed ? 'ok-text' : 'err-text') + '" style="font-size:1.2rem;font-weight:600">' +
          (check.allowed ? '\\u2705 Budget OK — requests allowed' : '\\u274C Budget exceeded — requests blocked') + '</span>';

        const summary = await fetchJSON('/api/budget/summary');
        document.getElementById('budget-summary').textContent = pretty(summary);
      } catch(e) { document.getElementById('budget-summary').textContent = 'Error: ' + e; }
    }

    async function loadWorkspaces() {
      try {
        const list = await fetchJSON('/api/workspaces');
        if (list.length === 0) {
          document.getElementById('workspaces-list').textContent = 'No workspaces yet.\\nCreate one: POST /api/workspaces { "name": "my-project", "directory": "/path/to/project" }';
        } else {
          document.getElementById('workspaces-list').textContent = list.map(ws =>
            (ws.active ? '[ACTIVE] ' : '         ') + ws.name + '  ' + ws.id.slice(0,8) + '\\n         ' + ws.directory + (ws.tags?.length ? '  tags: ' + ws.tags.join(', ') : '')
          ).join('\\n\\n');
        }
      } catch(e) { document.getElementById('workspaces-list').textContent = 'Error: ' + e; }
    }

    async function loadQueue() {
      try {
        const m = await fetchJSON('/api/queue/metrics');
        document.getElementById('queue-metrics').textContent = pretty(m);
      } catch(e) { document.getElementById('queue-metrics').textContent = 'Error: ' + e; }
    }

    async function loadOrchestrations() {
      try {
        const list = await fetchJSON('/api/orchestrations');
        if (list.length === 0) {
          document.getElementById('orchestrations-list').textContent = 'No orchestrations yet.\\nStart one: POST /api/orchestrations { "name": "...", "tasks": [...] }';
        } else {
          document.getElementById('orchestrations-list').textContent = pretty(list);
        }
      } catch(e) { document.getElementById('orchestrations-list').textContent = 'Error: ' + e; }
    }

    async function loadParallel() {
      try {
        const list = await fetchJSON('/api/parallel');
        if (list.length === 0) {
          document.getElementById('parallel-list').textContent = 'No parallel executions yet.\\nStart one: POST /api/parallel { "name": "...", "tasks": [...] }';
        } else {
          document.getElementById('parallel-list').textContent = pretty(list);
        }
      } catch(e) { document.getElementById('parallel-list').textContent = 'Error: ' + e; }
    }

    async function loadSessions() {
      try {
        const list = await fetchJSON('/api/sessions');
        if (list.length === 0) {
          document.getElementById('sessions-list').textContent = 'No sessions yet.';
        } else {
          document.getElementById('sessions-list').textContent = list.slice(0, 20).map(s =>
            s.id.slice(0,12) + '  ' + (s.title || '(untitled)') + '\\n  ' + new Date(s.time?.created || s.createdAt).toLocaleString()
          ).join('\\n\\n');
        }
      } catch(e) { document.getElementById('sessions-list').textContent = 'Error: ' + e; }
    }

    async function loadModels() {
      try {
        const reg = await fetchJSON('/api/registry');
        let html = '<h4 style="color:#888;margin-bottom:8px">Local vLLM</h4>';
        if (reg.local && reg.local.length > 0) {
          for (const p of reg.local) {
            const dot = p.status === 'online' ? '<span class="dot ok"></span>' : '<span class="dot err"></span>';
            html += '<div style="margin-bottom:12px;padding:10px;background:#0e0e16;border:1px solid #1e1e2e;border-radius:8px">';
            html += '<div style="display:flex;align-items:center;gap:8px">' + dot + ' <strong>' + esc(p.name) + '</strong> <span style="color:' + (p.status==='online'?'#22c55e':'#ef4444') + '">' + esc(p.status) + '</span></div>';
            html += '<div style="color:#555;font-size:0.8rem">' + esc(p.endpoint) + '</div>';
            for (const m of p.models) {
              html += '<div style="color:#a78bfa;padding:2px 0 2px 16px">→ ' + esc(m.name||m.id) + (m.contextLimit ? ' <span style="color:#555">ctx:'+Math.floor(m.contextLimit/1000)+'k</span>':'') + '</div>';
            }
            html += '</div>';
          }
        } else { html += '<div style="color:#666">No local vLLM endpoints</div>'; }
        document.getElementById('local-models').innerHTML = html;
        // Cloud providers → separate container
        let cloudHtml = '';
        if (reg.cloud) {
          for (const p of reg.cloud) {
            cloudHtml += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #111118"><span style="color:' + (p.configured?'#22c55e':'#555') + '">' + (p.configured?'✓':'○') + '</span> <span style="color:#e0e0e8">' + esc(p.name) + '</span> <span style="color:' + (p.configured?'#22c55e':'#666') + ';font-size:0.82rem">' + (p.configured?'Configured':'No API key — use /apikey in TUI') + '</span></div>';
          }
        }
        if (!cloudHtml) cloudHtml = '<div style="color:#666">No cloud providers</div>';
        document.getElementById('cloud-providers').innerHTML = cloudHtml;
      } catch(e) { document.getElementById('local-models').innerHTML = 'Error: ' + e; }
    }

    // Auto-load first tab
    loadAudit();
  </script>
</body>
</html>`

  return c.html(html)
})

// Mount routes
app.route("/health", healthRoutes(client))
app.route("/api/sessions", sessionRoutes(client))
app.route("/api/tasks", taskRoutes(queue, scalableQueue, taskTracker))
app.route("/api/providers", providerRoutes(client))
app.route("/api/files", fileRoutes(client))
app.route("/api/events", eventRoutes(client, queue))

// New production routes
app.route("/api/audit", auditRoutes(audit))
app.route("/api/budget", budgetRoutes(budget))
app.route("/api/workspaces", workspaceRoutes(workspaces))
app.route("/api/orchestrations", orchestrationRoutes(orchestrator))
app.route("/api/queue", queueRoutes(scalableQueue, taskTracker))
app.route("/api/parallel", parallelRoutes(parallelExecutor))
app.route("/api/registry", registryRoutes())
app.route("/api/chat", chatRoutes())
app.route("/api/skills", skillRoutes(skills))
app.route("/api/policies", policyRoutes(policyEngine))

// ── CLI client download routes (no auth) ─────────────────────────────
// These serve the user-facing CLI tool. Users run:
//   curl -fsSL http://SERVER/api/install | bash

const binDir = resolve(import.meta.dir, "../../bin")

app.get("/api/client", (c) => {
  try {
    const script = readFileSync(resolve(binDir, "thirdwave-client"), "utf-8")
    // Patch the default server URL to this server's actual address
    const host = c.req.header("host") ?? `${env.HOST}:${env.PORT}`
    const proto = c.req.header("x-forwarded-proto") ?? "http"
    const patched = script.replace(
      /THIRDWAVE_SERVER="\$\{THIRDWAVE_SERVER:-[^"]*\}"/,
      `THIRDWAVE_SERVER="\${THIRDWAVE_SERVER:-${proto}://${host}}"`,
    )
    c.header("Content-Type", "text/plain; charset=utf-8")
    c.header("Content-Disposition", 'attachment; filename="art"')
    return c.body(patched)
  } catch (e: any) {
    return c.json({ error: "Client script not found", detail: e.message }, 500)
  }
})

app.get("/api/install", (c) => {
  try {
    const script = readFileSync(resolve(binDir, "install.sh"), "utf-8")
    const host = c.req.header("host") ?? `${env.HOST}:${env.PORT}`
    const proto = c.req.header("x-forwarded-proto") ?? "http"
    const patched = script.replace(
      /SERVER="\$\{THIRDWAVE_SERVER:-[^"]*\}"/,
      `SERVER="\${THIRDWAVE_SERVER:-${proto}://${host}}"`,
    )
    c.header("Content-Type", "text/plain; charset=utf-8")
    return c.body(patched)
  } catch (e: any) {
    return c.json({ error: "Install script not found", detail: e.message }, 500)
  }
})

// Convenience: project + config pass-through
app.get("/api/project", async (c) => c.json(await client.currentProject()))
app.get("/api/projects", async (c) => c.json(await client.projects()))
app.get("/api/config", async (c) => c.json(await client.config()))
app.patch("/api/config", async (c) => {
  const body = await c.req.json()
  return c.json(await client.updateConfig(body))
})
app.get("/api/vcs", async (c) => c.json(await client.vcs()))
app.get("/api/paths", async (c) => c.json(await client.paths()))

// Global error handler
app.onError((err, c) => {
  console.error("[platform] unhandled error:", err)

  // Zod validation errors → 400
  if (err.constructor.name === "ZodError") {
    return c.json(
      { error: "ValidationError", message: err.message, issues: (err as any).issues },
      400 as any,
    )
  }

  const status = "status" in err && typeof err.status === "number" ? err.status : 500
  return c.json(
    {
      error: err.constructor.name,
      message: err.message,
      ...(env.NODE_ENV === "development" && { stack: err.stack }),
    },
    status as any,
  )
})

// 404
app.notFound((c) => c.json({ error: "not_found", message: `${c.req.method} ${c.req.path} not found` }, 404))

// ── Start ─────────────────────────────────────────────────────────────

let serverPort = env.PORT

// Auto-find a free port if requested (multi-user support)
if (env.AUTO_PORT) {
  const { findFreePort } = await import("../config/env")
  try {
    serverPort = findFreePort(env.PORT, env.HOST)
    if (serverPort !== env.PORT) {
      console.log(`[platform] Port ${env.PORT} busy — using ${serverPort}`)
    }
  } catch (e: any) {
    console.error(`[platform] ${e.message}`)
    process.exit(1)
  }
}

const server = Bun.serve({
  port: serverPort,
  hostname: env.HOST,
  fetch: app.fetch,
  idleTimeout: 0,
})

console.log(`
┌─────────────────────────────────────────────────┐
│  Thirdwave AI Coding Platform                     │
│  Platform  →  http://${server.hostname}:${server.port}            │
│  OpenCode  →  ${env.OPENCODE_URL}               │
│  Env       →  ${env.NODE_ENV}                   │
└─────────────────────────────────────────────────┘
`)

/** Gracefully stop the platform server and services */
async function shutdownPlatform() {
  console.log("[platform] Shutting down server...")
  try { server.stop(true) } catch {}
  try { scalableQueue.stop() } catch {}
  try { audit.dispose() } catch {}
  try { taskTracker.dispose() } catch {}
  try { workspaces.dispose() } catch {}
  try { budget.dispose() } catch {}
  try { clearInterval(rateLimitCleanupInterval) } catch {}
  console.log("[platform] Server stopped.")
}

// ── Process-level crash protection ───────────────────────────────────
// Prevent silent exits from unhandled rejections and exceptions.
process.on("uncaughtException", (err) => {
  console.error("[platform] FATAL uncaughtException:", err)
  audit.log({ action: "system.error", userID: "system", metadata: { error: String(err), stack: err.stack }, success: false })
  // Flush audit before exiting
  try { audit.dispose() } catch {}
  process.exit(1)
})

process.on("unhandledRejection", (reason) => {
  console.error("[platform] unhandledRejection:", reason)
  // Log but don't crash — many libraries leave floating promises
})

// Handle SIGTERM gracefully (Docker, systemd, manual kill)
process.on("SIGTERM", async () => {
  console.log("[platform] Received SIGTERM — shutting down...")
  await shutdownPlatform()
  process.exit(0)
})

process.on("SIGINT", async () => {
  console.log("[platform] Received SIGINT — shutting down...")
  await shutdownPlatform()
  process.exit(0)
})

export { app, server, shutdownPlatform }
