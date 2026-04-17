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
import { HITLService } from "../services/hitl-service"
import { ChatLogStore } from "../services/chat-log"
import { buildRegistry, startRegistryPolling } from "../services/provider-registry"
import { hitlRoutes } from "./routes/hitl"
import { authRoutes } from "./routes/auth"
import { adminRoutes } from "./routes/admin"
import { userService } from "../services/user-service"

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
import { resolve, join } from "path"
try { mkdirSync(dataDir, { recursive: true }) } catch {}

const audit = new AuditLogger({ dbPath: dataDir + "/audit.db" })
const budget = new BudgetManager({ dbPath: dataDir + "/budget.db" })
const workspaces = new WorkspaceManager({ dbPath: dataDir + "/workspaces.db" })
const chatLog = new ChatLogStore({ dbPath: dataDir + "/chat-log.db" })
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
  skillsDir: env.SKILLS_DIR || join(__dirname, "..", "..", "skills"),
})
skills.load()
console.log(`[skills] Loaded ${skills.count()} skills`)

// Policy engine
const policyEngine = new PolicyEngine({}, audit)
console.log(`[policies] Security policy engine initialized`)

// Wire audit into the module-level default policy engine (used by chat + tools)
import { defaultPolicyEngine } from "../services/policy-engine"
defaultPolicyEngine.setAudit(audit)

// HITL (Human-in-the-Loop) approval service — bridges policy engine with user approval workflow
const hitl = new HITLService(policyEngine, audit)
console.log(`[hitl] Human-in-the-Loop service initialized`)

// Wire HITL into tool executor so risky tool calls trigger approval flow
import { setToolHITL } from "../services/tool-executor"
setToolHITL(hitl)

// Start the scalable queue
scalableQueue.start()

// Start gateway polling — probes every 30 s and logs status changes
startRegistryPolling(30_000)

// Bootstrap admin user (creates admin@thirdwave.local if no users exist)
userService.ensureAdminExists().catch(e => console.warn(`[auth] Admin bootstrap skipped: ${e.message}`))

// ── Build app ─────────────────────────────────────────────────────────

const app = new Hono()

// Global middleware
app.use("*", loggerMiddleware)
app.use("*", cors({ origin: "*" }))
app.use("/api/*", rateLimitMiddleware)
// Auth routes are public (login/register) — mount before authMiddleware
app.route("/api/auth", authRoutes())
// Backward compatibility for older extension builds still calling /auth/*.
// NOTE: app.route("/auth", ...) doesn't work in Hono 4.x — use explicit handlers.
const legacyAuth = authRoutes()
app.post("/auth/register", (c) => legacyAuth.fetch(new Request(new URL("/register", c.req.url), c.req.raw)))
app.post("/auth/login", (c) => legacyAuth.fetch(new Request(new URL("/login", c.req.url), c.req.raw)))
app.get("/auth/me", (c) => legacyAuth.fetch(new Request(new URL("/me", c.req.url), c.req.raw)))
app.patch("/auth/profile", (c) => legacyAuth.fetch(new Request(new URL("/profile", c.req.url), c.req.raw)))
app.post("/auth/api-keys", (c) => legacyAuth.fetch(new Request(new URL("/api-keys", c.req.url), c.req.raw)))
app.get("/auth/api-keys", (c) => legacyAuth.fetch(new Request(new URL("/api-keys", c.req.url), c.req.raw)))
app.post("/auth/api-keys/verify", (c) => legacyAuth.fetch(new Request(new URL("/api-keys/verify", c.req.url), c.req.raw)))
app.delete("/auth/api-keys/:id", (c) => legacyAuth.fetch(new Request(new URL(`/api-keys/${c.req.param("id")}`, c.req.url), c.req.raw)))
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
  const modelIcon = (name: string): string => {
    const n = (name || '').toLowerCase()
    if (n.includes('gpt') || n.includes('openai')) return '🤖'
    if (n.includes('claude')) return '🟣'
    if (n.includes('gemini') || n.includes('bard') || n.includes('palm')) return '💎'
    if (n.includes('llama')) return '🦙'
    if (n.includes('qwen')) return '🐉'
    if (n.includes('mistral') || n.includes('mixtral')) return '🌊'
    if (n.includes('deepseek')) return '🔭'
    if (n.includes('phi')) return '🔬'
    if (n.includes('dall-e') || n.includes('dalle') || n.includes('flux') || n.includes('stable-diff')) return '🎨'
    if (n.includes('whisper') || n.includes('speech') || n.includes('tts') || n.includes('audio')) return '🎤'
    if (n.includes('embed') || n.includes('sentence') || n.includes('vector')) return '📊'
    if (n.includes('minimax')) return '✨'
    if (n.includes('codestral') || n.includes('starcoder') || n.includes('codegemma') || n.includes('coder')) return '💻'
    if (n.includes('yi')) return '🌟'
    if (n.includes('falcon')) return '🦅'
    if (n.includes('solar')) return '☀️'
    return '🧠'
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thirdwave AI Coding Platform</title>
  <style>
    /* ── CSS Reset & Base ─────────────────────────────────────────── */
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    /* ── Design Tokens (Dark) ─────────────────────────────────────── */
    :root {
      --bg: #07070e; --s1: #0c0c16; --s2: #10101c; --s3: #151524; --s4: #1b1b2c;
      --bd: #1c1c2e; --bd2: #232338; --bd3: #2b2b42;
      --fg: #dddde8; --mt: #6464a0; --dim: #38385a;
      --accent: #6366f1; --accent-h: #818cf8; --accent-soft: rgba(99,102,241,.1); --accent-glow: rgba(99,102,241,.25);
      --ok: #22c55e; --ok-bg: rgba(34,197,94,.08); --ok-bd: rgba(34,197,94,.25);
      --err: #ef4444; --err-bg: rgba(239,68,68,.08); --err-bd: rgba(239,68,68,.25);
      --warn: #f59e0b; --warn-bg: rgba(245,158,11,.08); --warn-bd: rgba(245,158,11,.25);
      --info: #3b82f6; --info-bg: rgba(59,130,246,.08); --info-bd: rgba(59,130,246,.25);
      --pre-bg: #060610; --code-fg: #a78bfa; --code-border: #232338;
      --card-shadow: 0 1px 3px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.025);
      --card-hover-shadow: 0 4px 16px rgba(0,0,0,.5), 0 0 0 1px rgba(99,102,241,.15);
      --btn-sec-bg: #141424; --btn-sec-fg: #a78bfa; --btn-sec-border: #252538;
      --sidebar-w: 220px;
      --glass-bg: rgba(12,12,22,.65);
      --glass-border: rgba(255,255,255,.06);
    }

    /* ── Design Tokens (Light) ────────────────────────────────────── */
    :root[data-theme="light"] {
      --bg: #f0f0f8; --s1: #ffffff; --s2: #f5f5fd; --s3: #ededf8; --s4: #e5e5f5;
      --bd: #dcdcee; --bd2: #cccce0; --bd3: #bcbcd8;
      --fg: #18182e; --mt: #8888b8; --dim: #bbbbdc;
      --accent: #5254e0; --accent-h: #4345c8; --accent-soft: rgba(82,84,224,.08); --accent-glow: rgba(82,84,224,.18);
      --ok: #16a34a; --ok-bg: rgba(22,163,74,.07); --ok-bd: rgba(22,163,74,.22);
      --err: #dc2626; --err-bg: rgba(220,38,38,.07); --err-bd: rgba(220,38,38,.22);
      --warn: #d97706; --warn-bg: rgba(217,119,6,.07); --warn-bd: rgba(217,119,6,.22);
      --info: #2563eb; --info-bg: rgba(37,99,235,.07); --info-bd: rgba(37,99,235,.22);
      --pre-bg: #ebebfa; --code-fg: #5b21b6; --code-border: #cccce0;
      --card-shadow: 0 1px 4px rgba(0,0,0,.07), 0 0 0 1px rgba(0,0,0,.04);
      --card-hover-shadow: 0 4px 14px rgba(0,0,0,.1), 0 0 0 1px rgba(82,84,224,.15);
      --btn-sec-bg: #eeeefd; --btn-sec-fg: #5254e0; --btn-sec-border: #d0d0f0;
      --glass-bg: rgba(255,255,255,.7);
      --glass-border: rgba(0,0,0,.06);
    }

    /* ── Body ─────────────────────────────────────────────────────── */
    body {
      font-family: -apple-system, 'Inter', BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      background: var(--bg); color: var(--fg);
      min-height: 100vh; font-size: 14px; line-height: 1.55;
      -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
    }

    /* ── Custom scrollbar ─────────────────────────────────────────── */
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--bd3); border-radius: 99px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--mt); }

    /* ── Layout — Sidebar + Main ─────────────────────────────────── */
    .app-layout { display: flex; min-height: 100vh; }

    /* ── Sidebar ──────────────────────────────────────────────────── */
    .sidebar {
      width: var(--sidebar-w); position: fixed; top: 0; left: 0; bottom: 0;
      background: var(--s1); border-right: 1px solid var(--bd);
      display: flex; flex-direction: column; z-index: 100;
      overflow-y: auto; overflow-x: hidden;
      transition: transform 0.25s cubic-bezier(.4,0,.2,1);
    }
    .sidebar-brand {
      padding: 20px 18px 8px; border-bottom: 1px solid var(--bd);
    }
    .sidebar-brand h1 {
      font-size: 1.1rem; font-weight: 800; letter-spacing: -0.03em;
      background: linear-gradient(130deg, #818cf8 0%, #a855f7 50%, #ec4899 100%);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
      line-height: 1.3;
    }
    .sidebar-brand .version { font-size: 0.68rem; color: var(--dim); margin-top: 2px; }
    .sidebar-nav { flex: 1; padding: 12px 8px; display: flex; flex-direction: column; gap: 2px; }
    .sidebar-section { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--dim); font-weight: 700; padding: 14px 10px 5px; }
    .nav-item {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 12px; border-radius: 8px; cursor: pointer;
      color: var(--mt); font-size: 0.82rem; font-weight: 500;
      transition: all 0.15s ease; user-select: none; text-decoration: none;
      border: 1px solid transparent;
    }
    .nav-item:hover { background: var(--s3); color: var(--fg); }
    .nav-item.active {
      background: var(--accent-soft); color: var(--accent-h);
      border-color: rgba(99,102,241,.15); font-weight: 600;
    }
    .nav-item .nav-icon { font-size: 1rem; width: 20px; text-align: center; flex-shrink: 0; }
    .nav-item .nav-badge {
      margin-left: auto; background: var(--accent); color: #fff;
      font-size: 0.62rem; font-weight: 700; padding: 1px 6px; border-radius: 99px; min-width: 18px; text-align: center;
    }
    .sidebar-footer {
      padding: 12px 14px; border-top: 1px solid var(--bd);
      display: flex; flex-direction: column; gap: 6px;
    }
    .sidebar-user {
      display: flex; align-items: center; gap: 8px;
      font-size: 0.78rem; color: var(--mt); overflow: hidden;
    }
    .sidebar-user .avatar {
      width: 28px; height: 28px; border-radius: 50%;
      background: linear-gradient(135deg, var(--accent), #a855f7);
      display: flex; align-items: center; justify-content: center;
      color: #fff; font-size: 0.7rem; font-weight: 700; flex-shrink: 0;
    }
    .sidebar-controls { display: flex; gap: 4px; }
    .sidebar-controls .btn { padding: 5px 10px; font-size: 0.78rem; }

    /* ── Main Content ─────────────────────────────────────────────── */
    .main-content { margin-left: var(--sidebar-w); flex: 1; min-height: 100vh; }
    .content-header {
      position: sticky; top: 0; z-index: 50;
      background: var(--glass-bg); backdrop-filter: blur(16px) saturate(1.6);
      -webkit-backdrop-filter: blur(16px) saturate(1.6);
      border-bottom: 1px solid var(--glass-border);
      padding: 14px 28px; display: flex; align-items: center; justify-content: space-between;
    }
    .content-header h2 {
      font-size: 1.15rem; font-weight: 700; letter-spacing: -0.02em;
    }
    .content-body { padding: 24px 28px 60px; max-width: 1200px; }

    /* ── Hero Section ─────────────────────────────────────────────── */
    .hero {
      background: linear-gradient(135deg, rgba(99,102,241,.08), rgba(168,85,247,.06), rgba(236,72,153,.04));
      border: 1px solid rgba(99,102,241,.12);
      border-radius: 16px; padding: 28px 32px; margin-bottom: 24px;
      position: relative; overflow: hidden;
    }
    .hero::before {
      content: ''; position: absolute; top: -50%; right: -20%; width: 300px; height: 300px;
      background: radial-gradient(circle, rgba(99,102,241,.12) 0%, transparent 70%);
      border-radius: 50%; pointer-events: none;
    }
    .hero-title {
      font-size: 1.5rem; font-weight: 800; letter-spacing: -0.03em;
      background: linear-gradient(130deg, #818cf8, #a855f7, #ec4899);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
      margin-bottom: 6px;
    }
    .hero-subtitle { color: var(--mt); font-size: 0.88rem; margin-bottom: 20px; }
    .hero-stats {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px; position: relative; z-index: 1;
    }
    .hero-stat {
      background: var(--glass-bg); backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--glass-border); border-radius: 12px;
      padding: 16px 18px;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .hero-stat:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,.2); }
    .hero-stat .stat-icon { font-size: 1.3rem; margin-bottom: 6px; }
    .hero-stat .stat-num { font-size: 1.4rem; font-weight: 800; letter-spacing: -0.03em; }
    .hero-stat .stat-label { font-size: 0.68rem; color: var(--mt); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; margin-top: 2px; }

    /* ── Status Grid ──────────────────────────────────────────────── */
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }

    /* ── Card (glass style) ───────────────────────────────────────── */
    .card {
      background: var(--s1); border: 1px solid var(--bd);
      border-radius: 14px; padding: 20px 22px;
      box-shadow: var(--card-shadow);
      transition: box-shadow 0.25s ease, border-color 0.25s ease, transform 0.25s ease;
    }
    .card:hover { border-color: var(--bd3); box-shadow: var(--card-hover-shadow); }
    .card h3 {
      font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.1em;
      color: var(--mt); margin-bottom: 12px; font-weight: 600;
      display: flex; align-items: center; justify-content: space-between;
    }

    /* ── Status Dot ───────────────────────────────────────────────── */
    .status { display: flex; align-items: center; gap: 10px; font-size: 0.95rem; font-weight: 600; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; position: relative; }
    .dot.ok { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-bg); animation: dot-pulse 2.5s ease-in-out infinite; }
    .dot.err { background: var(--err); box-shadow: 0 0 0 3px var(--err-bg); }
    @keyframes dot-pulse {
      0%,100% { box-shadow: 0 0 0 3px var(--ok-bg); }
      50% { box-shadow: 0 0 0 6px rgba(34,197,94,.12); }
    }

    /* ── Navigation Tabs (hidden, replaced by sidebar) ───────────── */
    .tabs { display: none; }
    .tab { display: none; }

    /* ── Panel ────────────────────────────────────────────────────── */
    .panel { display: none; }
    .panel.active { display: block; animation: panelIn 0.3s cubic-bezier(.4,0,.2,1); }
    @keyframes panelIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ── Tables ───────────────────────────────────────────────────── */
    table { width: 100%; border-collapse: collapse; }
    thead { border-bottom: 2px solid var(--bd2); }
    th {
      text-align: left; padding: 10px 14px;
      font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.09em;
      color: var(--mt); font-weight: 700; white-space: nowrap;
    }
    td { padding: 10px 14px; font-size: 0.84rem; border-bottom: 1px solid var(--bd); vertical-align: middle; }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr { transition: background 0.12s ease; }
    tbody tr:hover td { background: var(--accent-soft); }
    td a { color: #818cf8; text-decoration: none; transition: color 0.12s; }
    td a:hover { color: var(--accent-h); text-decoration: underline; }

    /* ── HTTP Method Badges ───────────────────────────────────────── */
    .badge { display: inline-block; padding: 2px 8px; border-radius: 5px; font-size: 0.7rem; font-weight: 700; font-family: ui-monospace, 'JetBrains Mono', monospace; letter-spacing: 0.02em; border: 1px solid transparent; }
    .badge-get { background: var(--ok-bg); color: var(--ok); border-color: var(--ok-bd); }
    .badge-post { background: var(--info-bg); color: var(--info); border-color: var(--info-bd); }
    .badge-delete { background: var(--err-bg); color: var(--err); border-color: var(--err-bd); }
    .badge-put { background: var(--warn-bg); color: var(--warn); border-color: var(--warn-bd); }
    .badge-patch { background: var(--warn-bg); color: var(--warn); border-color: var(--warn-bd); }

    /* ── Status Badges ────────────────────────────────────────────── */
    .st-badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 99px; font-size: 0.72rem; font-weight: 600; }
    .st-ok { background: var(--ok-bg); color: var(--ok); border: 1px solid var(--ok-bd); }
    .st-err { background: var(--err-bg); color: var(--err); border: 1px solid var(--err-bd); }
    .st-warn { background: var(--warn-bg); color: var(--warn); border: 1px solid var(--warn-bd); }
    .st-running { background: var(--info-bg); color: var(--info); border: 1px solid var(--info-bd); }
    .st-badge::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }

    /* ── Code & Pre ───────────────────────────────────────────────── */
    code {
      background: var(--s3); color: var(--code-fg);
      padding: 2px 7px; border-radius: 5px;
      font-size: 0.79rem; font-family: ui-monospace, 'JetBrains Mono', 'Fira Code', monospace;
      border: 1px solid var(--code-border);
    }
    pre {
      background: var(--pre-bg); border: 1px solid var(--bd);
      border-radius: 10px; padding: 16px 18px;
      overflow: auto; max-height: 420px;
      font-size: 0.79rem; line-height: 1.65; tab-size: 2;
      color: #c4b5fd; font-family: ui-monospace, 'JetBrains Mono', 'Fira Code', monospace;
    }
    :root[data-theme="light"] pre { color: #5b21b6; }

    /* ── Buttons ──────────────────────────────────────────────────── */
    .btn {
      display: inline-flex; align-items: center; gap: 5px;
      background: linear-gradient(135deg, #6366f1, #7c3aed);
      color: #fff; border: none; border-radius: 8px;
      padding: 8px 18px; cursor: pointer;
      font-size: 0.82rem; font-weight: 500; white-space: nowrap;
      transition: transform 0.15s, box-shadow 0.15s;
      box-shadow: 0 2px 8px var(--accent-glow);
    }
    .btn:hover { transform: translateY(-1px); box-shadow: 0 4px 16px var(--accent-glow); }
    .btn:active { transform: translateY(0); }
    .btn.secondary {
      background: var(--btn-sec-bg); color: var(--btn-sec-fg);
      border: 1px solid var(--btn-sec-border); box-shadow: none;
    }
    .btn.secondary:hover { background: var(--s3); transform: translateY(-1px); }

    /* ── Stats ────────────────────────────────────────────────────── */
    .stat-num { font-size: 1.7rem; font-weight: 800; letter-spacing: -0.04em; }
    .stat-label { font-size: 0.7rem; color: var(--mt); margin-top: 3px; text-transform: uppercase; letter-spacing: 0.07em; font-weight: 500; }

    /* ── Text helpers ─────────────────────────────────────────────── */
    .ok-text { color: var(--ok); } .err-text { color: var(--err); } .warn-text { color: var(--warn); }

    /* ── Skeleton Loader ─────────────────────────────────────────── */
    .skeleton {
      background: linear-gradient(90deg, var(--s2) 25%, var(--s3) 50%, var(--s2) 75%);
      background-size: 200% 100%; animation: skeleton-shine 1.5s ease-in-out infinite;
      border-radius: 6px; min-height: 16px;
    }
    .skeleton-row { height: 40px; margin-bottom: 8px; border-radius: 8px; }
    .skeleton-card { height: 80px; border-radius: 12px; }
    .skeleton-text { height: 14px; margin-bottom: 6px; width: 70%; }
    .skeleton-text.short { width: 40%; }
    @keyframes skeleton-shine {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    /* ── Refresh Indicator ────────────────────────────────────────── */
    .refresh-pulse {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.72rem; color: var(--mt);
    }
    .refresh-pulse .pulse-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: var(--accent); animation: refresh-blink 2s ease-in-out infinite;
    }
    @keyframes refresh-blink {
      0%,100% { opacity: .3; } 50% { opacity: 1; }
    }

    /* ── Workspace Cards ──────────────────────────────────────────── */
    .ws-card {
      background: var(--s2); border: 1px solid var(--bd);
      border-radius: 12px; padding: 16px 18px; margin-bottom: 10px;
      transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
    }
    .ws-card:hover { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-soft), 0 4px 14px rgba(0,0,0,.2); transform: translateY(-1px); }
    .ws-name { font-weight: 600; font-size: 0.95rem; }
    .ws-dir { font-size: 0.78rem; color: var(--mt); margin-top: 3px; font-family: ui-monospace, 'JetBrains Mono', monospace; }
    .ws-tag {
      display: inline-block; background: var(--accent-soft); color: #a78bfa;
      border: 1px solid rgba(167,139,250,.2); border-radius: 4px;
      padding: 1px 8px; font-size: 0.74rem; margin: 3px 3px 0 0;
    }
    .ws-active-badge {
      background: var(--ok-bg); color: var(--ok); border: 1px solid var(--ok-bd);
      border-radius: 4px; padding: 2px 8px;
      font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; margin-left: 8px;
    }
    .ws-meta { font-size: 0.75rem; color: var(--dim); margin-top: 5px; }

    /* ── Prompt preview block ─────────────────────────────────────── */
    .prompt-preview {
      font-size: 0.78rem; color: var(--fg); opacity: 0.85;
      padding: 8px 12px; background: var(--s3);
      border: 1px solid var(--bd2); border-left: 3px solid var(--accent);
      border-radius: 0 6px 6px 0; margin-bottom: 8px;
      font-style: italic; white-space: pre-wrap; word-break: break-word; line-height: 1.5;
    }
    .prompt-label { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--mt); font-style: normal; margin-bottom: 3px; font-weight: 600; }

    /* ── Misc ─────────────────────────────────────────────────────── */
    #output { margin-top: 12px; }
    .refresh-note { color: var(--dim); font-size: 0.75rem; margin-top: 8px; }

    /* ── Footer ───────────────────────────────────────────────────── */
    .footer {
      margin-top: 48px; color: var(--mt); font-size: 0.74rem;
      text-align: center; padding: 18px 0;
      border-top: 1px solid var(--bd);
      display: flex; align-items: center; justify-content: center; gap: 16px;
    }
    .footer::before { content: '◆'; color: var(--accent); opacity: 0.5; }

    /* ── Mobile sidebar ──────────────────────────────────────────── */
    .sidebar-toggle { display: none; position: fixed; top: 12px; left: 12px; z-index: 200; background: var(--s1); border: 1px solid var(--bd); border-radius: 8px; padding: 8px 10px; cursor: pointer; color: var(--fg); font-size: 1.1rem; }
    @media (max-width: 768px) {
      .sidebar { transform: translateX(-100%); }
      .sidebar.open { transform: translateX(0); }
      .sidebar-toggle { display: block; }
      .main-content { margin-left: 0; }
      .content-body { padding: 18px 16px 60px; }
      .content-header { padding: 14px 16px; padding-left: 52px; }
      .hero-stats { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  <button class="sidebar-toggle" id="sidebar-toggle" onclick="document.getElementById('sidebar').classList.toggle('open')">☰</button>

  <div class="app-layout">
    <!-- ── Sidebar Navigation ──────────────────────────────────────── -->
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-brand">
        <h1>Thirdwave</h1>
        <div class="version">AI Coding Platform v0.1.0</div>
      </div>

      <nav class="sidebar-nav">
        <div class="sidebar-section" data-i18n-section="overview">Overview</div>
        <div class="nav-item active" data-tab="dashboard" onclick="switchTab('dashboard')">
          <span class="nav-icon">📊</span> <span data-i18n-tab="dashboard">Dashboard</span>
        </div>

        <div class="sidebar-section" data-i18n-section="monitor">Monitoring</div>
        <div class="nav-item" data-tab="audit" onclick="switchTab('audit')">
          <span class="nav-icon">📋</span> <span data-i18n-tab="audit">Audit Logs</span>
        </div>
        <div class="nav-item" data-tab="queue" onclick="switchTab('queue')">
          <span class="nav-icon">⚡</span> <span data-i18n-tab="queue">Queue</span>
        </div>
        <div class="nav-item" data-tab="orchestrations" onclick="switchTab('orchestrations')">
          <span class="nav-icon">🔀</span> <span data-i18n-tab="orchestrations">Orchestrations</span>
        </div>
        <div class="nav-item" data-tab="parallel" onclick="switchTab('parallel')">
          <span class="nav-icon">⏩</span> <span data-i18n-tab="parallel">Parallel</span>
        </div>

        <div class="sidebar-section" data-i18n-section="workspace">Workspace</div>
        <div class="nav-item" data-tab="workspaces" onclick="switchTab('workspaces')">
          <span class="nav-icon">📁</span> <span data-i18n-tab="workspaces">Workspaces</span>
        </div>
        <div class="nav-item" data-tab="sessions" onclick="switchTab('sessions')">
          <span class="nav-icon">💬</span> <span data-i18n-tab="sessions">Sessions</span>
        </div>

        <div class="sidebar-section" data-i18n-section="system">System</div>
        <div class="nav-item" data-tab="models" onclick="switchTab('models')">
          <span class="nav-icon">🧠</span> <span data-i18n-tab="models">Models</span>
        </div>
        <div class="nav-item" data-tab="users" onclick="switchTab('users')">
          <span class="nav-icon">👥</span> <span data-i18n-tab="users">Users</span>
        </div>
        <div class="nav-item" data-tab="api" onclick="switchTab('api')">
          <span class="nav-icon">🔌</span> <span data-i18n-tab="api">API Reference</span>
        </div>
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-user" id="sidebarUser" style="display:none">
          <div class="avatar" id="sidebarAvatar">A</div>
          <span id="sidebarUserEmail" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
        </div>
        <div class="sidebar-controls">
          <button class="btn secondary" id="dashLoginAdminBtn" onclick="showDashLogin()" style="font-size:0.72rem;padding:5px 10px" data-i18n="loginBtn">🔑 Login</button>
          <button class="btn secondary" id="dashLogoutBtn" style="display:none;font-size:0.72rem;padding:5px 10px" onclick="dashLogout()" data-i18n="logoutBtn">Logout</button>
          <button class="btn secondary" id="theme-toggle" onclick="toggleTheme()" style="padding:5px 10px;font-size:0.85rem">☀️</button>
          <button class="btn secondary" id="lang-toggle" onclick="toggleLang()" style="padding:5px 10px;font-size:0.85rem">日本語</button>
        </div>
      </div>
    </aside>

    <!-- ── Main Content ────────────────────────────────────────────── -->
    <main class="main-content">
      <div class="content-header">
        <h2 id="content-title">Dashboard</h2>
        <div class="refresh-pulse" id="auto-refresh-indicator" style="display:none">
          <span class="pulse-dot"></span> <span data-i18n="autoRefreshing">Auto-refreshing</span>
        </div>
      </div>
      <div class="content-body">

        <!-- DASHBOARD / HERO PANEL -->
        <div class="panel active" id="panel-dashboard">
          <div class="hero">
            <div class="hero-title" data-i18n="title">Thirdwave AI Coding Platform</div>
            <div class="hero-subtitle" data-i18n="subtitle">Self-hosted AI coding engine powered by local vLLM &mdash; no cloud APIs</div>
            <div class="hero-stats">
              <div class="hero-stat">
                <div class="stat-icon">🟢</div>
                <div class="stat-num" style="color:var(--ok)">:${env.PORT}</div>
                <div class="stat-label" data-i18n="statPlatform">Platform</div>
              </div>
              <div class="hero-stat">
                <div class="stat-icon">${health.ok ? '🟢' : '�'}</div>
                <div class="stat-num" style="color:${health.ok ? 'var(--ok)' : 'var(--warn, #f0ad4e)'}">${health.ok ? 'Connected' : 'Standalone'}</div>
                <div class="stat-label" data-i18n="statOpenCode">OpenCode Engine</div>
              </div>
              <div class="hero-stat">
                <div class="stat-icon">🤖</div>
                <div class="stat-num">${registry.local.length}</div>
                <div class="stat-label" data-i18n="statLocalVllm">Local vLLM Endpoints</div>
              </div>
              <div class="hero-stat">
                <div class="stat-icon">☁️</div>
                <div class="stat-num">${registry.cloud.filter((p: any) => p.configured).length}</div>
                <div class="stat-label" data-i18n="statCloudProviders">Cloud Providers</div>
              </div>
            </div>
          </div>

          <div class="grid" style="grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))">
            <div class="card" style="cursor:pointer" onclick="switchTab('audit')">
              <h3 data-i18n="recentActivity">📋 Recent Activity</h3>
              <div id="dash-activity">
                <div class="skeleton skeleton-row"></div>
                <div class="skeleton skeleton-row"></div>
                <div class="skeleton skeleton-row"></div>
              </div>
            </div>
            <div class="card" style="cursor:pointer" onclick="switchTab('queue')">
              <h3 data-i18n="queueStatus">⚡ Queue Status</h3>
              <div id="dash-queue">
                <div class="skeleton skeleton-card"></div>
              </div>
            </div>
          </div>
        </div>

        <!-- AUDIT PANEL -->
        <div class="panel" id="panel-audit">
      <div class="card">
        <h3 data-i18n="auditStatistics">Audit Statistics</h3>
        <div class="grid" id="audit-stats" style="margin-bottom:0">
          <div class="skeleton skeleton-card"></div>
          <div class="skeleton skeleton-card"></div>
          <div class="skeleton skeleton-card"></div>
        </div>
      </div>
      <div class="card" style="margin-top:14px">
        <h3><span data-i18n="recentAuditEntries">Recent Audit Entries</span> <button class="btn secondary" style="float:right;padding:4px 12px;font-size:0.75rem" onclick="loadAudit()" data-i18n="refresh">Refresh</button></h3>
        <pre id="audit-entries" style="min-height:60px"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></pre>
      </div>
    </div>

    <!-- WORKSPACES PANEL -->
    <div class="panel" id="panel-workspaces">
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <h3 style="margin:0" data-i18n="workspacesTitle">Workspaces</h3>
          <button class="btn secondary" style="padding:4px 12px;font-size:0.75rem" onclick="loadWorkspaces()" data-i18n="refresh">Refresh</button>
        </div>
        <div id="workspaces-list"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div>
      </div>
    </div>

    <!-- QUEUE PANEL -->
    <div class="panel" id="panel-queue">
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <h3 style="margin:0" data-i18n="queueMetrics">Queue Metrics</h3>
          <div style="display:flex;align-items:center;gap:8px">
            <label style="font-size:0.75rem;color:var(--muted);display:flex;align-items:center;gap:4px"><input type="checkbox" id="queue-auto-refresh" checked> <span data-i18n="autoRefresh">Auto-refresh</span></label>
            <button class="btn secondary" style="padding:4px 12px;font-size:0.75rem" onclick="loadQueue()" data-i18n="refresh">Refresh</button>
          </div>
        </div>
        <div id="queue-stats" class="grid" style="margin-bottom:14px"></div>
        <div id="queue-workers"></div>
        <div id="queue-tasks" style="margin-top:14px"></div>
      </div>
    </div>

    <!-- ORCHESTRATIONS PANEL -->
    <div class="panel" id="panel-orchestrations">
      <div class="card">
        <h3 data-i18n="orchestrationsTitle">Orchestrations <button class="btn secondary" style="float:right;padding:4px 12px;font-size:0.75rem" onclick="loadOrchestrations()" data-i18n="refresh">Refresh</button></h3>
        <div id="orchestrations-list"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div>
      </div>
    </div>

    <!-- PARALLEL PANEL -->
    <div class="panel" id="panel-parallel">
      <div class="card">
        <h3 data-i18n="parallelExecutions">Parallel Executions <button class="btn secondary" style="float:right;padding:4px 12px;font-size:0.75rem" onclick="loadParallel()" data-i18n="refresh">Refresh</button></h3>
        <div id="parallel-list"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div>
      </div>
    </div>

    <!-- SESSIONS PANEL -->
    <div class="panel" id="panel-sessions">
      <div class="card">
        <h3 data-i18n="sessionsTitle">Sessions <button class="btn secondary" style="float:right;padding:4px 12px;font-size:0.75rem" onclick="loadSessions()" data-i18n="refresh">Refresh</button></h3>
        <div id="sessions-list"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div>
      </div>
    </div>

    <!-- MODELS PANEL -->
    <div class="panel" id="panel-models">
      <div class="card">
        <h3 data-i18n="localModels">Local vLLM Models <button class="btn secondary" style="float:right;padding:4px 12px;font-size:0.75rem" onclick="loadModels()" data-i18n="refresh">Refresh</button></h3>
        <div id="local-models">
          ${registry.local.map((p: any) => {
            const isOnline = p.status === 'online'
            const statusColor = isOnline ? 'var(--ok)' : 'var(--err)'
            return `
            <div style="margin-bottom:16px;padding:14px 16px;background:var(--s1);border:1px solid var(--bd);border-radius:10px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <div style="display:flex;align-items:center;gap:10px">
                  <span style="width:8px;height:8px;border-radius:50%;background:${statusColor};display:inline-block;box-shadow:0 0 6px ${statusColor}"></span>
                  <strong style="color:var(--fg)">${esc(p.name)}</strong>
                </div>
                <span style="padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:700;letter-spacing:0.06em;background:${statusColor}22;border:1px solid ${statusColor}55;color:${statusColor}">${isOnline ? 'ONLINE' : 'OFFLINE'}</span>
              </div>
              <div style="color:var(--mt);font-size:0.75rem;margin-bottom:10px;font-family:'JetBrains Mono','Fira Code',monospace">${esc(p.endpoint)}${p.latencyMs ? ` <span style="color:var(--ok)">${p.latencyMs}ms</span>` : ''}</div>
              <div style="display:flex;flex-direction:column;gap:6px">
                ${p.models.map((m: any) => `
                <div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--s2);border:1px solid var(--bd);border-radius:8px">
                  <span style="font-size:1.2rem;flex-shrink:0">${modelIcon(m.name || m.id)}</span>
                  <div style="flex:1;min-width:0">
                    <div style="color:#a78bfa;font-family:'JetBrains Mono','Fira Code',monospace;font-size:0.83rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.name || m.id)}</div>
                    <div style="display:flex;gap:10px;margin-top:3px">
                      ${m.contextLimit ? `<span style="font-size:0.7rem;color:var(--mt)">ctx <strong style="color:var(--fg)">${Math.floor(m.contextLimit/1000)}k</strong></span>` : ''}
                      ${m.outputLimit ? `<span style="font-size:0.7rem;color:var(--mt)">out <strong style="color:var(--fg)">${m.outputLimit}</strong></span>` : ''}
                    </div>
                  </div>
                </div>
                `).join('')}
              </div>
            </div>
            `
          }).join('')}
          ${registry.local.length === 0 ? '<div style="color:var(--mt);padding:16px;text-align:center">No vLLM endpoints configured</div>' : ''}
        </div>
      </div>
      <div class="card" style="margin-top:14px">
        <h3 data-i18n="cloudProviders">Cloud Providers</h3>
        <div id="cloud-providers">
          <div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div>
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
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/health">/health</a></td><td>Health status</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/providers">/api/providers</a></td><td>List providers &amp; models</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/sessions">/api/sessions</a></td><td>List chat sessions</td></tr>
            <tr><td><span class="badge badge-post">POST</span></td><td>/api/sessions</td><td>Create new session</td></tr>
            <tr><td><span class="badge badge-post">POST</span></td><td>/api/sessions/:id/prompt</td><td>Send prompt to LLM</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/audit">/api/audit</a></td><td>Audit logs</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/audit/stats">/api/audit/stats</a></td><td>Audit statistics</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/workspaces">/api/workspaces</a></td><td>List workspaces</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/queue/metrics">/api/queue/metrics</a></td><td>Queue metrics</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/orchestrations">/api/orchestrations</a></td><td>Orchestrations</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/parallel">/api/parallel</a></td><td>Parallel executions</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/config">/api/config</a></td><td>Configuration</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/project">/api/project</a></td><td>Project info</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/files">/api/files</a></td><td>Project files</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/vcs">/api/vcs</a></td><td>VCS status</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/registry">/api/registry</a></td><td>Provider registry (vLLM + cloud)</td></tr>
            <tr><td><span class="badge badge-post">POST</span></td><td>/api/chat</td><td>Direct LLM chat (agentic loop)</td></tr>
            <tr><td><span class="badge badge-post">POST</span></td><td>/api/chat/stream</td><td>Streaming LLM chat (SSE)</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/skills">/api/skills</a></td><td>List all skills</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td>/api/skills/search?q=</td><td>Search skills by keyword</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/skills/categories">/api/skills/categories</a></td><td>Skills grouped by category</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/hitl">/api/hitl</a></td><td>HITL pending approvals</td></tr>
            <tr><td><span class="badge badge-post">POST</span></td><td>/api/hitl/:id/approve</td><td>Approve a HITL request</td></tr>
            <tr><td><span class="badge badge-post">POST</span></td><td>/api/hitl/:id/deny</td><td>Deny a HITL request</td></tr>
            <tr><td colspan="3" style="padding:8px 14px;font-weight:700;color:var(--accent);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;border-bottom:2px solid var(--bd2)">Authentication &amp; Users</td></tr>
            <tr><td><span class="badge badge-post">POST</span></td><td>/api/auth/login</td><td>Login (returns JWT)</td></tr>
            <tr><td><span class="badge badge-post">POST</span></td><td>/api/auth/register</td><td>Register (pending approval)</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td>/api/auth/me</td><td>Current user from JWT</td></tr>
            <tr><td><span class="badge badge-patch">PATCH</span></td><td>/api/auth/profile</td><td>Update current user profile</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/admin/users">/api/admin/users</a></td><td>List all users (admin)</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/admin/registrations">/api/admin/registrations</a></td><td>Pending registrations (admin)</td></tr>
            <tr><td><span class="badge badge-post">POST</span></td><td>/api/admin/registrations/:id/approve</td><td>Approve registration (admin)</td></tr>
            <tr><td><span class="badge badge-get">GET</span></td><td><a href="/api/admin/stats">/api/admin/stats</a></td><td>Admin dashboard stats</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- USERS PANEL -->
    <div class="panel" id="panel-users">
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <h3 style="margin:0" data-i18n="userManagement">User Management</h3>
          <button class="btn secondary" style="padding:4px 12px;font-size:0.75rem" onclick="loadUsers()" data-i18n="refresh">Refresh</button>
        </div>
        <div id="user-stats" class="grid" style="margin-bottom:14px">
          <div class="skeleton skeleton-card"></div>
          <div class="skeleton skeleton-card"></div>
          <div class="skeleton skeleton-card"></div>
          <div class="skeleton skeleton-card"></div>
          <div class="skeleton skeleton-card"></div>
        </div>
        <h3 style="margin:12px 0 8px" data-i18n="pendingRegistrations">Pending Registrations</h3>
        <div id="pending-registrations"><div class="skeleton skeleton-row"></div></div>
        <h3 style="margin:18px 0 8px" data-i18n="pendingApiKeys">Pending API Key Approvals</h3>
        <div id="pending-api-keys"><div class="skeleton skeleton-row"></div></div>
        <h3 style="margin:18px 0 8px" data-i18n="allUsers">All Users</h3>
        <div id="users-list"><div class="skeleton skeleton-row"></div><div class="skeleton skeleton-row"></div></div>
      </div>
    </div>

    <div class="footer" data-i18n="footer">Thirdwave v0.1.0 &mdash; OpenCode Engine &mdash; vLLM Local Inference</div>
      </div><!-- /content-body -->
    </main>
  </div><!-- /app-layout -->

  <!-- Dashboard Login Modal -->
  <div id="dashLogin" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.65);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);align-items:center;justify-content:center">
    <div style="background:var(--s1);border:1px solid var(--bd2);border-radius:16px;padding:32px 28px;width:360px;max-width:90%;box-shadow:0 20px 60px rgba(0,0,0,.4)">
      <div style="font-size:1.5rem;margin-bottom:4px">🔐</div>
      <h3 style="margin:0 0 4px;color:var(--fg);font-size:1.1rem" data-i18n="adminLogin">Admin Login</h3>
      <p style="font-size:0.78rem;color:var(--mt);margin:0 0 18px" data-i18n="loginDesc">Sign in to manage users, registrations, and policies.</p>
      <div id="dashLoginError" style="display:none;padding:8px 12px;margin-bottom:12px;font-size:0.78rem;color:#ef4444;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.18);border-radius:8px"></div>
      <input id="dashEmail" type="email" placeholder="Email" style="width:100%;padding:10px 12px;margin-bottom:10px;font-size:0.85rem;background:var(--s2);border:1px solid var(--bd);border-radius:8px;color:var(--fg);outline:none;box-sizing:border-box;transition:border-color .15s" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--bd)'" />
      <input id="dashPass" type="password" placeholder="Password" style="width:100%;padding:10px 12px;margin-bottom:14px;font-size:0.85rem;background:var(--s2);border:1px solid var(--bd);border-radius:8px;color:var(--fg);outline:none;box-sizing:border-box;transition:border-color .15s" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--bd)'" />
      <button class="btn" id="dashLoginBtn" onclick="dashDoLogin()" style="width:100%;padding:10px;font-size:0.88rem;border-radius:8px" data-i18n="signIn">Sign In</button>
      <div style="text-align:center;margin-top:12px"><a href="javascript:hideDashLogin()" style="font-size:0.78rem;color:var(--mt);text-decoration:none" data-i18n="cancel">Cancel</a></div>
    </div>
  </div>

  <script>
    const API = '';
    // Dashboard auth — JWT stored in localStorage for admin API calls
    let dashToken = localStorage.getItem('dashToken') || '';
    function authHeaders() {
      const h = {};
      if (dashToken) h['Authorization'] = 'Bearer ' + dashToken;
      return h;
    }
    async function fetchJSON(path) {
      const res = await fetch(API + path, { headers: authHeaders() });
      if (res.status === 401 && path.startsWith('/api/admin')) {
        // Need login for admin endpoints
        showDashLogin();
        throw new Error('Authentication required — please log in');
      }
      return res.json();
    }
    function showDashLogin() {
      document.getElementById('dashLogin').style.display = 'flex';
      document.getElementById('dashEmail').focus();
    }
    function hideDashLogin() {
      document.getElementById('dashLogin').style.display = 'none';
      document.getElementById('dashLoginError').style.display = 'none';
    }
    async function dashDoLogin() {
      const email = document.getElementById('dashEmail').value.trim();
      const pass = document.getElementById('dashPass').value;
      if (!email || !pass) { document.getElementById('dashLoginError').textContent = 'Email and password required'; document.getElementById('dashLoginError').style.display = 'block'; return; }
      try {
        const res = await fetch('/api/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({email, password: pass}) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');
        dashToken = data.token;
        localStorage.setItem('dashToken', dashToken);
        hideDashLogin();
        // Show logout button and user info
        document.getElementById('dashLogoutBtn').style.display = '';
        document.getElementById('dashLoginAdminBtn').style.display = 'none';
        document.getElementById('sidebarUser').style.display = 'flex';
        document.getElementById('sidebarUserEmail').textContent = data.user.email;
        document.getElementById('sidebarAvatar').textContent = (data.user.email||'A')[0].toUpperCase();
        // Reload active panel
        const activeNav = document.querySelector('.nav-item.active');
        if (activeNav) { const tab = activeNav.dataset.tab; const loaders = { dashboard: loadDashboard, audit: loadAudit, workspaces: loadWorkspaces, queue: loadQueue, orchestrations: loadOrchestrations, parallel: loadParallel, sessions: loadSessions, models: loadModels, users: loadUsers }; const fn = loaders[tab]; if (fn) fn(); }
      } catch(e) { document.getElementById('dashLoginError').textContent = e.message; document.getElementById('dashLoginError').style.display = 'block'; }
    }
    function dashLogout() {
      dashToken = '';
      localStorage.removeItem('dashToken');
      document.getElementById('dashLogoutBtn').style.display = 'none';
      document.getElementById('dashLoginAdminBtn').style.display = '';
      document.getElementById('sidebarUser').style.display = 'none';
    }
    // Enter key on password field → login
    document.addEventListener('DOMContentLoaded', function() {
      var dp = document.getElementById('dashPass');
      if (dp) dp.addEventListener('keydown', function(e) { if (e.key === 'Enter') dashDoLogin(); });
    });
    function pretty(obj) { return JSON.stringify(obj, null, 2); }
    function esc(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

    // ── i18n ──────────────────────────────────────────────────────────
    const TRANSLATIONS = {
      en: {
        title: 'Thirdwave AI Coding Platform',
        subtitle: 'Self-hosted AI coding engine powered by local vLLM \u2014 no cloud APIs',
        refresh: 'Refresh',
        workspacesTitle: 'Workspaces',
        tabs: { audit: 'Audit Logs', workspaces: 'Workspaces', queue: 'Queue',
                orchestrations: 'Orchestrations', parallel: 'Parallel',
                sessions: 'Sessions', models: 'Models', users: 'Users', api: 'API Reference', dashboard: 'Dashboard' },
        sections: { overview: 'Overview', monitor: 'Monitoring', workspace: 'Workspace', system: 'System' },
        noWorkspaces: 'No workspaces yet. Open a project in VS Code and send a message to auto-register.',
        loading: 'Loading...',
        active: 'ACTIVE',
        totalRequests: 'Total Requests',
        errors: 'Errors',
        avgDuration: 'Avg Duration (ms)',
        noAudit: 'No audit entries yet.',
        auditStatistics: 'Audit Statistics',
        recentAuditEntries: 'Recent Audit Entries',
        queueMetrics: 'Queue Metrics',
        orchestrationsTitle: 'Orchestrations',
        parallelExecutions: 'Parallel Executions',
        sessionsTitle: 'Sessions',
        localModels: 'Local vLLM Models',
        parallelToolCalls: 'Agent Tool Calls (Parallel)',
        parallelPlans: 'Orchestrated Plans',
        noParallel: 'No parallel executions yet.',
        round: 'Round',
        tools: 'tools',
        session: 'Session',
        noSessions: 'No chat sessions yet. Sessions are recorded when you use the VS Code extension.',
        noOrchestrations: 'No orchestrations yet.',
        queueRunning: 'Running',
        queueQueued: 'Queued',
        queueCompleted: 'Completed',
        queueFailed: 'Failed',
        queueAborted: 'Aborted',
        queueTotal: 'Total',
        messages: 'messages',
        cloudProviders: 'Cloud Providers',
        configured: 'Configured',
        noApiKey: 'No API key',
        statPlatform: 'Platform',
        statOpenCode: 'OpenCode Engine',
        statLocalVllm: 'Local vLLM Endpoints',
        statCloudProviders: 'Cloud Providers',
        recentActivity: '\ud83d\udccb Recent Activity',
        queueStatus: '\u26a1 Queue Status',
        userManagement: 'User Management',
        pendingRegistrations: 'Pending Registrations',
        pendingApiKeys: 'Pending API Key Approvals',
        allUsers: 'All Users',
        loginBtn: '\ud83d\udd11 Login',
        logoutBtn: 'Logout',
        autoRefreshing: 'Auto-refreshing',
        autoRefresh: 'Auto-refresh',
        adminLogin: 'Admin Login',
        loginDesc: 'Sign in to manage users, registrations, and policies.',
        signIn: 'Sign In',
        cancel: 'Cancel',
        footer: 'Thirdwave v0.1.0 \u2014 OpenCode Engine \u2014 vLLM Local Inference',
      },
      ja: {
        title: 'Thirdwave AI \u30b3\u30fc\u30c7\u30a3\u30f3\u30b0\u30d7\u30e9\u30c3\u30c8\u30d5\u30a9\u30fc\u30e0',
        subtitle: '\u30ed\u30fc\u30ab\u30eb vLLM \u3067\u52d5\u4f5c\u3059\u308b\u30bb\u30eb\u30d5\u30db\u30b9\u30c8\u578b AI \u30b3\u30fc\u30c7\u30a3\u30f3\u30b0\u30a8\u30f3\u30b8\u30f3',
        refresh: '\u66f4\u65b0',
        workspacesTitle: '\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9',
        tabs: { audit: '\u76e3\u67fb\u30ed\u30b0', workspaces: '\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9', queue: '\u30ad\u30e5\u30fc',
                orchestrations: '\u30aa\u30fc\u30b1\u30b9\u30c8\u30ec\u30fc\u30b7\u30e7\u30f3', parallel: '\u4e26\u5217\u5b9f\u884c',
                sessions: '\u30bb\u30c3\u30b7\u30e7\u30f3', models: '\u30e2\u30c7\u30eb', users: '\u30e6\u30fc\u30b6\u30fc', api: 'API \u30ea\u30d5\u30a1\u30ec\u30f3\u30b9', dashboard: '\u30c0\u30c3\u30b7\u30e5\u30dc\u30fc\u30c9' },
        sections: { overview: '\u6982\u8981', monitor: '\u30e2\u30cb\u30bf\u30ea\u30f3\u30b0', workspace: '\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9', system: '\u30b7\u30b9\u30c6\u30e0' },
        noWorkspaces: 'VS Code \u3067\u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u3092\u958b\u304d\u3001\u30e1\u30c3\u30bb\u30fc\u30b8\u3092\u9001\u4fe1\u3059\u308b\u3068\u81ea\u52d5\u767b\u9332\u3055\u308c\u307e\u3059\u3002',
        loading: '\u8aad\u307f\u8fbc\u307f\u4e2d...',
        active: '\u30a2\u30af\u30c6\u30a3\u30d6',
        totalRequests: '\u30ea\u30af\u30a8\u30b9\u30c8\u6570',
        errors: '\u30a8\u30e9\u30fc\u6570',
        avgDuration: '\u5e73\u5747\u51e6\u7406\u6642\u9593 (ms)',
        noAudit: '\u307e\u3060\u30a8\u30f3\u30c8\u30ea\u304c\u3042\u308a\u307e\u305b\u3093\u3002',
        auditStatistics: '\u76e3\u67fb\u7d71\u8a08',
        recentAuditEntries: '\u6700\u8fd1\u306e\u76e3\u67fb\u30a8\u30f3\u30c8\u30ea',
        queueMetrics: '\u30ad\u30e5\u30fc\u30e1\u30c8\u30ea\u30af\u30b9',
        orchestrationsTitle: '\u30aa\u30fc\u30b1\u30b9\u30c8\u30ec\u30fc\u30b7\u30e7\u30f3',
        parallelExecutions: '\u4e26\u5217\u5b9f\u884c',
        sessionsTitle: '\u30bb\u30c3\u30b7\u30e7\u30f3',
        localModels: '\u30ed\u30fc\u30ab\u30eb vLLM \u30e2\u30c7\u30eb',
        parallelToolCalls: '\u30a8\u30fc\u30b8\u30a7\u30f3\u30c8\u30c4\u30fc\u30eb\u30b3\u30fc\u30eb (\u4e26\u5217)',
        parallelPlans: '\u30aa\u30fc\u30b1\u30b9\u30c8\u30ec\u30fc\u30b7\u30e7\u30f3\u30d7\u30e9\u30f3',
        noParallel: '\u307e\u3060\u4e26\u5217\u5b9f\u884c\u304c\u3042\u308a\u307e\u305b\u3093\u3002',
        round: '\u30e9\u30a6\u30f3\u30c9',
        tools: '\u30c4\u30fc\u30eb',
        session: '\u30bb\u30c3\u30b7\u30e7\u30f3',
        noSessions: 'VS Code \u62e1\u5f35\u6a5f\u80fd\u3067\u30c1\u30e3\u30c3\u30c8\u3059\u308b\u3068\u30bb\u30c3\u30b7\u30e7\u30f3\u304c\u8a18\u9332\u3055\u308c\u307e\u3059\u3002',
        noOrchestrations: '\u307e\u3060\u30aa\u30fc\u30b1\u30b9\u30c8\u30ec\u30fc\u30b7\u30e7\u30f3\u304c\u3042\u308a\u307e\u305b\u3093\u3002',
        queueRunning: '\u5b9f\u884c\u4e2d',
        queueQueued: '\u5f85\u6a5f\u4e2d',
        queueCompleted: '\u5b8c\u4e86',
        queueFailed: '\u5931\u6557',
        queueAborted: '\u4e2d\u65ad',
        queueTotal: '\u5408\u8a08',
        messages: '\u30e1\u30c3\u30bb\u30fc\u30b8',
        cloudProviders: '\u30af\u30e9\u30a6\u30c9\u30d7\u30ed\u30d0\u30a4\u30c0\u30fc',
        configured: '\u8a2d\u5b9a\u6e08\u307f',
        noApiKey: 'API\u30ad\u30fc\u306a\u3057',
        statPlatform: '\u30d7\u30e9\u30c3\u30c8\u30d5\u30a9\u30fc\u30e0',
        statOpenCode: 'OpenCode \u30a8\u30f3\u30b8\u30f3',
        statLocalVllm: '\u30ed\u30fc\u30ab\u30eb vLLM \u30a8\u30f3\u30c9\u30dd\u30a4\u30f3\u30c8',
        statCloudProviders: '\u30af\u30e9\u30a6\u30c9\u30d7\u30ed\u30d0\u30a4\u30c0\u30fc',
        recentActivity: '\ud83d\udccb \u6700\u8fd1\u306e\u30a2\u30af\u30c6\u30a3\u30d3\u30c6\u30a3',
        queueStatus: '\u26a1 \u30ad\u30e5\u30fc\u30b9\u30c6\u30fc\u30bf\u30b9',
        userManagement: '\u30e6\u30fc\u30b6\u30fc\u7ba1\u7406',
        pendingRegistrations: '\u627f\u8a8d\u5f85\u3061\u767b\u9332',
        pendingApiKeys: '\u627f\u8a8d\u5f85\u3061 API \u30ad\u30fc',
        allUsers: '\u5168\u30e6\u30fc\u30b6\u30fc',
        loginBtn: '\ud83d\udd11 \u30ed\u30b0\u30a4\u30f3',
        logoutBtn: '\u30ed\u30b0\u30a2\u30a6\u30c8',
        autoRefreshing: '\u81ea\u52d5\u66f4\u65b0\u4e2d',
        autoRefresh: '\u81ea\u52d5\u66f4\u65b0',
        adminLogin: '\u7ba1\u7406\u8005\u30ed\u30b0\u30a4\u30f3',
        loginDesc: '\u30e6\u30fc\u30b6\u30fc\u3001\u767b\u9332\u3001\u30dd\u30ea\u30b7\u30fc\u3092\u7ba1\u7406\u3059\u308b\u306b\u306f\u30b5\u30a4\u30f3\u30a4\u30f3\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
        signIn: '\u30b5\u30a4\u30f3\u30a4\u30f3',
        cancel: '\u30ad\u30e3\u30f3\u30bb\u30eb',
        footer: 'Thirdwave v0.1.0 \u2014 OpenCode \u30a8\u30f3\u30b8\u30f3 \u2014 vLLM \u30ed\u30fc\u30ab\u30eb\u63a8\u8ad6',
      }
    };
    let currentLang = localStorage.getItem('lang') || 'en';
    function applyLang(lang) {
      const t = TRANSLATIONS[lang];
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (t[key] !== undefined) {
          if (el.children.length > 0) {
            const textNode = Array.from(el.childNodes).find(n => n.nodeType === 3);
            if (textNode) textNode.textContent = t[key] + ' ';
          } else {
            el.textContent = t[key];
          }
        }
      });
      document.querySelectorAll('[data-i18n-tab]').forEach(el => {
        const key = el.dataset.i18nTab;
        if (t.tabs && t.tabs[key]) el.textContent = t.tabs[key];
      });
      document.querySelectorAll('[data-i18n-section]').forEach(el => {
        const key = el.dataset.i18nSection;
        if (t.sections && t.sections[key]) el.textContent = t.sections[key];
      });
      // Translate content header title
      const activeNav = document.querySelector('.nav-item.active');
      if (activeNav && t.tabs) {
        const tab = activeNav.dataset.tab;
        const titleEl = document.getElementById('content-title');
        if (titleEl && t.tabs[tab]) titleEl.textContent = t.tabs[tab];
      }
      document.getElementById('lang-toggle').textContent = lang === 'en' ? '\u65e5\u672c\u8a9e' : 'EN';
      // Re-load the active panel
      if (activeNav) {
        const loaders = { dashboard: loadDashboard, audit: loadAudit, workspaces: loadWorkspaces, queue: loadQueue, orchestrations: loadOrchestrations, parallel: loadParallel, sessions: loadSessions, models: loadModels, users: loadUsers };
        const loader = loaders[activeNav.dataset.tab];
        if (loader) loader();
      }
    }
    function toggleLang() {
      currentLang = currentLang === 'en' ? 'ja' : 'en';
      localStorage.setItem('lang', currentLang);
      applyLang(currentLang);
    }

    // ── Theme ─────────────────────────────────────────────────────────
    function applyTheme(theme) {
      document.documentElement.dataset.theme = theme;
      document.getElementById('theme-toggle').textContent = theme === 'dark' ? '\u2600\ufe0f' : '\ud83c\udf19';
    }
    function toggleTheme() {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      localStorage.setItem('theme', next);
      applyTheme(next);
    }

    // ── Init ──────────────────────────────────────────────────────────
    applyTheme(localStorage.getItem('theme') || 'dark');
    applyLang(currentLang);

    // ── Tab / Sidebar Navigation ─────────────────────────────────────
    const TAB_TITLES = { dashboard: 'Dashboard', audit: 'Audit Logs', workspaces: 'Workspaces', queue: 'Queue', orchestrations: 'Orchestrations', parallel: 'Parallel', sessions: 'Sessions', models: 'Models', users: 'Users', api: 'API Reference' };
    const TAB_LOADERS = { dashboard: loadDashboard, audit: loadAudit, workspaces: loadWorkspaces, queue: loadQueue, orchestrations: loadOrchestrations, parallel: loadParallel, sessions: loadSessions, models: loadModels, users: loadUsers };

    function switchTab(tab) {
      // Update sidebar active state
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      const navItem = document.querySelector('.nav-item[data-tab="' + tab + '"]');
      if (navItem) navItem.classList.add('active');
      // Update panels
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      const panel = document.getElementById('panel-' + tab);
      if (panel) panel.classList.add('active');
      // Update header title (use translated tab name)
      const t = TRANSLATIONS[currentLang];
      document.getElementById('content-title').textContent = (t.tabs && t.tabs[tab]) || TAB_TITLES[tab] || tab;
      // Show auto-refresh indicator for queue
      document.getElementById('auto-refresh-indicator').style.display = tab === 'queue' ? 'flex' : 'none';
      // Load data
      if (TAB_LOADERS[tab]) TAB_LOADERS[tab]();
      // Close mobile sidebar
      document.getElementById('sidebar').classList.remove('open');
    }

    // ── Dashboard loader ──────────────────────────────────────────────
    async function loadDashboard() {
      try {
        const [stats, tasks] = await Promise.all([
          fetchJSON('/api/audit/stats').catch(() => ({})),
          fetchJSON('/api/queue?limit=5').catch(() => []),
        ]);
        // Recent activity mini-card
        const actEl = document.getElementById('dash-activity');
        actEl.innerHTML = '<div style="display:flex;flex-direction:column;gap:4px">' +
          '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--bd)"><span style="font-size:0.82rem">Total Requests</span><strong>' + (stats.total||0) + '</strong></div>' +
          '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--bd)"><span style="font-size:0.82rem">Errors</span><strong class="' + ((stats.errors||0) > 0 ? 'err-text' : 'ok-text') + '">' + (stats.errors||0) + '</strong></div>' +
          '<div style="display:flex;justify-content:space-between;padding:6px 0"><span style="font-size:0.82rem">Avg Duration</span><strong>' + (stats.avgDuration||0) + 'ms</strong></div>' +
          '</div>';
        // Queue mini-card
        const qEl = document.getElementById('dash-queue');
        const taskArr = Array.isArray(tasks) ? tasks : (tasks.tasks || []);
        if (taskArr.length > 0) {
          qEl.innerHTML = taskArr.slice(0,4).map(function(tk) {
            const stCls = tk.state === 'completed' ? 'st-ok' : tk.state === 'running' ? 'st-running' : tk.state === 'failed' ? 'st-err' : 'st-warn';
            return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--bd);font-size:0.82rem">' +
              '<span class="st-badge ' + stCls + '" style="font-size:0.65rem">' + esc(tk.state||'?') + '</span>' +
              '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(tk.title || tk.id || '?') + '</span></div>';
          }).join('');
        } else {
          qEl.innerHTML = '<div style="color:var(--mt);text-align:center;padding:16px">No tasks in queue</div>';
        }
      } catch(e) { console.warn('Dashboard load error:', e); }
    }

    async function loadAudit() {
      try {
        const stats = await fetchJSON('/api/audit/stats');
        const t = TRANSLATIONS[currentLang];
        document.getElementById('audit-stats').innerHTML =
          '<div class="card" style="padding:12px;text-align:center"><div class="stat-num">' + (stats.total||0) + '</div><div class="stat-label">' + t.totalRequests + '</div></div>' +
          '<div class="card" style="padding:12px;text-align:center"><div class="stat-num ' + (stats.errors > 0 ? 'err-text' : 'ok-text') + '">' + (stats.errors||0) + '</div><div class="stat-label">' + t.errors + '</div></div>' +
          '<div class="card" style="padding:12px;text-align:center"><div class="stat-num">' + (stats.avgDuration||0) + '</div><div class="stat-label">' + t.avgDuration + '</div></div>';

        const entries = await fetchJSON('/api/audit?limit=20');
        if (entries.length === 0) {
          document.getElementById('audit-entries').textContent = t.noAudit;
        } else {
          document.getElementById('audit-entries').textContent = entries.map(e => {
            const tm = new Date(e.timestamp).toLocaleTimeString();
            const meta = typeof e.metadata === 'object' ? (e.metadata || {}) : (e.metadata ? JSON.parse(e.metadata) : {});
            return (e.success ? 'OK' : 'ERR') + '  ' + tm + '  ' + e.action + '  ' + (meta.method||'') + ' ' + (meta.path||'');
          }).join('\\n');
        }
      } catch(e) { document.getElementById('audit-entries').textContent = 'Error: ' + e; }
    }

    async function loadWorkspaces() {
      const container = document.getElementById('workspaces-list');
      try {
        const list = await fetchJSON('/api/workspaces');
        const t = TRANSLATIONS[currentLang];
        if (list.length === 0) {
          container.innerHTML = '<div style="color:var(--muted);padding:12px">' + esc(t.noWorkspaces) + '</div>';
        } else {
          container.innerHTML = list.map(ws => {
            const lastSeen = new Date(ws.lastAccessedAt).toLocaleString();
            const tags = (ws.tags||[]).map(tag => '<span class="ws-tag">' + esc(tag) + '</span>').join('');
            const activeBadge = ws.active ? '<span class="ws-active-badge">' + t.active + '</span>' : '';
            const owner = ws.ownerEmail ? ' &nbsp;&bull;&nbsp; user: ' + esc(ws.ownerEmail) : '';
            return '<div class="ws-card">' +
              '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px">' +
              '<span class="ws-name">' + esc(ws.name) + '</span>' + activeBadge + tags +
              '</div>' +
              '<div class="ws-dir">' + esc(ws.directory) + '</div>' +
              '<div class="ws-meta">' + lastSeen + ' &nbsp;&bull;&nbsp; ref: ' + ws.id.slice(0,8) + owner + '</div>' +
              '</div>';
          }).join('');
        }
      } catch(e) { container.innerHTML = '<div style="color:var(--muted)">Error: ' + esc(String(e)) + '</div>'; }
    }

    async function loadQueue() {
      try {
        const [m, tasks] = await Promise.all([
          fetchJSON('/api/queue/metrics'),
          fetchJSON('/api/queue?limit=20').catch(() => []),
        ]);
        const t = TRANSLATIONS[currentLang];
        const s = m.stats || {};
        // Stats grid
        const statCards = [
          { label: t.queueRunning, val: s.running || 0, color: '#22c55e' },
          { label: t.queueQueued, val: s.queued || 0, color: '#3b82f6' },
          { label: t.queueCompleted, val: s.completed || 0, color: 'var(--fg)' },
          { label: t.queueFailed, val: s.failed || 0, color: s.failed > 0 ? '#ef4444' : 'var(--fg)' },
          { label: t.queueAborted, val: s.aborted || 0, color: s.aborted > 0 ? '#f59e0b' : 'var(--fg)' },
          { label: t.queueTotal, val: s.total || 0, color: 'var(--fg)' },
        ];
        document.getElementById('queue-stats').innerHTML = statCards.map(function(sc) {
          return '<div class="card" style="padding:14px;text-align:center">' +
            '<div class="stat-num" style="color:' + sc.color + '">' + sc.val + '</div>' +
            '<div class="stat-label">' + esc(sc.label) + '</div></div>';
        }).join('');
        // Workers
        const wEl = document.getElementById('queue-workers');
        const wLimit = 'Concurrency: <strong>' + (m.concurrencyLimit || 0) + '</strong> &nbsp;&bull;&nbsp; Queue depth: <strong>' + (m.queueDepthLimit || 0) + '</strong>';
        let wHtml = '<div style="font-size:0.8rem;color:var(--mt);margin-bottom:10px">' + wLimit + '</div>';
        if (m.workers && m.workers.length > 0) {
          wHtml += '<div style="font-size:0.78rem;margin-bottom:6px;color:var(--mt);text-transform:uppercase;letter-spacing:0.07em;font-weight:600">Active Workers</div>';
          for (const w of m.workers) {
            wHtml += '<div style="font-size:0.82rem;padding:6px 10px;background:var(--s2);border:1px solid var(--ok-bd);border-left:3px solid var(--ok);border-radius:6px;margin-bottom:5px;display:flex;align-items:center;gap:8px"><span class="st-badge st-running">running</span><code style="font-size:0.75rem">' + esc(w.id || 'worker') + '</code><span style="color:var(--mt)">&rarr;</span><span style="color:var(--fg);font-size:0.8rem">' + esc(w.taskID || '?') + '</span></div>';
          }
        }
        wEl.innerHTML = wHtml;
        // Recent tasks
        const tEl = document.getElementById('queue-tasks');
        const taskArr = Array.isArray(tasks) ? tasks : (tasks.tasks || []);
        if (taskArr.length > 0) {
          let tHtml = '<div style="font-size:0.78rem;margin-bottom:8px;color:var(--mt);text-transform:uppercase;letter-spacing:0.07em;font-weight:600">Recent Tasks</div>';
          for (const tk of taskArr.slice(0, 15)) {
            const stCls = tk.state === 'completed' ? 'st-ok' : tk.state === 'running' ? 'st-running' : tk.state === 'failed' ? 'st-err' : 'st-warn';
            tHtml += '<div style="display:flex;align-items:center;gap:10px;padding:7px 10px;border-bottom:1px solid var(--bd);font-size:0.82rem">' +
              '<span class="st-badge ' + stCls + '">' + esc(tk.state || '?') + '</span>' +
              '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg)">' + esc(tk.title || tk.prompt?.slice(0,60) || tk.id) + '</span>' +
              '</div>';
          }
          tEl.innerHTML = tHtml;
        } else { tEl.innerHTML = '<div style="color:var(--mt);font-size:0.82rem;padding:8px 0">No tasks in queue.</div>'; }
      } catch(e) {
        document.getElementById('queue-stats').innerHTML = '';
        document.getElementById('queue-workers').innerHTML = '<div style="color:var(--muted)">Error: ' + esc(String(e)) + '</div>';
        document.getElementById('queue-tasks').innerHTML = '';
      }
    }
    // Auto-refresh for queue panel
    let queueRefreshTimer = null;
    function startQueueAutoRefresh() {
      if (queueRefreshTimer) clearInterval(queueRefreshTimer);
      queueRefreshTimer = setInterval(function() {
        const cb = document.getElementById('queue-auto-refresh');
        const panel = document.getElementById('panel-queue');
        if (cb && cb.checked && panel && panel.classList.contains('active')) loadQueue();
      }, 5000);
    }
    startQueueAutoRefresh();
    window.addEventListener('beforeunload', function() { if (queueRefreshTimer) clearInterval(queueRefreshTimer); });

    async function loadOrchestrations() {
      const el = document.getElementById('orchestrations-list');
      try {
        const list = await fetchJSON('/api/orchestrations');
        const t = TRANSLATIONS[currentLang];
        if (!list || list.length === 0) {
          el.innerHTML = '<div style="color:var(--mt);padding:24px;text-align:center;font-size:0.88rem">' +
            esc(t.noOrchestrations) +
            '<br><code style="font-size:0.78rem;color:var(--mt);margin-top:8px;display:block">POST /api/orchestrations { "name": "...", "tasks": [...] }</code></div>';
        } else {
          el.innerHTML = list.map(o => {
            const st = o.status || '?';
            const stCls = st === 'completed' ? 'st-ok' : st === 'running' ? 'st-running' : st === 'failed' ? 'st-err' : 'st-warn';
            const accentColor = st === 'completed' ? 'var(--ok)' : st === 'running' ? '#3b82f6' : st === 'failed' ? 'var(--err)' : '#f59e0b';
            const tasks = o.tasks || [];
            const doneCount = tasks.filter(tk => tk.status === 'completed' || tk.state === 'completed').length;
            const time = o.createdAt ? new Date(o.createdAt).toLocaleString() : '';
            const taskRows = tasks.slice(0, 6).map(tk => {
              const ts = tk.status || tk.state || '?';
              const tCls = ts === 'completed' ? 'st-ok' : ts === 'running' ? 'st-running' : ts === 'failed' ? 'st-err' : 'st-warn';
              return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--bd);font-size:0.79rem">' +
                '<span class="st-badge ' + tCls + '">' + esc(ts) + '</span>' +
                '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg)">' + esc(tk.title || tk.name || tk.id || '?') + '</span>' +
                '</div>';
            }).join('');
            return '<div style="padding:14px 16px;border:1px solid var(--bd);border-left:3px solid ' + accentColor + ';border-radius:0 10px 10px 0;margin-bottom:12px;background:var(--s1)">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px">' +
              '<div style="display:flex;align-items:center;gap:10px">' +
              '<span class="st-badge ' + stCls + '">' + esc(st) + '</span>' +
              '<strong style="color:var(--fg);font-size:0.95rem">' + esc(o.name || o.id || 'Orchestration') + '</strong>' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:10px">' +
              (tasks.length > 0 ? '<span style="font-size:0.75rem;color:var(--mt)">' + doneCount + '/' + tasks.length + ' tasks</span>' : '') +
              (time ? '<span style="color:var(--mt);font-size:0.75rem">' + esc(time) + '</span>' : '') +
              '</div></div>' +
              (o.id ? '<code style="font-size:0.72rem;color:var(--mt)">id: ' + esc(String(o.id).slice(0,20)) + '</code>' : '') +
              (taskRows ? '<div style="margin-top:8px;padding:8px 10px;background:var(--s2);border-radius:6px">' + taskRows + '</div>' : '') +
              '</div>';
          }).join('');
        }
      } catch(e) { el.innerHTML = '<div style="color:var(--err);padding:8px">Error: ' + esc(String(e)) + '</div>'; }
    }

    async function loadParallel() {
      try {
        const [plans, toolExecs] = await Promise.all([
          fetchJSON('/api/parallel'),
          fetchJSON('/api/parallel/tool-executions?limit=30'),
        ]);
        const t = TRANSLATIONS[currentLang];
        let html = '';

        // Tool-level parallel executions from agent loop
        if (toolExecs.length > 0) {
          html += '<h4 style="margin:0 0 8px 0;color:var(--fg)" data-i18n="parallelToolCalls">' + t.parallelToolCalls + '</h4>';
          html += toolExecs.map(function(ex) {
            const time = new Date(ex.createdAt).toLocaleTimeString();
            const statusCls = ex.status === 'completed' ? 'st-ok' : 'st-err';
            const toolList = ex.tools.map(function(tt) {
              const icon = tt.success ? '\u2713' : '\u2717';
              const iconStyle = tt.success ? 'color:var(--ok)' : 'color:var(--err)';
              return '<div style="display:flex;align-items:center;gap:6px;padding:2px 0"><span style="' + iconStyle + ';font-weight:700;font-size:0.85rem">' + icon + '</span><code style="font-size:0.78rem">' + esc(tt.name) + '</code><span style="color:var(--mt);font-size:0.75rem">' + tt.durationMs + 'ms</span></div>';
            }).join('');
            const promptHtml = ex.prompt ? '<div><div class="prompt-label">&#128172; Triggered by</div><div class="prompt-preview">' + esc(ex.prompt.length > 250 ? ex.prompt.substring(0, 250) + '\u2026' : ex.prompt) + '</div></div>' : '';
            return '<div class="card" style="padding:12px 14px;margin-bottom:10px;border-left:3px solid ' + (ex.status === 'completed' ? 'var(--ok)' : 'var(--err)') + ';border-radius:0 10px 10px 0">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
              '<div style="display:flex;align-items:center;gap:8px"><strong style="font-size:0.9rem">' + t.round + ' ' + ex.round + ' &mdash; ' + ex.tools.length + ' ' + t.tools + '</strong><span class="st-badge ' + statusCls + '">' + (ex.status || 'done') + '</span></div>' +
              '<span style="color:var(--mt);font-size:0.78rem">' + time + '</span>' +
              '</div>' +
              promptHtml +
              '<div style="margin-top:4px;padding:8px 10px;background:var(--s2);border:1px solid var(--bd);border-radius:6px">' + toolList + '</div>' +
              (ex.sessionId ? '<div style="font-size:0.72rem;color:var(--mt);margin-top:6px">Session: <code style="font-size:0.72rem">' + esc(ex.sessionId) + '</code></div>' : '') +
              '</div>';
          }).join('');
        }

        // Orchestrated parallel plans
        if (plans.length > 0) {
          html += '<h4 style="margin:16px 0 8px 0;color:var(--fg)" data-i18n="parallelPlans">' + t.parallelPlans + '</h4>';
          html += '<pre>' + pretty(plans) + '</pre>';
        }

        if (!html) {
          html = '<div style="color:var(--mt)">' + t.noParallel + '</div>';
        }
        document.getElementById('parallel-list').innerHTML = html;
      } catch(e) { document.getElementById('parallel-list').textContent = 'Error: ' + e; }
    }

    async function loadSessions() {
      const el = document.getElementById('sessions-list');
      try {
        const list = await fetchJSON('/api/chat/sessions');
        const sessions = Array.isArray(list) ? list : [];
        const t = TRANSLATIONS[currentLang];
        if (sessions.length === 0) {
          el.innerHTML = '<div style="color:var(--mt);padding:24px;text-align:center;font-size:0.88rem">' + esc(t.noSessions) + '</div>';
        } else {
          el.innerHTML = sessions.map(s => {
            const time = new Date(s.lastMessageAt).toLocaleString();
            const model = s.model || '?';
            const mc = model.toLowerCase();
            const mColor = mc.includes('claude') ? '#f59e0b' : mc.includes('gpt') || mc.includes('openai') ? '#10b981' : mc.includes('gemini') ? '#3b82f6' : mc.includes('llama') ? '#ec4899' : '#a78bfa';
            return '<div style="padding:14px 16px;border:1px solid var(--bd);border-radius:10px;margin-bottom:10px;background:var(--s1)">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px">' +
              '<div style="display:flex;align-items:center;gap:8px">' +
              '<span style="padding:2px 8px;background:' + mColor + '22;border:1px solid ' + mColor + '55;border-radius:4px;color:' + mColor + ';font-size:0.72rem;font-family:ui-monospace,monospace;font-weight:600">' + esc(model) + '</span>' +
              '<code style="color:var(--mt);font-size:0.72rem">' + esc(s.id.slice(0,12)) + '</code>' +
              '</div>' +
              '<span style="color:var(--mt);font-size:0.75rem">' + esc(time) + '</span>' +
              '</div>' +
              '<div style="color:var(--fg);font-size:0.88rem;font-weight:500;margin-bottom:4px">' + esc(s.title || '(untitled)') + '</div>' +
              '<div style="color:var(--mt);font-size:0.75rem">' + (s.messageCount || 0) + ' ' + t.messages + '</div>' +
              '</div>';
          }).join('');
        }
      } catch(e) { el.innerHTML = '<div style="color:var(--err);padding:8px">Error: ' + esc(String(e)) + '</div>'; }
    }

    function getModelIcon(name) {
      const n = (name || '').toLowerCase();
      if (n.includes('gpt') || n.includes('openai')) return '🤖';
      if (n.includes('claude')) return '🟣';
      if (n.includes('gemini') || n.includes('bard') || n.includes('palm')) return '💎';
      if (n.includes('llama')) return '🦙';
      if (n.includes('qwen')) return '🐉';
      if (n.includes('mistral') || n.includes('mixtral')) return '🌊';
      if (n.includes('deepseek')) return '🔭';
      if (n.includes('phi')) return '🔬';
      if (n.includes('dall-e') || n.includes('dalle') || n.includes('flux') || n.includes('stable-diff')) return '🎨';
      if (n.includes('whisper') || n.includes('speech') || n.includes('tts') || n.includes('audio')) return '🎤';
      if (n.includes('embed') || n.includes('sentence') || n.includes('vector')) return '📊';
      if (n.includes('minimax')) return '✨';
      if (n.includes('codestral') || n.includes('starcoder') || n.includes('codegemma') || n.includes('coder')) return '💻';
      if (n.includes('yi')) return '🌟';
      if (n.includes('falcon')) return '🦅';
      if (n.includes('solar')) return '☀️';
      return '🧠';
    }

    async function loadModels() {
      try {
        const reg = await fetchJSON('/api/registry');
        const t = TRANSLATIONS[currentLang];
        let html = '';
        if (reg.local && reg.local.length > 0) {
          for (const p of reg.local) {
            const isOnline = p.status === 'online';
            const statusColor = isOnline ? 'var(--ok)' : 'var(--err)';
            html += '<div style="margin-bottom:16px;padding:14px 16px;background:var(--s1);border:1px solid var(--bd);border-radius:10px">';
            html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
            html += '<div style="display:flex;align-items:center;gap:10px">';
            html += '<span style="width:8px;height:8px;border-radius:50%;background:' + statusColor + ';display:inline-block;box-shadow:0 0 6px ' + statusColor + '"></span>';
            html += '<strong style="color:var(--fg);font-size:0.95rem">' + esc(p.name) + '</strong>';
            html += '</div>';
            html += '<span style="padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:700;letter-spacing:0.06em;background:' + statusColor + '22;border:1px solid ' + statusColor + '55;color:' + statusColor + '">' + (isOnline ? 'ONLINE' : 'OFFLINE') + '</span>';
            html += '</div>';
            html += '<div style="color:var(--mt);font-size:0.75rem;margin-bottom:10px;font-family:ui-monospace,monospace">' + esc(p.endpoint) + (p.latencyMs ? ' <span style="color:var(--ok)">' + p.latencyMs + 'ms</span>' : '') + '</div>';
            if (p.models && p.models.length > 0) {
              html += '<div style="display:flex;flex-direction:column;gap:6px">';
              for (const m of p.models) {
                const icon = getModelIcon(m.name || m.id);
                html += '<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--s2);border:1px solid var(--bd);border-radius:8px">';
                html += '<span style="font-size:1.2rem;flex-shrink:0">' + icon + '</span>';
                html += '<div style="flex:1;min-width:0">';
                html += '<div style="color:#a78bfa;font-family:ui-monospace,monospace;font-size:0.83rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(m.name || m.id) + '</div>';
                html += '<div style="display:flex;gap:10px;margin-top:3px">';
                if (m.contextLimit) html += '<span style="font-size:0.7rem;color:var(--mt)">ctx <strong style="color:var(--fg)">' + Math.floor(m.contextLimit/1000) + 'k</strong></span>';
                if (m.outputLimit) html += '<span style="font-size:0.7rem;color:var(--mt)">out <strong style="color:var(--fg)">' + m.outputLimit + '</strong></span>';
                html += '</div></div></div>';
              }
              html += '</div>';
            }
            html += '</div>';
          }
        } else { html = '<div style="color:var(--mt);padding:16px;text-align:center">No local vLLM endpoints configured</div>'; }
        document.getElementById('local-models').innerHTML = html;
        let cloudHtml = '';
        if (reg.cloud && reg.cloud.length > 0) {
          cloudHtml = '<div style="display:flex;flex-direction:column;gap:6px">';
          for (const p of reg.cloud) {
            const icon = getModelIcon(p.name);
            cloudHtml += '<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--s1);border:1px solid var(--bd);border-radius:8px">';
            cloudHtml += '<span style="font-size:1.2rem;flex-shrink:0">' + icon + '</span>';
            cloudHtml += '<span style="color:var(--fg);font-size:0.88rem;font-weight:500;flex:1">' + esc(p.name) + '</span>';
            cloudHtml += '<span style="padding:2px 10px;border-radius:4px;font-size:0.7rem;font-weight:700;letter-spacing:0.06em;background:' + (p.configured?'var(--ok-bg)':'var(--s2)') + ';border:1px solid ' + (p.configured?'var(--ok-bd)':'var(--bd)') + ';color:' + (p.configured?'var(--ok)':'var(--mt)') + '">' + esc(p.configured ? t.configured : t.noApiKey) + '</span>';
            cloudHtml += '</div>';
          }
          cloudHtml += '</div>';
        }
        if (!cloudHtml) cloudHtml = '<div style="color:var(--mt);padding:16px">No cloud providers</div>';
        document.getElementById('cloud-providers').innerHTML = cloudHtml;
      } catch(e) { document.getElementById('local-models').innerHTML = '<div style="color:var(--err)">Error: ' + esc(String(e)) + '</div>'; }
    }

    // ── Users panel ───────────────────────────────────────────────
    async function loadUsers() {
      try {
        const stats = await fetchJSON('/api/admin/stats');
        const rolesData = await fetchJSON('/api/admin/roles');
        const availableRoles = (rolesData.roles || []).map(function(r) { return r.name; });
        document.getElementById('user-stats').innerHTML =
          '<div class="card" style="padding:12px;text-align:center"><div class="stat-num">' + (stats.total_users||0) + '</div><div class="stat-label">Total Users</div></div>' +
          '<div class="card" style="padding:12px;text-align:center"><div class="stat-num">' + (stats.active_users||0) + '</div><div class="stat-label">Active</div></div>' +
          '<div class="card" style="padding:12px;text-align:center"><div class="stat-num warn-text">' + (stats.pending_registrations||0) + '</div><div class="stat-label">Pending Reg</div></div>' +
          '<div class="card" style="padding:12px;text-align:center"><div class="stat-num">' + (stats.active_api_keys||0) + '</div><div class="stat-label">API Keys</div></div>' +
          '<div class="card" style="padding:12px;text-align:center"><div class="stat-num' + ((stats.pending_api_keys||0) > 0 ? ' warn-text' : '') + '">' + (stats.pending_api_keys||0) + '</div><div class="stat-label">Keys Pending</div></div>';

        // Pending registrations
        const regs = await fetchJSON('/api/admin/registrations');
        if (regs.registrations && regs.registrations.length > 0) {
          let rhtml = '<table><thead><tr><th>Email</th><th>Name</th><th>Requested</th><th>Actions</th></tr></thead><tbody>';
          for (const r of regs.registrations) {
            rhtml += '<tr><td>' + esc(r.email) + '</td><td>' + esc(r.full_name||'-') + '</td><td>' + new Date(r.created_at).toLocaleString() + '</td>';
            rhtml += '<td><button class="btn" style="padding:3px 10px;font-size:0.72rem" onclick="approveReg(\\'' + r.id + '\\')">Approve</button> ';
            rhtml += '<button class="btn secondary" style="padding:3px 10px;font-size:0.72rem" onclick="rejectReg(\\'' + r.id + '\\')">Reject</button></td></tr>';
          }
          rhtml += '</tbody></table>';
          document.getElementById('pending-registrations').innerHTML = rhtml;
        } else {
          document.getElementById('pending-registrations').innerHTML = '<div style="color:var(--mt);padding:12px;text-align:center">No pending registrations</div>';
        }

        // All users
        const usersData = await fetchJSON('/api/admin/users');
        // Also fetch API key status
        let apiKeyMap = {};
        let allApiKeys = [];
        try {
          const akData = await fetch('/api/admin/api-keys', { headers: authHeaders() });
          if (akData.ok) { const d = await akData.json(); allApiKeys = d.keys || []; allApiKeys.forEach(function(k){ if(!apiKeyMap[k.userId]) apiKeyMap[k.userId] = []; apiKeyMap[k.userId].push(k); }); }
        } catch(e) { /* ignore */ }

        // Pending API keys section
        const pendingKeys = allApiKeys.filter(function(k){ return k.status === 'active' && !k.adminVerified; });
        if (pendingKeys.length > 0) {
          let pkhtml = '<table><thead><tr><th>User</th><th>Key Preview</th><th>Submitted</th><th>Actions</th></tr></thead><tbody>';
          for (const pk of pendingKeys) {
            pkhtml += '<tr>';
            pkhtml += '<td>' + esc(pk.userEmail || pk.userId) + '</td>';
            pkhtml += '<td><code style="font-size:0.72rem">' + esc(pk.keyPreview || '***') + '</code></td>';
            pkhtml += '<td style="font-size:0.78rem;color:var(--mt)">' + (pk.createdAt ? new Date(pk.createdAt).toLocaleString() : '-') + '</td>';
            pkhtml += '<td>';
            pkhtml += '<button class="btn" style="padding:3px 10px;font-size:0.72rem" onclick="verifyApiKey(\\'' + pk.id + '\\')">Approve</button> ';
            pkhtml += '<button class="btn secondary" style="padding:3px 10px;font-size:0.72rem" onclick="rejectApiKey(\\'' + pk.id + '\\')">Reject</button>';
            pkhtml += '</td></tr>';
          }
          pkhtml += '</tbody></table>';
          document.getElementById('pending-api-keys').innerHTML = pkhtml;
        } else {
          document.getElementById('pending-api-keys').innerHTML = '<div style="color:var(--mt);padding:12px;text-align:center">No pending API key approvals</div>';
        }
        if (usersData.users && usersData.users.length > 0) {
          let uhtml = '<table><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>API Key</th><th>Last Login</th><th>Actions</th></tr></thead><tbody>';
          for (const u of usersData.users) {
            const roleName = u.roleName || u.role_name || u.role || 'developer';
            const displayName = u.fullName || u.full_name || u.name || '-';
            const lastLogin = u.lastLoginAt || u.last_login_at || u.last_login || null;
            const stCls = u.status === 'active' ? 'st-ok' : (u.status === 'suspended' ? 'st-warn' : 'st-err');
            const userKeys = apiKeyMap[u.id] || [];
            const activeKey = userKeys.find(function(k){ return k.status === 'active'; });
            var keyHtml;
            if (activeKey && activeKey.adminVerified) {
              keyHtml = '<span title="Verified: ' + esc(activeKey.keyPreview||'') + '" style="display:inline-flex;align-items:center;gap:4px"><span style="width:7px;height:7px;border-radius:50%;background:var(--ok);display:inline-block"></span><code style="font-size:0.7rem">' + esc(activeKey.keyPreview||'set') + '</code><span class="st-badge st-ok" style="font-size:0.6rem;padding:1px 4px">verified</span></span>';
            } else if (activeKey && !activeKey.adminVerified) {
              keyHtml = '<span title="Pending verification: ' + esc(activeKey.keyPreview||'') + '" style="display:inline-flex;align-items:center;gap:4px"><span style="width:7px;height:7px;border-radius:50%;background:orange;display:inline-block"></span><code style="font-size:0.7rem">' + esc(activeKey.keyPreview||'set') + '</code><span class="st-badge st-warn" style="font-size:0.6rem;padding:1px 4px">pending</span></span>';
            } else {
              keyHtml = '<span style="display:inline-flex;align-items:center;gap:4px"><span style="width:7px;height:7px;border-radius:50%;background:var(--err);display:inline-block"></span><span style="font-size:0.7rem;color:var(--err)">not set</span></span>';
            }
            uhtml += '<tr>';
            uhtml += '<td>' + esc(u.email) + '</td>';
            uhtml += '<td>' + esc(displayName) + '</td>';
            uhtml += '<td><code>' + esc(roleName) + '</code></td>';
            uhtml += '<td><span class="st-badge ' + stCls + '">' + esc(u.status) + '</span></td>';
            uhtml += '<td>' + keyHtml + '</td>';
            uhtml += '<td style="font-size:0.78rem;color:var(--mt)">' + (lastLogin ? new Date(lastLogin).toLocaleString() : 'never') + '</td>';
            uhtml += '<td>';
            uhtml += '<select onchange="changeRole(\\'' + u.id + '\\', this.value)" style="padding:2px 6px;font-size:0.72rem;background:var(--s2);border:1px solid var(--bd);border-radius:4px;color:var(--fg)">';
            for (const role of (availableRoles.length ? availableRoles : ['admin','developer','readonly'])) {
              uhtml += '<option' + (roleName === role ? ' selected' : '') + '>' + role + '</option>';
            }
            uhtml += '</select> ';
            if (u.status === 'active') {
              uhtml += '<button class="btn secondary" style="padding:2px 8px;font-size:0.68rem" onclick="changeStatus(\\'' + u.id + '\\', \\'suspended\\')">Suspend</button>';
            } else {
              uhtml += '<button class="btn" style="padding:2px 8px;font-size:0.68rem" onclick="changeStatus(\\'' + u.id + '\\', \\'active\\')">Activate</button>';
            }
            uhtml += '</td></tr>';
          }
          uhtml += '</tbody></table>';
          document.getElementById('users-list').innerHTML = uhtml;
        } else {
          document.getElementById('users-list').innerHTML = '<div style="color:var(--mt);padding:12px;text-align:center">No users yet. Bootstrap admin is auto-created on first start.</div>';
        }
      } catch(e) { document.getElementById('users-list').innerHTML = '<div style="color:var(--err)">Error loading users: ' + esc(String(e)) + '</div>'; }
    }

    async function approveReg(id) {
      await fetch('/api/admin/registrations/' + id + '/approve', { method: 'POST', headers: Object.assign({'Content-Type':'application/json'}, authHeaders()), body: JSON.stringify({roleName:'developer'}) });
      loadUsers();
    }
    async function rejectReg(id) {
      const reason = prompt('Rejection reason (optional):');
      await fetch('/api/admin/registrations/' + id + '/reject', { method: 'POST', headers: Object.assign({'Content-Type':'application/json'}, authHeaders()), body: JSON.stringify({reason}) });
      loadUsers();
    }
    async function verifyApiKey(keyId) {
      try {
        const res = await fetch('/api/admin/api-keys/' + keyId + '/verify', { method: 'POST', headers: Object.assign({'Content-Type':'application/json'}, authHeaders()) });
        const data = await res.json().catch(function(){ return {}; });
        if (!res.ok) { alert('Failed to verify key: ' + (data.error || 'Unknown error')); return; }
        loadUsers();
      } catch(e) { alert('Error verifying key: ' + e); }
    }
    async function rejectApiKey(keyId) {
      if (!confirm('Reject and revoke this API key?')) return;
      try {
        const res = await fetch('/api/admin/api-keys/' + keyId + '/reject', { method: 'POST', headers: Object.assign({'Content-Type':'application/json'}, authHeaders()) });
        const data = await res.json().catch(function(){ return {}; });
        if (!res.ok) { alert('Failed to reject key: ' + (data.error || 'Unknown error')); return; }
        loadUsers();
      } catch(e) { alert('Error rejecting key: ' + e); }
    }
    async function changeRole(userId, roleName) {
      const res = await fetch('/api/admin/users/' + userId + '/role', { method: 'PATCH', headers: Object.assign({'Content-Type':'application/json'}, authHeaders()), body: JSON.stringify({roleName}) });
      const data = await res.json().catch(function(){ return {}; });
      if (!res.ok) throw new Error(data.error || 'Failed to update role');
      loadUsers();
    }
    async function changeStatus(userId, status) {
      const res = await fetch('/api/admin/users/' + userId + '/status', { method: 'PATCH', headers: Object.assign({'Content-Type':'application/json'}, authHeaders()), body: JSON.stringify({status}) });
      const data = await res.json().catch(function(){ return {}; });
      if (!res.ok) throw new Error(data.error || 'Failed to update status');
      loadUsers();
    }

    // On load — check if we have a saved token and show user info
    if (dashToken) {
      fetch('/api/auth/me', { headers: authHeaders() }).then(r => r.json()).then(d => {
        if (d.user) {
          document.getElementById('dashLogoutBtn').style.display = '';
          document.getElementById('dashLoginAdminBtn').style.display = 'none';
          document.getElementById('sidebarUser').style.display = 'flex';
          document.getElementById('sidebarUserEmail').textContent = d.user.email;
          document.getElementById('sidebarAvatar').textContent = (d.user.email||'A')[0].toUpperCase();
        } else { dashToken = ''; localStorage.removeItem('dashToken'); }
      }).catch(() => { dashToken = ''; localStorage.removeItem('dashToken'); });
    }
    // Auto-load dashboard
    loadDashboard();
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
app.route("/api/chat", chatRoutes(workspaces, chatLog, parallelExecutor))
app.route("/api/skills", skillRoutes(skills))
app.route("/api/policies", policyRoutes(policyEngine))
app.route("/api/hitl", hitlRoutes(hitl))
app.route("/api/admin", adminRoutes())

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

// Auto-start OpenCode engine if not already running.
// Skipped if this module was imported by start-all.ts (which starts OpenCode first).
{
  const { isPortFree } = await import("../config/env")
  const ocPort = Number(new URL(env.OPENCODE_URL).port || "4096")
  if (isPortFree(ocPort, "127.0.0.1")) {
    // Port is free → OpenCode is not running → start it
    try {
      const { opencode } = await import("../services/opencode-process")
      const ocUrl = await opencode.start({ directory: env.OPENCODE_DIR })
      console.log(`[platform] OpenCode engine started at ${ocUrl}`)
    } catch (e: any) {
      console.warn(`[platform] Could not auto-start OpenCode: ${e.message} — platform will run in standalone mode`)
    }
  }
}

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
┌───────────────────────────────────────────────────────┐
│  Thirdwave AI Coding Platform                         │
│  Platform  →  http://${server.hostname}:${server.port}│
│  OpenCode  →  ${env.OPENCODE_URL}                     │
│  Env       →  ${env.NODE_ENV}                         │
└───────────────────────────────────────────────────────┘
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
