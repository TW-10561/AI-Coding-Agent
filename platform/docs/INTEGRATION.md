# Thirdwave AI Coding Platform — Integration Documentation

> **Audience**: Integration leads, platform engineers, DevOps  
> **Version**: 0.1.0  
> **Last Updated**: July 2025

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Component Map](#2-component-map)
3. [Data Flow](#3-data-flow)
4. [Service-Layer Integrations](#4-service-layer-integrations)
5. [Middleware Chain](#5-middleware-chain)
6. [REST API Route Map](#6-rest-api-route-map)
7. [AI Engine Integration (OpenCode)](#7-ai-engine-integration-opencode)
8. [Model Provider Integration](#8-model-provider-integration)
9. [Tool Execution Integration](#9-tool-execution-integration)
10. [CLI Client Integration](#10-cli-client-integration)
11. [Deployment Integration (systemd + nginx)](#11-deployment-integration-systemd--nginx)
12. [Database / Persistence Layer](#12-database--persistence-layer)
13. [Security & Policy Integration](#13-security--policy-integration)
14. [Skills / Knowledge System](#14-skills--knowledge-system)
15. [SDK Client Library](#15-sdk-client-library)
16. [Multi-User / Port Offset](#16-multi-user--port-offset)
17. [Environment Configuration Reference](#17-environment-configuration-reference)
18. [Integration Dependency Graph](#18-integration-dependency-graph)

---

## 1. Architecture Overview

```
┌──────────────┐     HTTP      ┌───────────────────────────────────────┐
│  CLI Client  │ ────────────► │       nginx (port 80)                 │
│  ("art")     │               │  reverse proxy + rate limiting        │
└──────────────┘               └──────────────┬────────────────────────┘
                                              │
                                              ▼
                               ┌──────────────────────────────────────┐
                               │   Thirdwave Platform (Hono, port 3100) │
                               │                                      │
                               │  ┌──────────────────────────────┐   │
                               │  │    Middleware Chain           │   │
                               │  │  logger → cors → rateLimit   │   │
                               │  │  → auth → auditMiddleware    │   │
                               │  └──────────────────────────────┘   │
                               │                                      │
                               │  ┌──────────────────────────────┐   │
                               │  │    16 Route Modules           │   │
                               │  │  health, sessions, tasks,     │   │
                               │  │  providers, files, events,    │   │
                               │  │  audit, budget, workspaces,   │   │
                               │  │  orchestrations, queue,       │   │
                               │  │  parallel, registry, chat,    │   │
                               │  │  skills, policies             │   │
                               │  └──────────────────────────────┘   │
                               │                                      │
                               │  ┌──────────────────────────────┐   │
                               │  │    13 Service Classes         │   │
                               │  │  (see Service Layer section)  │   │
                               │  └──────────────────────────────┘   │
                               │                                      │
                               └───────────┬─────────────┬────────────┘
                                           │             │
                          ┌────────────────┘             └─────────────────┐
                          ▼                                                ▼
               ┌──────────────────────┐                    ┌──────────────────────┐
               │  OpenCode Engine     │                    │  Model Providers     │
               │  (port 4096)         │                    │                      │
               │  Session, VCS, File  │                    │  ┌ vLLM Primary     │
               │  management, Agent   │                    │  ├ vLLM Secondary   │
               │  routing             │                    │  ├ Ollama Gateway   │
               └──────────────────────┘                    │  ├ OpenAI          │
                                                           │  ├ Anthropic       │
                                                           │  ├ Google AI       │
                                                           │  ├ Mistral         │
                                                           │  ├ Groq            │
                                                           │  ├ DeepSeek        │
                                                           │  ├ Together        │
                                                           │  ├ Fireworks       │
                                                           │  └ OpenRouter      │
                                                           └──────────────────────┘
```

**Key Design Principle**: The Platform is a **thin orchestration layer**. It does NOT embed a model — it delegates to external inference servers (local vLLM/Ollama or cloud APIs) and to OpenCode for session/project management.

---

## 2. Component Map

| Component | Technology | Port | Location | Purpose |
|-----------|-----------|------|----------|---------|
| **Platform Server** | Bun + Hono 4.10 | 3100 | `platform/src/server/index.ts` | REST API, routing, service orchestration |
| **OpenCode Engine** | Go binary (v1.2.17) | 4096 | `/home/nvidia/.opencode/bin/opencode` | AI session management, agent routing, VCS |
| **nginx Proxy** | nginx 1.24 | 80 | `platform/deploy/nginx/thirdwave.conf` | Rate limiting, SSL termination, proxying |
| **vLLM Primary** | vLLM inference | 8000 | `172.30.140.91:8000` | MiniMax M2.1 REAP (30k ctx) |
| **vLLM Secondary** | vLLM inference | 8000 | `localhost:8000` | gpt-oss-120b (8k ctx) |
| **Ollama Gateway** | Ollama | 31254 | `172.30.140.143:31254` | 5 models (Qwen, GPT-OSS) |
| **CLI Client** | Bash + Python3 | — | `platform/bin/thirdwave-client` | User-facing terminal tool ("art") |
| **Platform SDK** | TypeScript | — | `platform/src/sdk/client.ts` | Programmatic API client library |
| **systemd Service** | Linux service | — | `platform/deploy/systemd/thirdwave.service` | Process management + auto-restart |
| **SQLite Databases** | bun:sqlite + WAL | — | `.platform/*.db` | Audit, budget, workspaces, tasks |

---

## 3. Data Flow

### 3.1 — Agentic Chat Flow (CLI → AI → Tools → Response)

This is the primary user-facing flow when someone uses the `art` CLI:

```
User types: art chat "fix the login bug"
     │
     ▼
  CLI (thirdwave-client)
     │  POST /api/chat  { message: "fix the login bug" }
     │  Headers: Content-Type: application/json
     ▼
  nginx (:80)
     │  rate limit: 5r/s (thirdwave_chat zone)
     │  proxy_read_timeout: 300s (for long tool loops)
     ▼
  Platform (:3100)  →  chat.ts route handler
     │
     │  1. Resolve model from provider registry
     │  2. Build system prompt + tool definitions
     │  3. Call vLLM/Ollama/Cloud with OpenAI-compatible API
     │  4. If model returns tool_calls → TOOL LOOP:
     │      ├── Execute each tool (bash, read_file, write_file, etc.)
     │      ├── Append tool results to conversation
     │      └── Call LLM again (up to 15 rounds)
     │  5. Return final response + toolCalls log
     ▼
  Response JSON:
     {
       "text": "I've fixed the login bug. Here's what I did...",
       "model": "plezan/MiniMax-M2.1-REAP-50-W4A16",
       "provider": "Local vLLM — 172.30.140.91:8000",
       "tokens": { "input": 2340, "output": 856 },
       "latencyMs": 12430,
       "toolCalls": [
         { "tool": "read_file", "args": {"path":"src/auth.ts"}, "result": "...", "success": true },
         { "tool": "write_file", "args": {"path":"src/auth.ts","content":"..."}, "result": "written", "success": true },
         { "tool": "bash", "args": {"command":"bun test"}, "result": "3 passed", "success": true }
       ]
     }
     │
     ▼
  CLI processes response:
     1. Display AI's text response (formatted)
     2. Show tool usage summary (✓/✗ per tool)
     3. Extract write_file tool calls → save files locally
     4. Extract code blocks from text → save as fallback
```

### 3.2 — Direct Chat (No Tools)

```
POST /api/chat/direct  { message: "explain closures" }
     │
     Platform → calls LLM once (no tools, no loop)
     │
     Response: { text, model, provider, tokens, latencyMs }
```

### 3.3 — Streaming Chat (SSE)

```
POST /api/chat/stream  { message: "..." }
     │
     Platform → calls LLM with streaming
     │
     SSE events: data: {"type":"chunk","content":"I"}\n\n
                 data: {"type":"chunk","content":" think"}\n\n
                 ...
                 data: {"type":"done","model":"..."}\n\n
```

### 3.4 — Task Queue Flow

```
POST /api/queue  { title, prompt, priority }
     │
     ▼
  ScalableQueue (SQLite-backed)
     │  Enqueue as "queued" state
     │  Worker picks up based on priority
     ▼
  TaskStateTracker updates: queued → running → completed/failed
     │  (persisted to tasks.db)
     ▼
  OpenCodeClient.sendMessage() executes the prompt
     │
  AuditLogger records the event
  BudgetManager records token usage
```

---

## 4. Service-Layer Integrations

The platform instantiates 13 service classes in `platform/src/server/index.ts`. Here is each service, its role, and how it integrates with other services:

### 4.1 — OpenCodeClient

| | |
|---|---|
| **File** | `platform/src/services/opencode-client.ts` |
| **Purpose** | Typed HTTP + SSE wrapper for the OpenCode engine (Go binary on :4096) |
| **Used by** | TaskQueue, ScalableQueue, SubagentOrchestrator, ParallelExecutionManager |
| **Depends on** | `env.OPENCODE_URL`, `env.OPENCODE_DIR` |

**Key methods**:
- `health()` — probe OpenCode liveness
- `createSession(opts)` — create AI session
- `sendMessage(sessionID, parts, agent?)` — send prompt to OpenCode
- `listSessions()` / `deleteSession()` — session lifecycle
- `currentProject()`, `projects()`, `config()` — project introspection
- `files()`, `vcs()`, `paths()` — file and VCS operations

**Integration pattern**: HTTP client → OpenCode server. Sessions are identified by ULID. Messages use the `parts` format: `[{ type: "text", text: "..." }]`.

---

### 4.2 — TaskQueue (Simple)

| | |
|---|---|
| **File** | `platform/src/services/task-queue.ts` |
| **Purpose** | In-memory FIFO job queue for coding tasks |
| **Used by** | `taskRoutes`, `eventRoutes` |
| **Depends on** | OpenCodeClient |

**Integration**: Accepts prompt + directory, creates a session via OpenCodeClient, sends the message, tracks run status (queued → running → done/failed). Listener pattern (`onUpdate`) used by SSE event fan-out.

---

### 4.3 — ScalableQueue

| | |
|---|---|
| **File** | `platform/src/services/scalable-queue.ts` |
| **Purpose** | Production-grade persistent queue with priority, backpressure, retries |
| **Used by** | `queueRoutes` |
| **Depends on** | OpenCodeClient, TaskStateTracker, AuditLogger, BudgetManager |

**Key features**:
- SQLite persistence (survives restarts)
- Priority ordering (lower number = higher priority)
- Configurable concurrency (global + per-workspace)
- Dead-letter queue for permanently failed jobs
- Exponential backoff retries
- Backpressure (rejects when queue exceeds `maxQueueDepth=200`)
- Worker pool with start/stop lifecycle

**Integration**: ScalableQueue wraps TaskStateTracker for state transitions, AuditLogger for event recording, and BudgetManager for token accounting. Workers call OpenCodeClient to execute prompts.

---

### 4.4 — TaskStateTracker

| | |
|---|---|
| **File** | `platform/src/services/task-state-tracker.ts` |
| **Purpose** | Persistent state machine for all tasks (SQLite) |
| **Used by** | ScalableQueue, ParallelExecutionManager |
| **Depends on** | bun:sqlite |

**State transitions**: `queued → running → completed/failed/aborted/paused/retrying`

Enforces valid transitions (e.g., can't go from `completed` to `running`). Stores progress percentage, current step, result/error, retry count, metadata. Used by ScalableQueue workers and ParallelExecutionManager.

---

### 4.5 — SubagentOrchestrator

| | |
|---|---|
| **File** | `platform/src/services/subagent-orchestrator.ts` |
| **Purpose** | Multi-agent orchestration — spawn, route, and coordinate AI agent sessions |
| **Used by** | `orchestrationRoutes` |
| **Depends on** | OpenCodeClient, AuditLogger |

**How it works**:
1. Receives an orchestration plan with named tasks and dependency graph
2. Creates OpenCode sessions for each subtask (can use different agents: "code", "build", "plan")
3. Respects `dependsOn` — tasks wait until their dependencies complete
4. Collects results and feeds them back to dependent tasks
5. Handles failures / retries / cancellation per subtask

**Integration**: Orchestration state stored in memory (`Orchestration[]`). Each subtask creates an OpenCode session and sends a prompt. AuditLogger records spawn/complete/fail events.

---

### 4.6 — ParallelExecutionManager

| | |
|---|---|
| **File** | `platform/src/services/parallel-executor.ts` |
| **Purpose** | Run multiple prompts in true parallel (fan-out/fan-in) |
| **Used by** | `parallelRoutes` |
| **Depends on** | OpenCodeClient, TaskStateTracker, AuditLogger |

**Difference from SubagentOrchestrator**: ParallelExecution runs all tasks simultaneously (no dependency graph). Orchestrator runs tasks in dependency order.

---

### 4.7 — AuditLogger

| | |
|---|---|
| **File** | `platform/src/services/audit-logger.ts` |
| **Purpose** | Append-only structured event log in SQLite |
| **Used by** | ScalableQueue, SubagentOrchestrator, ParallelExecution, PolicyEngine, audit middleware |
| **Storage** | `.platform/audit.db` (WAL mode) |

**Events logged** (45+ action types):
- `session.create/delete/abort/fork/summarize`
- `prompt.send/stream/async`
- `task.enqueue/abort/complete/fail`
- `auth.success/failure`
- `budget.check/exceeded/update`
- `workspace.create/delete/switch`
- `subagent.spawn/complete/fail`
- `parallel.start/complete`
- `file.read/list`
- `provider.list`
- `system.startup/shutdown/error`
- `policy.evaluate`
- `api.request` (via middleware)

**Integration**: Wired into the Hono middleware chain (all `/api/*` requests are logged), and injected into ScalableQueue, SubagentOrchestrator, ParallelExecutionManager, and PolicyEngine.

---

### 4.8 — BudgetManager

| | |
|---|---|
| **File** | `platform/src/services/budget-manager.ts` |
| **Purpose** | Per-user token/request/cost limit enforcement |
| **Used by** | ScalableQueue, `budgetRoutes` |
| **Storage** | `.platform/budget.db` (WAL mode) |

**Capabilities**:
- Token limits (input + output combined)
- Request count limits
- Cost caps (for paid cloud providers, in cents)
- Time windows: per-hour, per-day, per-month, or total
- Hard limits (reject request) vs soft limits (warn + log)

**Integration with queue**: Before a worker picks up a task, ScalableQueue calls `budget.check(userID)`. If hard-limited, the task is rejected. After completion, token usage is recorded via `budget.record()`.

---

### 4.9 — WorkspaceManager

| | |
|---|---|
| **File** | `platform/src/services/workspace-manager.ts` |
| **Purpose** | Multi-project workspace isolation |
| **Used by** | `workspaceRoutes` |
| **Storage** | `.platform/workspaces.db` (WAL mode) |

**Features**:
- Register project directories as named workspaces
- Switch between active workspace (OpenCode uses this for file context)
- Tag-based filtering
- Metadata storage per workspace
- Directory validation (ensures path exists)

---

### 4.10 — SkillManager

| | |
|---|---|
| **File** | `platform/src/services/skill-manager.ts` |
| **Purpose** | Load and serve contextual knowledge files for RAG-lite context injection |
| **Used by** | `skillRoutes`, chat context building |
| **Data source** | `platform/skills/installed/*/SKILL.md` (YAML frontmatter + markdown) |

**How skills work**:
1. At startup, loads all `SKILL.md` files from `platform/skills/installed/`
2. Parses YAML frontmatter (name, description, icon, category, tags)
3. Indexes by keyword / tag for search
4. When a chat request mentions a relevant topic, matching skill content is injected as system context (RAG-lite approach)
5. Supports hot-reload when skill files change

**Currently 31 skills** across categories: Development, Testing, Azure, Architecture, Design, AI, Security.

---

### 4.11 — PolicyEngine

| | |
|---|---|
| **File** | `platform/src/services/policy-engine.ts` |
| **Purpose** | Unified security policy enforcement (10 policies) |
| **Used by** | `policyRoutes`, tool-executor, chat routes |
| **Depends on** | AuditLogger (for policy evaluation logging) |

**10 Enterprise Security Policies**:

| # | Policy | What It Does |
|---|--------|-------------|
| 1 | **Execution Sandbox** | Controls host vs. Docker-isolated execution mode |
| 2 | **Sensitive File Guard** | Detects .env, SSH keys, credentials (54 regex patterns) |
| 3 | **Risk Scoring Engine** | Dynamic 0-100 risk score per action |
| 4 | **Destructive Guard** | Pre-checks dangerous shell commands (rm -rf, format, etc.) |
| 5 | **Loop Detection** | Prevents agent infinite loops (repeated identical calls) |
| 6 | **Network Access Guard** | Controls external network access |
| 7 | **Skill Trust System** | Component-level trust management |
| 8 | **RBAC** | 4 roles × 7 permissions (admin, developer, viewer, agent) |
| 9 | **Audit Trail** | Tamper-evident event logging (delegates to AuditLogger) |
| 10 | **Agent Autonomy Modes** | Supervised / Semi-autonomous / Fully autonomous |

**Integration with tool-executor**: Before executing `bash` or `web_fetch` commands, the tool-executor calls `policyEngine.evaluate()` to check policies #2 (sensitive files), #4 (destructive commands), #6 (network access). The evaluation result is logged by AuditLogger.

---

### 4.12 — Provider Registry

| | |
|---|---|
| **File** | `platform/src/services/provider-registry.ts` |
| **Purpose** | Dynamic discovery and health monitoring of all model providers |
| **Used by** | `registryRoutes`, `chatRoutes` |
| **Depends on** | `env.VLLM_*`, `env.VLLM_EXTRA_ENDPOINTS`, cloud API key env vars |

**Provider types**:
- **Local**: vLLM and Ollama endpoints (probed via `/v1/models` HTTP)
- **Cloud**: 9 providers (OpenAI, Anthropic, Google AI, Mistral, Groq, DeepSeek, Together, Fireworks, OpenRouter)

**How it works**:
1. `buildRegistry()` is called on every `/api/registry` request
2. For local endpoints: sends HTTP GET to `/v1/models`, parses response
3. Detects Ollama vs vLLM from `owned_by` field in model data (Ollama returns `"ollama-gateway"`)
4. Falls back to static model list if endpoint is unreachable
5. For cloud providers: checks if API key env var is set → reports `configured: true/false`

**Static fallback**: When a local endpoint is unreachable, the registry uses `STATIC_VLLM_SERVERS` to still list the models (status: "offline").

---

### 4.13 — OpenCode Process Manager

| | |
|---|---|
| **File** | `platform/src/services/opencode-process.ts` |
| **Purpose** | Start/stop the OpenCode Go binary as a child process |
| **Used by** | `platform/scripts/start-all.ts` |
| **Depends on** | `env.OPENCODE_BIN`, `env.OPENCODE_DIR` |

**Integration**: The `start-all.ts` script first calls `opencode.start()` to launch the Go binary, waits for it to become healthy on `:4096`, then imports the Hono server. On SIGTERM/SIGINT, calls `opencode.stop()` followed by `shutdownPlatform()`.

---

## 5. Middleware Chain

Every request passes through this middleware stack (in order):

```
Request → loggerMiddleware → cors → rateLimitMiddleware → authMiddleware → auditMiddleware → Route Handler
```

| Order | Middleware | File | What It Does |
|-------|-----------|------|-------------|
| 1 | **Logger** | `platform/src/middleware/logger.ts` | Logs `METHOD /path STATUS Xms` for debug/error requests |
| 2 | **CORS** | Hono built-in (`hono/cors`) | `Access-Control-Allow-Origin: *` for cross-origin requests |
| 3 | **Rate Limit** | `platform/src/middleware/rate-limit.ts` | Sliding-window per IP: 120 req/min. Returns 429 + rate-limit headers. Periodic cleanup (5 min interval, max 10k tracked IPs) |
| 4 | **Auth** | `platform/src/middleware/auth.ts` | If `PLATFORM_API_KEY` set: requires `Authorization: Bearer <key>` or `x-api-key: <key>`. Unset = open mode (no auth). |
| 5 | **Audit** | inline in `index.ts` | Logs every `/api/*` request to AuditLogger with method, path, status, duration, success flag |

**Scope**: Middleware 1-2 apply to all routes (`*`). Middleware 3-5 apply to `/api/*` only. The root landing page (`/`) and `/health` bypass rate limiting and auth.

---

## 6. REST API Route Map

### 6.1 — All Endpoints

| Method | Path | Route Module | Purpose |
|--------|------|-------------|---------|
| GET | `/` | inline | HTML dashboard with live stats |
| GET | `/health` | `healthRoutes` | Platform + OpenCode health check |
| POST | `/api/sessions` | `sessionRoutes` | Create OpenCode session |
| GET | `/api/sessions` | `sessionRoutes` | List sessions |
| GET | `/api/sessions/:id` | `sessionRoutes` | Get session by ID |
| DELETE | `/api/sessions/:id` | `sessionRoutes` | Delete session |
| POST | `/api/sessions/:id/message` | `sessionRoutes` | Send prompt |
| POST | `/api/sessions/:id/message/stream` | `sessionRoutes` | Send prompt (SSE) |
| POST | `/api/sessions/:id/abort` | `sessionRoutes` | Abort running prompt |
| POST | `/api/tasks` | `taskRoutes` | Enqueue coding task |
| GET | `/api/tasks` | `taskRoutes` | List tasks |
| GET | `/api/tasks/:id` | `taskRoutes` | Get task by ID |
| GET | `/api/providers` | `providerRoutes` | List OpenCode providers |
| GET | `/api/files` | `fileRoutes` | List project files |
| GET | `/api/events` | `eventRoutes` | SSE real-time events |
| GET | `/api/audit` | `auditRoutes` | Query audit logs |
| GET | `/api/audit/stats` | `auditRoutes` | Audit statistics |
| GET | `/api/budget/check` | `budgetRoutes` | Check user budget |
| GET | `/api/budget/summary` | `budgetRoutes` | Usage summary by window |
| PUT | `/api/budget/limits` | `budgetRoutes` | Set budget limits |
| POST | `/api/budget/record` | `budgetRoutes` | Record token usage |
| GET | `/api/workspaces` | `workspaceRoutes` | List workspaces |
| GET | `/api/workspaces/active` | `workspaceRoutes` | Get active workspace |
| GET | `/api/workspaces/:id` | `workspaceRoutes` | Get workspace by ID |
| POST | `/api/workspaces` | `workspaceRoutes` | Create workspace |
| PUT | `/api/workspaces/:id` | `workspaceRoutes` | Update workspace |
| POST | `/api/workspaces/:id/activate` | `workspaceRoutes` | Set as active |
| DELETE | `/api/workspaces/:id` | `workspaceRoutes` | Delete workspace |
| POST | `/api/orchestrations` | `orchestrationRoutes` | Start orchestration |
| GET | `/api/orchestrations` | `orchestrationRoutes` | List orchestrations |
| GET | `/api/orchestrations/:id` | `orchestrationRoutes` | Get orchestration |
| POST | `/api/orchestrations/:id/cancel` | `orchestrationRoutes` | Cancel orchestration |
| POST | `/api/queue` | `queueRoutes` | Enqueue job (scalable queue) |
| GET | `/api/queue/metrics` | `queueRoutes` | Queue metrics |
| POST | `/api/queue/start` | `queueRoutes` | Start queue processing |
| POST | `/api/queue/stop` | `queueRoutes` | Stop queue processing |
| POST | `/api/parallel` | `parallelRoutes` | Start parallel execution |
| GET | `/api/parallel` | `parallelRoutes` | List parallel executions |
| GET | `/api/parallel/:id` | `parallelRoutes` | Get parallel execution |
| GET | `/api/registry` | `registryRoutes` | List all model providers |
| POST | `/api/chat` | `chatRoutes` | **Agentic chat with tools** |
| POST | `/api/chat/direct` | `chatRoutes` | Direct chat (no tools) |
| POST | `/api/chat/stream` | `chatRoutes` | Streaming chat (SSE) |
| GET | `/api/skills` | `skillRoutes` | List/search skills |
| GET | `/api/skills/:id` | `skillRoutes` | Get skill by ID |
| GET | `/api/policies` | `policyRoutes` | List active policies |
| POST | `/api/policies/evaluate` | `policyRoutes` | Evaluate action against policies |
| GET | `/api/client` | inline | Download CLI binary (`art`) |
| GET | `/api/install` | inline | Download install script |
| GET | `/api/project` | inline | Current project info (pass-through to OpenCode) |
| GET | `/api/projects` | inline | All projects (pass-through) |
| GET/PATCH | `/api/config` | inline | Platform config (pass-through) |
| GET | `/api/vcs` | inline | VCS status (pass-through) |
| GET | `/api/paths` | inline | File paths (pass-through) |

### 6.2 — Route Registration (code)

Routes are mounted in `platform/src/server/index.ts`:

```typescript
app.route("/health",             healthRoutes(client))
app.route("/api/sessions",       sessionRoutes(client))
app.route("/api/tasks",          taskRoutes(queue))
app.route("/api/providers",      providerRoutes(client))
app.route("/api/files",          fileRoutes(client))
app.route("/api/events",         eventRoutes(client, queue))
app.route("/api/audit",          auditRoutes(audit))
app.route("/api/budget",         budgetRoutes(budget))
app.route("/api/workspaces",     workspaceRoutes(workspaces))
app.route("/api/orchestrations", orchestrationRoutes(orchestrator))
app.route("/api/queue",          queueRoutes(scalableQueue))
app.route("/api/parallel",       parallelRoutes(parallelExecutor))
app.route("/api/registry",       registryRoutes())
app.route("/api/chat",           chatRoutes())
app.route("/api/skills",         skillRoutes(skills))
app.route("/api/policies",       policyRoutes(policyEngine))
```

Note: Each route factory receives only the services it needs (dependency injection pattern).

---

## 7. AI Engine Integration (OpenCode)

### 7.1 — What is OpenCode?

OpenCode is an open-source Go binary that provides AI-powered coding sessions. Thirdwave uses it as the **session and agent management engine**.

### 7.2 — Communication Protocol

```
Platform ←→ OpenCode
   │
   │  HTTP REST (no WebSocket)
   │  Base URL: http://127.0.0.1:4096
   │  Headers:
   │    Content-Type: application/json
   │    x-opencode-directory: /path/to/project
   │    Authorization: Basic base64(user:pass)   [if configured]
   │
   │  Key endpoints:
   │    POST /session              → create session
   │    POST /session/:id/message  → send prompt
   │    GET  /session              → list sessions
   │    DELETE /session/:id        → delete session
   │    GET  /health               → liveness check
   │    GET  /project              → current project info
   │    GET  /file                 → file listing
   │    GET  /vcs                  → git status
```

### 7.3 — Message Format

```typescript
// Sending
{ parts: [{ type: "text", text: "fix this bug" }], agent?: "build" }

// Response parts (MessageV2):
// text, reasoning, tool, step-start, step-finish, snapshot, patch,
// file, agent, retry, compaction, subtask
```

### 7.4 — Process Lifecycle

```
start-all.ts
  │
  ├── opencode.start({ directory })
  │     spawns: opencode server --port 4096 --dir /path
  │     waits for health check response
  │
  ├── import("../src/server/index")
  │     starts Hono server on :3100
  │
  └── on SIGTERM:
        shutdownPlatform() → server.stop() + scalableQueue.stop() + audit.dispose()
        opencode.stop()     → kills child process
```

---

## 8. Model Provider Integration

### 8.1 — Provider Registry Architecture

The provider registry (`platform/src/services/provider-registry.ts`) dynamically discovers and reports all available model providers.

**Local provider flow**:
```
buildRegistry()
  │
  ├── Primary vLLM: env.VLLM_BASE_URL
  │     GET http://172.30.140.91:8000/v1/models
  │     ├── Success → extract model list from response
  │     │              detect Ollama vs vLLM from owned_by field
  │     └── Failure → use static fallback model list
  │
  ├── Extra endpoints: env.VLLM_EXTRA_ENDPOINTS (comma-separated)
  │     For each URL: GET {url}/v1/models
  │     Same detection logic
  │
  └── Assemble: { local: [...], cloud: [...] }
```

**Cloud provider catalog**:
```
CLOUD_CATALOG = [
  { id: "openai",     keyEnvVar: "OPENAI_API_KEY",     models: [...] },
  { id: "anthropic",  keyEnvVar: "ANTHROPIC_API_KEY",  models: [...] },
  { id: "google",     keyEnvVar: "GOOGLE_AI_API_KEY",  models: [...] },
  { id: "mistral",    keyEnvVar: "MISTRAL_API_KEY",    models: [...] },
  { id: "groq",       keyEnvVar: "GROQ_API_KEY",       models: [...] },
  { id: "deepseek",   keyEnvVar: "DEEPSEEK_API_KEY",   models: [...] },
  { id: "together",   keyEnvVar: "TOGETHER_API_KEY",   models: [...] },
  { id: "fireworks",  keyEnvVar: "FIREWORKS_API_KEY",   models: [...] },
  { id: "openrouter", keyEnvVar: "OPENROUTER_API_KEY", models: [...] },
]
```

### 8.2 — Ollama Detection

The registry detects Ollama (vs vLLM) by inspecting the `owned_by` field in the `/v1/models` response:

```
If any model has owned_by containing "ollama" → label as "Local Ollama"
Otherwise → label as "Local vLLM"
```

### 8.3 — Chat Route Model Selection

When `POST /api/chat` is called, the chat route resolves the model:

```
1. If providerID + modelID specified → use exactly that
2. If only modelID → scan all providers for a match
3. If neither → use default vLLM (env.VLLM_BASE_URL + env.VLLM_MODEL_ID)
```

The chat route calls the selected provider using the **OpenAI-compatible** `/v1/chat/completions` API — this works for vLLM, Ollama, OpenRouter, and all cloud providers.

---

## 9. Tool Execution Integration

### 9.1 — Available Tools

The chat route uses a tool-calling loop. When the LLM returns `tool_calls`, the platform executes them server-side:

| Tool | File | Description | Policy Gates |
|------|------|-------------|-------------|
| `bash` | `tool-executor.ts` | Run shell commands | Destructive Guard (#4), Policy Engine |
| `read_file` | `tool-executor.ts` | Read file contents (path + optional line range) | Sensitive File Guard (#2) |
| `write_file` | `tool-executor.ts` | Write/create files | Sensitive File Guard (#2) |
| `list_dir` | `tool-executor.ts` | List directory contents | — |
| `grep_search` | `tool-executor.ts` | Search files via regex | — |
| `web_fetch` | `tool-executor.ts` | Fetch a URL | Network Access Guard (#6), Policy Engine |

### 9.2 — Tool-Calling Loop

```
Round 1: LLM generates tool_calls: [{ name: "read_file", args: {path: "src/main.ts"} }]
         Platform executes → result: "file contents..."
         Platform appends tool result to conversation
         
Round 2: LLM sees file content, generates: [{ name: "write_file", args: {path, content} }]
         Platform executes → result: "written 2.3KB"
         Platform appends tool result
         
Round 3: LLM generates: [{ name: "bash", args: {command: "bun test"} }]
         Platform executes → result: "3 passed, 0 failed"
         Platform appends tool result
         
Round 4: LLM generates final text response (no more tool calls)
         → Response returned to client with all toolCalls logged
```

**Max rounds**: 15 (configurable via `maxToolRounds` parameter, capped at 20).

### 9.3 — File Path Resolution

`write_file` and `read_file` resolve paths relative to `PROJECT_DIR` (the working directory). Use `resolvePath(args.path)` which:
1. Resolves relative paths against project root
2. Prevents path traversal (no `../../../etc/passwd`)
3. Creates parent directories automatically for `write_file`

### 9.4 — Server-Side vs Client-Side File Saving

**Server-side**: `write_file` tool creates files on the server (needed for the agentic loop — AI may read a file back, modify it, run tests on it).

**Client-side**: The CLI (`art`) parses the `toolCalls` array from the response, extracts `write_file` calls, and saves files locally on the user's machine using basename extraction. Code blocks in the response text are also saved as fallback.

---

## 10. CLI Client Integration

### 10.1 — Architecture

```
User's Machine                                          Server
┌─────────────────┐                          ┌──────────────────────┐
│  art (bash CLI)  │ ── POST /api/chat ──►  │  Platform (:3100)    │
│                  │                          │  ↓                   │
│  python3 inline  │ ◄── JSON response ──── │  chat route          │
│  (json parser)   │                          │  ↓                   │
│                  │                          │  tool loop           │
│  saves files     │                          │  ↓                   │
│  locally         │                          │  LLM inference       │
└─────────────────┘                          └──────────────────────┘
```

### 10.2 — Distribution

The CLI is distributed via a one-liner install:

```bash
curl -fsSL http://SERVER/api/install | bash
```

This downloads `platform/bin/install.sh` which:
1. Downloads CLI from `/api/client` → saves as `~/.local/bin/art`
2. Makes it executable
3. Adds `~/.local/bin` to `PATH` in `.bashrc`
4. The server URL is patched dynamically based on `Host` header at download time

### 10.3 — Server URL Patching

When `/api/client` is requested, the server reads `platform/bin/thirdwave-client`, replaces the default `THIRDWAVE_SERVER` value with the actual server URL derived from the request's `Host` header and `X-Forwarded-Proto`:

```typescript
const patched = script.replace(
  /THIRDWAVE_SERVER="\$\{THIRDWAVE_SERVER:-[^"]*\}"/,
  `THIRDWAVE_SERVER="\${THIRDWAVE_SERVER:-${proto}://${host}}"`,
)
```

### 10.4 — CLI Commands

| Command | API Call | Description |
|---------|----------|-------------|
| `art chat "message"` | POST `/api/chat` | Agentic chat with tools |
| `art ask "question"` | POST `/api/chat/direct` | Quick question (no tools) |
| `art models` | GET `/api/registry` | List all available models |
| `art health` | GET `/health` | Check server health |
| `art sessions` | GET `/api/sessions` | List sessions |
| `art tasks` | GET `/api/tasks` | List tasks |

### 10.5 — File Extraction on Client

The CLI extracts files from two sources:

**Source 1 — toolCalls** (primary):
```python
# Parses response JSON, finds write_file tool calls
for call in toolCalls:
    if call["tool"] == "write_file" and call["success"]:
        filename = os.path.basename(call["args"]["path"])
        with open(os.path.join(save_dir, filename), "w") as f:
            f.write(call["args"]["content"])
```

**Source 2 — Code blocks** (fallback):
```python
# Regex extracts ```language\ncode``` blocks from response text
# Saves to art_output/ with deduplication against tool-saved files
```

---

## 11. Deployment Integration (systemd + nginx)

### 11.1 — Startup Chain

```
systemctl start thirdwave
  │
  └── thirdwave.service
        ExecStart: /home/nvidia/.bun/bin/bun run platform/scripts/start-all.ts
        │
        ├── 1. Start OpenCode binary on :4096
        │     /home/nvidia/.opencode/bin/opencode server
        │
        └── 2. Start Platform server on :3100
              import("../src/server/index")
              Bun.serve({ port: 3100, hostname: "0.0.0.0" })
```

### 11.2 — systemd Service Details

| Setting | Value | Purpose |
|---------|-------|---------|
| `User` | `nvidia` | Runs as non-root |
| `EnvironmentFile` | `platform/.env` | Loads vLLM URLs, API keys |
| `ReadWritePaths` | `.platform/` | SQLite DBs need write access |
| `ProtectSystem` | `strict` | Read-only filesystem except allowed paths |
| `PrivateTmp` | `yes` | Isolated /tmp namespace |
| `MemoryMax` | `4G` | Hard memory ceiling |
| `LimitNOFILE` | `65536` | High file descriptor limit for concurrent connections |
| `Restart` | `on-failure` | Auto-restart with 5s delay, max 3 bursts per 60s |

### 11.3 — nginx Configuration

| Location | Rate Limit | Timeout | Notes |
|----------|-----------|---------|-------|
| `/health` | None | 10s | Health probes bypass rate limiting |
| `/api/chat` | 5r/s burst 10 | 300s read | Long tool-calling loops |
| `/api/events` | None | 600s | SSE keep-alive |
| `/api/*` | 30r/s burst 50 | 60s | General API |
| All | — | — | Security headers: X-Frame-Options, X-Content-Type-Options, X-XSS-Protection |

### 11.4 — deploy.sh Commands

```bash
sudo bash platform/deploy/deploy.sh              # Full setup
sudo bash platform/deploy/deploy.sh --nginx      # nginx only
sudo bash platform/deploy/deploy.sh --systemd    # systemd only
sudo bash platform/deploy/deploy.sh --status     # Check status
sudo bash platform/deploy/deploy.sh --stop       # Stop everything
sudo bash platform/deploy/deploy.sh --uninstall  # Remove deployment
```

---

## 12. Database / Persistence Layer

All databases use **SQLite with WAL mode** via `bun:sqlite`. Stored in `.platform/` at the project root.

| Database | Service | Tables | Purpose |
|----------|---------|--------|---------|
| `audit.db` | AuditLogger | `audit_events` | All platform events (append-only) |
| `budget.db` | BudgetManager | `budget_limits`, `budget_usage` | Token/request/cost tracking per user |
| `workspaces.db` | WorkspaceManager | `workspaces` | Project workspace registry |
| `tasks.db` | TaskStateTracker | `tracked_tasks` | Task state machine (queued→running→done) |

**Design decisions**:
- WAL mode for concurrent read/write
- ULID primary keys (time-sortable, unique)
- `PRAGMA synchronous = NORMAL` (performance vs. durability trade-off)
- Data directory created on startup: `mkdirSync(dataDir, { recursive: true })`
- systemd `ReadWritePaths` grants write access to this directory specifically

---

## 13. Security & Policy Integration

### 13.1 — Security Layers

```
Request arrives
  │
  ├── nginx: rate limiting (30r/s API, 5r/s chat)
  │          connection limiting (20 conn/IP)
  │          security headers (XSS, clickjack protection)
  │
  ├── Platform middleware:
  │     ├── rateLimitMiddleware (120 req/min per IP, sliding window)
  │     ├── authMiddleware (API key check if PLATFORM_API_KEY set)
  │     └── auditMiddleware (log all API calls)
  │
  ├── Tool execution:
  │     ├── PolicyEngine.evaluate() before bash/web_fetch
  │     ├── Sensitive File Guard (54 patterns)
  │     ├── Destructive Guard (rm -rf, format, etc.)
  │     └── Network Access Guard (external URL control)
  │
  └── systemd:
        ├── ProtectSystem=strict (read-only filesystem)
        ├── NoNewPrivileges=yes
        ├── PrivateTmp=yes
        └── MemoryMax=4G
```

### 13.2 — Authentication

- **Open mode**: When `PLATFORM_API_KEY` is not set, all requests are allowed (development)
- **Key mode**: Set `PLATFORM_API_KEY` env var. Clients must send:
  - `Authorization: Bearer <key>` OR
  - `x-api-key: <key>`

### 13.3 — RBAC Roles

| Role | Permissions |
|------|------------|
| `admin` | All: read, write, execute, configure, deploy, audit, manage |
| `developer` | read, write, execute |
| `viewer` | read only |
| `agent` | read, write, execute (programmatic — for AI agents) |

---

## 14. Skills / Knowledge System

### 14.1 — Skill File Format

Each skill is a markdown file in `platform/skills/installed/<skill-name>/SKILL.md`:

```markdown
---
name: systematic-debugging
description: Systematic debugging methodology and techniques
icon: 🔍
category: Development
tags: [debugging, troubleshooting, errors, logs]
---

# Systematic Debugging

## Step 1: Reproduce the Issue
...
```

### 14.2 — Skill Discovery Flow

```
API: GET /api/skills?q=debugging
  │
  SkillManager.search("debugging")
  │
  Scores each skill by: tag match (0.8), name match (0.6),
  description match (0.4), content match (0.2)
  │
  Returns: [{ skill: {...}, relevance: 0.8, matchedOn: "tag" }]
```

### 14.3 — Skill Categories

| Category | Skills | Examples |
|----------|--------|---------|
| Development | 8 | systematic-debugging, test-driven-development, python-performance |
| Architecture | 3 | architecture-patterns, api-design-principles, nodejs-backend |
| Frontend | 5 | frontend-design, react-native, vercel-patterns, UI/UX |
| Azure | 5 | azure-ai, azure-deploy, azure-diagnostics, azure-storage |
| Testing | 3 | webapp-testing, verification, test-driven-development |
| Security | 2 | code-review (requesting + receiving) |
| Documents | 4 | pdf, docx, pptx, xlsx generation |
| Other | 1 | find-skills (meta-skill) |

---

## 15. SDK Client Library

### 15.1 — Usage

```typescript
import { PlatformClient } from "platform/src/sdk/client"

const client = new PlatformClient({
  baseUrl: "http://localhost:3100",
  apiKey: "your-key",    // optional
})

// Sessions
const session = await client.createSession({ title: "Bug fix" })
const response = await client.sendPrompt(session.id, {
  content: "fix the auth bug",
})

// Tasks
const task = await client.enqueueTask({
  prompt: "refactor the login module",
  directory: "/path/to/project",
})
const status = await client.getTask(task.id)

// Registry
const providers = await client.listProviders()

// Health
const health = await client.health()
```

### 15.2 — SDK Methods

| Category | Methods |
|----------|---------|
| Sessions | `createSession()`, `getSession()`, `listSessions()`, `deleteSession()`, `sendPrompt()`, `streamPrompt()`, `abortMessage()` |
| Tasks | `enqueueTask()`, `getTask()`, `listTasks()` |
| Providers | `listProviders()` |
| Files | `listFiles()` |
| Health | `health()` |
| Events | `subscribeEvents()` |

---

## 16. Multi-User / Port Offset

### 16.1 — How It Works

Set `THIRDWAVE_PORT_OFFSET=N` to shift both Platform and OpenCode ports:

```
THIRDWAVE_PORT_OFFSET=0  → Platform :3100, OpenCode :4096  (default)
THIRDWAVE_PORT_OFFSET=10 → Platform :3110, OpenCode :4106
THIRDWAVE_PORT_OFFSET=20 → Platform :3120, OpenCode :4116
```

### 16.2 — Auto-Port

When `AUTO_PORT=true` (default), if the configured PORT is busy, the platform probes up to 20 consecutive ports to find a free one. This prevents startup failures when another instance is already running.

### 16.3 — Multiple Developers on Same Host

```bash
# Developer A (default)
PORT=3100 bun run platform/scripts/start-all.ts

# Developer B
THIRDWAVE_PORT_OFFSET=10 bun run platform/scripts/start-all.ts
# → Platform :3110, OpenCode :4106

# Developer C
THIRDWAVE_PORT_OFFSET=20 bun run platform/scripts/start-all.ts
# → Platform :3120, OpenCode :4116
```

---

## 17. Environment Configuration Reference

All configuration is in `platform/.env` and processed by `platform/src/config/env.ts` with Zod validation.

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `PORT` | `3100` | No | Platform server port |
| `HOST` | `0.0.0.0` | No | Bind address |
| `THIRDWAVE_PORT_OFFSET` | `0` | No | Multi-user port shift |
| `AUTO_PORT` | `true` | No | Auto-find free port |
| `OPENCODE_URL` | `http://127.0.0.1:4096` | No | OpenCode engine URL |
| `OPENCODE_BIN` | `opencode` | No | Path to OpenCode binary |
| `OPENCODE_DIR` | `cwd()` | No | Project directory for OpenCode |
| `OPENCODE_SERVER_USERNAME` | — | No | Basic auth username |
| `OPENCODE_SERVER_PASSWORD` | — | No | Basic auth password |
| `VLLM_BASE_URL` | `http://172.30.140.91:8000/v1` | No | Primary vLLM OpenAI-compat endpoint |
| `VLLM_API_KEY` | `vllm-...` | No | vLLM API key |
| `VLLM_MODEL_ID` | `plezan/MiniMax-M2.1-REAP-50-W4A16` | No | Default model |
| `VLLM_MODEL_NAME` | `MiniMax M2.1 REAP 50 W4A16` | No | Display name |
| `VLLM_CONTEXT_LIMIT` | `30000` | No | Max context tokens |
| `VLLM_OUTPUT_LIMIT` | `4096` | No | Max output tokens |
| `VLLM_EXTRA_ENDPOINTS` | — | No | Comma-separated extra endpoints |
| `OPENAI_API_KEY` | — | No | OpenAI cloud provider |
| `ANTHROPIC_API_KEY` | — | No | Anthropic cloud provider |
| `GOOGLE_AI_API_KEY` | — | No | Google AI cloud provider |
| `MISTRAL_API_KEY` | — | No | Mistral cloud provider |
| `GROQ_API_KEY` | — | No | Groq cloud provider |
| `DEEPSEEK_API_KEY` | — | No | DeepSeek cloud provider |
| `TOGETHER_API_KEY` | — | No | Together AI cloud provider |
| `FIREWORKS_API_KEY` | — | No | Fireworks AI cloud provider |
| `OPENROUTER_API_KEY` | — | No | OpenRouter cloud provider |
| `PLATFORM_API_KEY` | — | No | Enable API key auth (open mode if unset) |
| `PLATFORM_JWT_SECRET` | — | No | JWT signing secret (future use) |
| `LOG_LEVEL` | `info` | No | `debug`, `info`, `warn`, `error` |
| `NODE_ENV` | `development` | No | `development`, `production`, `test` |

---

## 18. Integration Dependency Graph

```
                    ┌─────────────────────────────────┐
                    │            index.ts              │
                    │   (wires everything together)    │
                    └──────┬──────────────────────────┘
                           │
         ┌─────────────┬───┼───┬─────────────────┬──────────────┐
         ▼             ▼   ▼   ▼                 ▼              ▼
   ┌──────────┐  ┌─────┐ ┌─────┐         ┌──────────┐  ┌──────────────┐
   │OpenCode  │  │Audit│ │Budg.│         │ Policy   │  │   Skill      │
   │Client    │  │Loggr│ │Mgr  │         │ Engine   │  │   Manager    │
   └────┬─────┘  └──┬──┘ └──┬──┘         └────┬─────┘  └──────────────┘
        │            │       │                 │
        ▼            │       │                 │
   ┌──────────┐      │       │                 │
   │TaskQueue │      │       │                 │
   │(simple)  │      │       │                 │
   └──────────┘      │       │                 │
        │            │       │                 │
        ▼            ▼       ▼                 ▼
   ┌─────────────────────────────────────────────────┐
   │                ScalableQueue                     │
   │  uses: OpenCodeClient, TaskStateTracker,         │
   │        AuditLogger, BudgetManager                │
   └──────────────────────────────┬──────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────┐
   │             TaskStateTracker                     │
   │  persists state machine to SQLite (tasks.db)    │
   └─────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────┐
   │          SubagentOrchestrator                    │
   │  uses: OpenCodeClient, AuditLogger              │
   └─────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────┐
   │        ParallelExecutionManager                  │
   │  uses: OpenCodeClient, TaskStateTracker, Audit   │
   └─────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────┐
   │            WorkspaceManager                      │
   │  standalone — persists to workspaces.db          │
   └─────────────────────────────────────────────────┘

   ┌─────────────────────────────────────────────────┐
   │          Provider Registry + Chat Routes         │
   │  uses: env vars, HTTP calls to vLLM/Ollama/cloud│
   │         PolicyEngine (for tool execution)        │
   │         tool-executor (for bash, files, etc.)    │
   └─────────────────────────────────────────────────┘
```

---

## Quick Reference: Who Calls What

| Caller | Calls | Via |
|--------|-------|-----|
| CLI `art` | Platform | HTTP REST (port 80 → nginx → port 3100) |
| Platform routes | OpenCodeClient | HTTP REST (port 4096) |
| Platform chat route | vLLM/Ollama/Cloud | HTTP REST (OpenAI-compat `/v1/chat/completions`) |
| Platform chat route | tool-executor | Direct function call |
| tool-executor | PolicyEngine | Direct function call |
| ScalableQueue | OpenCodeClient + TaskStateTracker + AuditLogger + BudgetManager | Direct function calls |
| SubagentOrchestrator | OpenCodeClient + AuditLogger | Direct function calls |
| start-all.ts | OpenCode process + Platform server | Child process spawn + module import |
| systemd | start-all.ts | ExecStart |
| nginx | Platform | HTTP reverse proxy |
| deploy.sh | systemd + nginx | `systemctl` + `cp` config files |

---

*End of Integration Documentation*
