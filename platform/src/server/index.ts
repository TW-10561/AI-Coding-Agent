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
import { rateLimitMiddleware } from "../middleware/rate-limit"
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
import { mkdirSync } from "fs"
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

// Start the scalable queue
scalableQueue.start()

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
      action: "api.request" as any,
      userID: "default",
      metadata: { method, path, status: c.res.status, duration: Date.now() - start },
      success: c.res.status < 400,
    })
  } catch (err) {
    audit.log({
      action: "api.request" as any,
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
  let providerInfo = { providers: [] as any[], models: [] as string[] }
  try {
    const result = await client.providers()
    const providers = (result as any).all ?? []
    providerInfo.providers = providers
    for (const p of providers) {
      const models = p.models ?? {}
      for (const [key, m] of Object.entries(models)) {
        providerInfo.models.push(`${p.id}/${(m as any).name ?? key}`)
      }
    }
  } catch {}

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Artemis AI Coding Platform</title>
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
    .model-tag { display: inline-block; background: #1e1e2e; border: 1px solid #2e2e3e; border-radius: 6px; padding: 3px 8px; margin: 2px; font-size: 0.78rem; color: #a78bfa; }
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
    <h1>Artemis AI Coding Platform</h1>
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
        <div class="status"><span class="dot ${providerInfo.providers.length > 0 ? 'ok' : 'err'}"></span> ${providerInfo.providers.length > 0 ? 'vLLM (Local)' : 'No provider'}</div>
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
          </tbody>
        </table>
      </div>
    </div>

    <div class="footer">Artemis v0.1.0 &mdash; OpenCode Engine &mdash; vLLM Local Inference</div>
  </div>

  <script>
    const API = '';
    async function fetchJSON(path) {
      const res = await fetch(API + path);
      return res.json();
    }
    function pretty(obj) { return JSON.stringify(obj, null, 2); }

    // Tab switching
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
        // Auto-load data for the tab
        const loaders = { audit: loadAudit, budget: loadBudget, workspaces: loadWorkspaces, queue: loadQueue, orchestrations: loadOrchestrations, parallel: loadParallel, sessions: loadSessions };
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
app.route("/api/tasks", taskRoutes(queue))
app.route("/api/providers", providerRoutes(client))
app.route("/api/files", fileRoutes(client))
app.route("/api/events", eventRoutes(client, queue))

// New production routes
app.route("/api/audit", auditRoutes(audit))
app.route("/api/budget", budgetRoutes(budget))
app.route("/api/workspaces", workspaceRoutes(workspaces))
app.route("/api/orchestrations", orchestrationRoutes(orchestrator))
app.route("/api/queue", queueRoutes(scalableQueue))
app.route("/api/parallel", parallelRoutes(parallelExecutor))
app.route("/api/registry", registryRoutes())
app.route("/api/chat", chatRoutes())

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

const server = Bun.serve({
  port: env.PORT,
  hostname: env.HOST,
  fetch: app.fetch,
  idleTimeout: 0,
})

console.log(`
┌─────────────────────────────────────────────────┐
│  Artemis AI Coding Platform                     │
│  Platform  →  http://${server.hostname}:${server.port}            │
│  OpenCode  →  ${env.OPENCODE_URL}               │
│  Env       →  ${env.NODE_ENV}                   │
└─────────────────────────────────────────────────┘
`)

export { app }
