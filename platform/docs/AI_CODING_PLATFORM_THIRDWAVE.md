# AI CODING PLATFORM – THIRDWAVE

---

## 1. INTRODUCTION

Thirdwave is a **self-hosted AI coding platform** built on top of [OpenCode](https://github.com/sst/opencode), designed to provide autonomous code generation, debugging, and project management capabilities using locally hosted Large Language Models (LLMs). The platform eliminates dependency on cloud AI services by running inference on dedicated GPU servers using **vLLM** and **Ollama**, while still offering optional cloud provider fallback for teams that need it.

### Purpose

The platform serves as an internal AI pair-programmer for development teams — a production-grade system that can:

- **Generate, edit, and refactor code** across multiple languages
- **Execute shell commands** and manage project files
- **Reason through multi-step tasks** using an agentic tool-calling loop
- **Split complex work into parallel subtasks** using subagent orchestration
- **Enforce coding policies** and security guardrails automatically
- **Track usage, budgets, and audit logs** for team governance

### Design Philosophy

| Principle | Implementation |
|-----------|---------------|
| **Self-hosted first** | All inference runs on local GPU servers — zero data leaves the network |
| **Provider-agnostic** | 3 local vLLM/Ollama servers + 9 cloud providers through a unified registry |
| **Production-ready** | systemd service, nginx proxy, SQLite persistence, rate limiting, audit logs |
| **Developer-friendly** | TUI-based CLI client (`art`), REST API, TypeScript SDK, web dashboard |
| **Security by default** | 10 policy rules, path traversal protection, destructive command guards, RBAC |

### Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Bun | 1.3+ |
| Web Framework | Hono | 4.10.7 |
| AI Engine | OpenCode | 1.2.17 |
| Inference | vLLM + Ollama | Latest |
| Database | SQLite (bun:sqlite) | WAL mode |
| Process Manager | systemd | Linux |
| Reverse Proxy | nginx | 1.24.0 |
| Language | TypeScript | 5.x |

---

## 2. TASKS

### Task 1: Subagent Implementation — Parallelism

The platform implements a **multi-level task execution system** that enables complex work to be split into independent subtasks and executed concurrently.

#### Architecture

```
User Request
    │
    ▼
┌─────────────────────────────┐
│  SubagentOrchestrator       │  ← Decomposes complex tasks
│  - createOrchestration()    │
│  - addSubtask()             │
│  - fan-out / fan-in         │
└──────────────┬──────────────┘
               │
     ┌─────────┼─────────┐
     ▼         ▼         ▼
┌─────────┐┌─────────┐┌─────────┐
│ Agent 1 ││ Agent 2 ││ Agent 3 │   ← Parallel execution
│ (file)  ││ (test)  ││ (doc)   │
└─────────┘└─────────┘└─────────┘
     │         │         │
     └─────────┼─────────┘
               ▼
       ┌──────────────┐
       │  Aggregator   │  ← Merges results
       └──────────────┘
```

#### Components

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| **SubagentOrchestrator** | `src/services/subagent-orchestrator.ts` | 279 | Creates orchestration plans, manages fan-out/fan-in of subtasks |
| **ParallelExecutionManager** | `src/services/parallel-executor.ts` | 408 | Concurrent task execution with dependency tracking |
| **ScalableQueue** | `src/services/scalable-queue.ts` | 313 | Priority-based task queue with configurable concurrency (default: 4) |
| **TaskStateTracker** | `src/services/task-state-tracker.ts` | 319 | Persistent task state in SQLite (pending → running → completed/failed) |

#### Key Features

- **Concurrency control**: Configurable worker pool (default 4, max 200 queue depth)
- **Fan-out / fan-in**: Orchestrator decomposes tasks, parallel executor runs them, results are aggregated
- **State persistence**: All task states stored in SQLite with WAL mode for crash recovery
- **Budget integration**: Each subtask's token usage is tracked against team budgets
- **Audit trail**: Every orchestration and subtask is logged to the audit database

#### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/orchestrations` | Create a new orchestration with subtasks |
| `GET` | `/api/orchestrations` | List all orchestrations |
| `GET` | `/api/orchestrations/:id` | Get orchestration details + subtask results |
| `POST` | `/api/parallel` | Execute tasks in parallel |
| `GET` | `/api/parallel` | List parallel execution groups |
| `GET` | `/api/queue/metrics` | Queue depth, active workers, throughput |

---

### Task 2: UI — TUI (Terminal User Interface)

The user-facing interface is a **terminal-based CLI client** called `art` (~530 lines of Bash + Python), designed for developers who prefer the command line.

#### Installation

```bash
# One-line install from the server
curl -fsSL http://SERVER/api/install | bash

# Or download manually
curl -o ~/bin/art http://SERVER/api/client && chmod +x ~/bin/art
```

#### TUI Commands

| Command | Description |
|---------|-------------|
| `art "fix the login bug"` | Send a coding prompt (agentic mode with tools) |
| `art direct "explain this code"` | Direct LLM response (no tools, fast path) |
| `art models` | List all available models |
| `art use <model_id>` | Switch active model |
| `art registry` | Show provider registry (local + cloud status) |
| `art sessions` | List chat sessions |
| `art health` | Check platform health |
| `art status` | Full platform dashboard |
| `art audit` | View recent audit logs |
| `art budget` | Check budget usage |
| `art skills` | List available coding skills |
| `art policies` | Show active security policies |

#### Agentic Behavior

When the user sends a prompt via `art`, the CLI:

1. Sends the message to `POST /api/chat` with `tools: true`
2. The backend enters an **agentic loop** (up to 15 rounds):
   - Model receives the prompt + tool definitions
   - Model decides which tools to call (bash, read_file, write_file, etc.)
   - Tools are executed server-side, results fed back to model
   - Model iterates until the task is complete
3. The CLI **extracts `write_file` tool calls** and saves files to the user's local machine
4. Tool call summaries are displayed (which files were read/written, commands executed)

#### Key Design Decisions

- **Files save locally**: The agentic loop runs server-side, but `write_file` outputs are intercepted by the CLI and written to the user's filesystem — not the server's
- **Streaming support**: `art stream "..."` uses SSE streaming for real-time output
- **Session awareness**: Conversations are session-based; context is maintained across prompts
- **Color-coded output**: ANSI colors for tool calls (green=success, red=error, yellow=warning)

---

### Task 3: Self-Host Server (Hono Backend, Audit/Log)

The Thirdwave platform is a **production-grade self-hosted server** with full operational infrastructure.

#### Server Architecture

```
Internet
    │
    ▼
┌──────────┐     ┌──────────────────────────────────────┐
│  nginx   │────▶│  Hono Server (:3100)                 │
│  (:80)   │     │                                       │
└──────────┘     │  ┌──────────┐  ┌────────────────┐    │
                 │  │ Auth MW  │  │ Rate Limiter   │    │
                 │  └────┬─────┘  └──────┬─────────┘    │
                 │       ▼               ▼               │
                 │  ┌──────────────────────────────┐    │
                 │  │        Route Layer            │    │
                 │  │  /health  /chat  /registry    │    │
                 │  │  /sessions /audit /budget     │    │
                 │  │  /queue  /parallel /workspaces│    │
                 │  │  /skills /policies /events    │    │
                 │  └──────────────┬───────────────┘    │
                 │                 ▼                      │
                 │  ┌──────────────────────────────┐    │
                 │  │       Service Layer           │    │
                 │  │  OpenCodeClient  ToolExecutor │    │
                 │  │  ProviderRegistry  PolicyEng  │    │
                 │  │  AuditLogger  BudgetManager   │    │
                 │  │  SkillManager  WorkspaceMgr   │    │
                 │  └──────────────┬───────────────┘    │
                 │                 ▼                      │
                 │  ┌──────────────────────────────┐    │
                 │  │     Persistence (SQLite)      │    │
                 │  │  audit.db  budget.db          │    │
                 │  │  tasks.db  workspaces.db      │    │
                 │  └──────────────────────────────┘    │
                 └───────────────────────────────────────┘
                          │              │
               ┌──────────┘              └──────────┐
               ▼                                     ▼
     ┌──────────────┐                    ┌────────────────┐
     │  OpenCode    │                    │  vLLM / Ollama │
     │  Engine      │                    │  GPU Servers   │
     │  (:4096)     │                    │  (:8000,:31254)│
     └──────────────┘                    └────────────────┘
```

#### Middleware Stack

| Layer | File | Purpose |
|-------|------|---------|
| **Logger** | `src/middleware/logger.ts` | Request/response logging with timing |
| **CORS** | Built-in (Hono) | Allow cross-origin requests from any origin |
| **Rate Limiter** | `src/middleware/rate-limit.ts` | 120 req/min per IP, sliding window, DDoS cap at 10K IPs |
| **Auth** | `src/middleware/auth.ts` | API key / token validation |
| **Audit** | Inline middleware | Wraps all `/api/*` routes with timing + success/failure logging |

#### Audit System

The audit system provides a complete record of all platform activity:

- **Database**: SQLite with WAL mode (`audit.db`)
- **Actions logged**: API requests, chat prompts, tool executions, policy decisions, budget checks
- **Fields**: timestamp, action, userID, success/failure, metadata (method, path, status, duration)
- **Periodic flush**: Batched writes every 5 seconds for performance
- **Endpoints**: `GET /api/audit` (recent entries), `GET /api/audit/stats` (aggregated statistics)

#### Budget Management

- **Token tracking**: Input/output tokens per request
- **Budget limits**: Configurable daily/monthly token caps per user
- **Budget checks**: Pre-flight check before every chat request
- **Usage summaries**: `GET /api/budget/summary`, `GET /api/budget/check`

#### Deployment

```bash
# systemd service
sudo systemctl enable thirdwave
sudo systemctl start thirdwave
sudo systemctl status thirdwave

# Service file: platform/deploy/systemd/thirdwave.service
# - Runs as user 'nvidia'
# - Auto-restart on failure (5s delay)
# - Memory cap: 4GB
# - AUTO_PORT=false (prevents silent port shifting)
# - Loads .env from project root

# nginx reverse proxy
# platform/deploy/nginx/thirdwave.conf
# - Proxies port 80 → 3100
# - Rate limiting: 20 req/s burst 50
# - Proxy buffering disabled for SSE streams
```

---

### Task 4: Skills / Policies (UI, Coding Policies)

#### Skills System

The skills system is a **domain knowledge base** that enriches AI responses with specialized expertise.

| Property | Value |
|----------|-------|
| Total skills | 31 |
| Storage | `platform/skills/installed/` |
| Manager | `src/services/skill-manager.ts` (334 lines) |
| Categories | API Design, Architecture, Azure (6), Brand, Docs (3), Frontend, Debugging, Testing, TypeScript, React, UI/UX, Web Design |

**Installed Skills**:

| # | Skill | Category |
|---|-------|----------|
| 1 | api-design-principles | API Design |
| 2 | architecture-patterns | Architecture |
| 3 | azure-ai | Cloud (Azure) |
| 4 | azure-cost-optimization | Cloud (Azure) |
| 5 | azure-deploy | Cloud (Azure) |
| 6 | azure-diagnostics | Cloud (Azure) |
| 7 | azure-observability | Cloud (Azure) |
| 8 | azure-storage | Cloud (Azure) |
| 9 | brand-guidelines | Design |
| 10 | docx | Document Generation |
| 11 | find-skills | Meta |
| 12 | frontend-design | Frontend |
| 13 | internal-comms | Communication |
| 14 | mcp-builder | Protocol |
| 15 | nodejs-backend-patterns | Backend |
| 16 | pdf | Document Generation |
| 17 | pptx | Document Generation |
| 18 | python-performance-optimization | Performance |
| 19 | react-native-best-practices | Mobile |
| 20 | receiving-code-review | Code Review |
| 21 | requesting-code-review | Code Review |
| 22 | systematic-debugging | Debugging |
| 23 | test-driven-development | Testing |
| 24 | typescript-advanced-types | TypeScript |
| 25 | ui-ux-pro-max | UI/UX |
| 26 | vercel-composition-patterns | Frontend |
| 27 | vercel-react-best-practices | Frontend |
| 28 | verification-before-completion | Quality |
| 29 | web-design-guidelines | Web Design |
| 30 | webapp-testing | Testing |
| 31 | xlsx | Document Generation |

**API Endpoints**:
- `GET /api/skills` — List all skills with metadata
- `GET /api/skills/search?q=react` — Search skills by keyword
- `GET /api/skills/categories` — Skills grouped by category

#### Policy Engine

The policy engine is the **security and governance layer** that enforces coding policies across all AI operations.

| Property | Value |
|----------|-------|
| Engine | `src/services/policy-engine.ts` (594 lines) |
| Total policies | 10 active rules |
| Enforcement | Pre-flight evaluation on every chat prompt and tool call |
| Audit integration | All policy decisions logged to audit.db |

**Active Security Policies**:

| # | Policy | Type | Description |
|---|--------|------|-------------|
| 1 | Destructive Command Guard | Command Filter | Blocks `rm -rf /`, `DROP TABLE`, `mkfs`, `dd if=`, fork bombs |
| 2 | Sensitive File Guard | File Access | Blocks read/write to `.env`, `id_rsa`, `/etc/shadow`, `*.pem` |
| 3 | Path Traversal Guard | File Access | Denies `../` traversal outside project root and `/tmp` |
| 4 | Network Guard | URL Filter | Restricts which domains tools can fetch (blocks internal IPs) |
| 5 | Loop Detection | Agent Safety | Detects infinite tool-calling loops (same tool > 5x in 30s) |
| 6 | Risk Scoring Engine | Composite | Scores actions 0-100; deny > 80, ask > 50, allow < 50 |
| 7 | RBAC | Access Control | Role-based: admin, developer, reviewer, viewer |
| 8 | Budget Pre-flight | Budget | Blocks requests when daily/monthly token budget exceeded |
| 9 | Skill Trust Levels | Trust | Skills require minimum trust level to modify system files |
| 10 | Audit Compliance | Logging | All denied/warned actions logged with full metadata |

**Policy Decision Flow**:
```
Request → PolicyEngine.evaluate()
    │
    ├── Run all rules in parallel
    │     ├── Command Guard  → allow/deny/ask
    │     ├── File Guard     → allow/deny
    │     ├── Network Guard  → allow/deny
    │     ├── Risk Scorer    → score 0-100
    │     └── Budget Check   → allow/deny
    │
    ├── Aggregate decisions
    │     ├── ANY deny → DENY (with reasons)
    │     ├── ANY ask  → ASK (with warnings)
    │     └── ALL allow → ALLOW
    │
    └── Log to audit.db
```

**API Endpoints**:
- `GET /api/policies` — List all active policies with status
- `GET /api/policies/evaluate` — Dry-run evaluate a command/path against policies

---

## 3. ARCHITECTURE OF THE SYSTEM

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        THIRDWAVE AI CODING PLATFORM                       │
│                                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                 │
│  │  CLI Client   │  │  Web Dashboard│  │  TypeScript  │  ← User Layer  │
│  │  ("art" TUI)  │  │  (port 80)    │  │  SDK         │                │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                 │
│         │                  │                  │                          │
│         └──────────────────┼──────────────────┘                         │
│                            ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    HONO SERVER (:3100)                           │   │
│  │                                                                  │   │
│  │  ┌──────────────────────────────────────────────────────────┐   │   │
│  │  │  Middleware: Logger → CORS → RateLimit → Auth → Audit    │   │   │
│  │  └──────────────────────────────────────────────────────────┘   │   │
│  │                                                                  │   │
│  │  ┌──────────────────┐  ┌──────────────────┐                     │   │
│  │  │  Route Layer      │  │  SSE Events       │  ← API Layer      │   │
│  │  │  14 route modules │  │  Real-time stream  │                    │   │
│  │  └────────┬─────────┘  └──────────────────┘                     │   │
│  │           ▼                                                      │   │
│  │  ┌──────────────────────────────────────────────────────────┐   │   │
│  │  │                   SERVICE LAYER                           │   │   │
│  │  │                                                           │   │   │
│  │  │  ┌────────────┐ ┌────────────┐ ┌────────────┐           │   │   │
│  │  │  │ OpenCode   │ │ Provider   │ │ Policy     │           │   │   │
│  │  │  │ Client     │ │ Registry   │ │ Engine     │           │   │   │
│  │  │  └────────────┘ └────────────┘ └────────────┘           │   │   │
│  │  │  ┌────────────┐ ┌────────────┐ ┌────────────┐           │   │   │
│  │  │  │ Tool       │ │ Skill      │ │ Subagent   │           │   │   │
│  │  │  │ Executor   │ │ Manager    │ │ Orchestrat.│           │   │   │
│  │  │  └────────────┘ └────────────┘ └────────────┘           │   │   │
│  │  │  ┌────────────┐ ┌────────────┐ ┌────────────┐           │   │   │
│  │  │  │ Audit      │ │ Budget     │ │ Workspace  │           │   │   │
│  │  │  │ Logger     │ │ Manager    │ │ Manager    │           │   │   │
│  │  │  └────────────┘ └────────────┘ └────────────┘           │   │   │
│  │  │  ┌────────────┐ ┌────────────┐ ┌────────────┐           │   │   │
│  │  │  │ Scalable   │ │ Parallel   │ │ Task State │           │   │   │
│  │  │  │ Queue      │ │ Executor   │ │ Tracker    │           │   │   │
│  │  │  └────────────┘ └────────────┘ └────────────┘           │   │   │
│  │  └──────────────────────────────────────────────────────────┘   │   │
│  │                                                                  │   │
│  │  ┌──────────────────────────────────────────────────────────┐   │   │
│  │  │              PERSISTENCE (SQLite + WAL)                   │   │   │
│  │  │  audit.db  │  budget.db  │  tasks.db  │  workspaces.db   │   │   │
│  │  └──────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                            │                                            │
│              ┌─────────────┼─────────────┐                             │
│              ▼             ▼             ▼                              │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────┐                 │
│  │  OpenCode    │ │  vLLM #1     │ │  Ollama        │  ← Inference   │
│  │  Engine      │ │  MiniMax     │ │  Gateway       │    Layer        │
│  │  (:4096)     │ │  (:8000)     │ │  (:31254)      │                 │
│  └──────────────┘ └──────────────┘ └────────────────┘                 │
│                                                                         │
│                   ┌─── Optional Cloud Fallback ──┐                     │
│                   │  OpenAI  │  Anthropic  │ ...  │                     │
│                   └──────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────────────────┘
```

### Request Flow (Agentic Chat)

```
1. User: art "fix the login bug in auth.ts"
      │
2.    ▼  HTTP POST /api/chat
      │  { message: "fix the login bug...", tools: true }
      │
3.    ▼  Middleware chain
      │  Logger → CORS → RateLimit → Auth → Audit
      │
4.    ▼  PolicyEngine.evaluate(message)
      │  → Risk score: 15 → ALLOW
      │
5.    ▼  resolveModel() → Primary vLLM (MiniMax)
      │
6.    ▼  AGENTIC LOOP (round 1)
      │  POST vLLM:8000/v1/chat/completions + tools
      │  Model: "I'll read auth.ts first"
      │  Tool call: read_file { path: "src/auth.ts" }
      │
7.    ▼  ToolExecutor.execute("read_file", args)
      │  PolicyEngine: file guard → ALLOW
      │  Result: file contents (200 lines)
      │
8.    ▼  AGENTIC LOOP (round 2)
      │  Model gets file contents, identifies bug
      │  Tool call: write_file { path: "src/auth.ts", content: "..." }
      │
9.    ▼  ToolExecutor.execute("write_file", args)
      │  PolicyEngine: file guard → ALLOW
      │  Result: "Wrote 205 lines to src/auth.ts"
      │
10.   ▼  AGENTIC LOOP (round 3)
      │  Model: "I've fixed the bug. The issue was..."
      │  (No more tool calls — final response)
      │
11.   ▼  Response to CLI
      │  { text: "I've fixed the bug...",
      │    toolCalls: [read_file, write_file],
      │    tokens: { input: 4200, output: 890 } }
      │
12.   ▼  CLI saves write_file output to user's local machine
      │  CLI displays: "✓ Wrote src/auth.ts (205 lines)"
```

### Data Flow

| Flow | From | To | Protocol | Purpose |
|------|------|----|-----------|---------| 
| Client → Platform | CLI/SDK | Hono :3100 | HTTP REST | API requests |
| Platform → OpenCode | Hono | OpenCode :4096 | HTTP | Session management, VCS |
| Platform → vLLM | Hono | vLLM :8000 | HTTP (OpenAI-compat) | LLM inference |
| Platform → Ollama | Hono | Ollama :31254 | HTTP (OpenAI-compat) | Multi-model inference |
| Platform → SQLite | Services | .platform/*.db | bun:sqlite | Persistence |
| Platform → Client | Hono | CLI/Browser | SSE | Real-time events |
| nginx → Platform | nginx :80 | Hono :3100 | Reverse proxy | External access |

---

## 4. MODULES

### Core Modules

| # | Module | File | Lines | Description |
|---|--------|------|-------|-------------|
| 1 | **Platform Server** | `src/server/index.ts` | 644 | Main Hono application, middleware, route mounting, dashboard UI |
| 2 | **Chat Engine** | `src/server/routes/chat.ts` | 446 | Agentic chat with tool-calling loop, model resolution, streaming |
| 3 | **Provider Registry** | `src/services/provider-registry.ts` | 398 | Dynamic LLM provider discovery, health probes, 3 local + 9 cloud |
| 4 | **Policy Engine** | `src/services/policy-engine.ts` | 594 | 10 security policies, risk scoring, RBAC, audit integration |
| 5 | **Tool Executor** | `src/services/tool-executor.ts` | 432 | 6 tools: bash, read_file, write_file, list_dir, grep_search, web_fetch |
| 6 | **OpenCode Client** | `src/services/opencode-client.ts` | 369 | Client for OpenCode engine API (sessions, prompts, files, VCS) |
| 7 | **OpenCode Process** | `src/services/opencode-process.ts` | 234 | Manages OpenCode binary lifecycle (start, health check, restart) |

### Orchestration Modules

| # | Module | File | Lines | Description |
|---|--------|------|-------|-------------|
| 8 | **Subagent Orchestrator** | `src/services/subagent-orchestrator.ts` | 279 | Task decomposition, fan-out/fan-in, subtask management |
| 9 | **Parallel Executor** | `src/services/parallel-executor.ts` | 408 | Concurrent task execution with dependency graphs |
| 10 | **Scalable Queue** | `src/services/scalable-queue.ts` | 313 | Priority queue, configurable concurrency, backpressure |
| 11 | **Task State Tracker** | `src/services/task-state-tracker.ts` | 319 | SQLite-backed task persistence (pending/running/completed/failed) |

### Governance Modules

| # | Module | File | Lines | Description |
|---|--------|------|-------|-------------|
| 12 | **Audit Logger** | `src/services/audit-logger.ts` | 292 | Buffered audit trail, periodic flush, statistics |
| 13 | **Budget Manager** | `src/services/budget-manager.ts` | 258 | Token usage tracking, budget limits, pre-flight checks |
| 14 | **Skill Manager** | `src/services/skill-manager.ts` | 334 | 31 domain skills, search, categories, trust levels |
| 15 | **Workspace Manager** | `src/services/workspace-manager.ts` | 203 | Multi-workspace support, directory isolation |

### API Route Modules (14 total)

| # | Route | File | Endpoints |
|---|-------|------|-----------|
| 16 | Health | `routes/health.ts` | `GET /health` |
| 17 | Sessions | `routes/sessions.ts` | `GET/POST /api/sessions`, `POST /api/sessions/:id/prompt` |
| 18 | Tasks | `routes/tasks.ts` | `GET/POST /api/tasks` |
| 19 | Providers | `routes/providers.ts` | `GET /api/providers` |
| 20 | Files | `routes/files.ts` | `GET /api/files` |
| 21 | Events | `routes/events.ts` | `GET /api/events` (SSE stream) |
| 22 | Audit | `routes/audit.ts` | `GET /api/audit`, `GET /api/audit/stats` |
| 23 | Budget | `routes/budget.ts` | `GET /api/budget/summary`, `GET /api/budget/check` |
| 24 | Workspaces | `routes/workspaces.ts` | `GET/POST/PATCH/DELETE /api/workspaces` |
| 25 | Orchestrations | `routes/orchestrations.ts` | `GET/POST /api/orchestrations` |
| 26 | Queue | `routes/queue.ts` | `GET /api/queue/metrics` |
| 27 | Parallel | `routes/parallel.ts` | `GET/POST /api/parallel` |
| 28 | Registry | `routes/registry.ts` | `GET /api/registry`, `POST /api/registry/apikey` |
| 29 | Chat | `routes/chat.ts` | `POST /api/chat`, `POST /api/chat/stream`, `POST /api/chat/direct` |
| 30 | Skills | `routes/skills.ts` | `GET /api/skills`, `GET /api/skills/search`, `GET /api/skills/categories` |
| 31 | Policies | `routes/policies.ts` | `GET /api/policies` |

### Infrastructure Modules

| # | Module | File | Description |
|---|--------|------|-------------|
| 32 | **TypeScript SDK** | `src/sdk/client.ts` (602 lines) | Programmatic API client for Thirdwave |
| 33 | **SDK Events** | `src/sdk/events.ts` | SSE event subscription client |
| 34 | **Environment Config** | `src/config/env.ts` | Zod-validated environment variables |
| 35 | **Rate Limiter** | `src/middleware/rate-limit.ts` | Sliding window per-IP with DDoS protection |
| 36 | **Auth Middleware** | `src/middleware/auth.ts` | API key validation |
| 37 | **Logger Middleware** | `src/middleware/logger.ts` | Request/response timing |
| 38 | **CLI Client** | `bin/thirdwave-client` (~530 lines) | Bash + Python TUI tool |
| 39 | **Install Script** | `bin/install.sh` | One-line installer |
| 40 | **systemd Service** | `deploy/systemd/thirdwave.service` | Process management |
| 41 | **nginx Config** | `deploy/nginx/thirdwave.conf` | Reverse proxy |
| 42 | **Start Script** | `scripts/start-all.ts` | Orchestrates platform + OpenCode startup |

### Codebase Statistics

| Metric | Value |
|--------|-------|
| **Total TypeScript source** | 7,694 lines |
| **Source files** | 39 `.ts` files |
| **Route modules** | 14 |
| **Service modules** | 15 |
| **Middleware modules** | 3 |
| **SDK modules** | 3 |
| **CLI client** | ~530 lines (Bash + Python) |
| **Installed skills** | 31 |
| **Active policies** | 10 |
| **SQLite databases** | 4 (audit, budget, tasks, workspaces) |
| **Local LLM providers** | 3 (vLLM primary, vLLM Docker, Ollama gateway) |
| **Cloud providers** | 9 (OpenAI, Anthropic, Google, Mistral, Groq, DeepSeek, Together, Fireworks, OpenRouter) |
| **Agent tools** | 6 (bash, read_file, write_file, list_dir, grep_search, web_fetch) |
| **API endpoints** | 30+ |

---

## 5. CONCLUSION

Thirdwave is a complete, self-hosted AI coding platform that brings the capabilities of cloud AI assistants to private infrastructure. By running inference on local GPU servers via vLLM and Ollama, the platform ensures that **no proprietary code or data ever leaves the organization's network**.

### Key Achievements

1. **Full agentic coding capabilities**: The platform's tool-calling loop enables the AI to autonomously read files, write code, execute commands, search codebases, and iterate — mirroring the workflow of a human developer.

2. **Production infrastructure**: With systemd service management, nginx reverse proxy, SQLite persistence, rate limiting, and comprehensive audit logging, Thirdwave is ready for team deployment.

3. **Security-first design**: 10 active security policies protect against destructive commands, path traversal, sensitive file access, infinite loops, and budget overruns — all with full audit trail.

4. **Flexible provider architecture**: The dynamic provider registry supports 3 local inference servers and 9 cloud providers, with automatic health monitoring and failover. Teams can start fully local and add cloud providers as needed.

5. **Developer-centric UX**: The terminal-based CLI (`art`) provides a natural interface for developers, with agentic file saving to the local machine and color-coded tool call summaries.

### Infrastructure Summary

| Resource | Detail |
|----------|--------|
| Machine | aarch64 (ARM/Jetson), Ubuntu Linux |
| vLLM Primary | `172.30.140.91:8000` — MiniMax M2.1 REAP (30K ctx) |
| vLLM Secondary | `localhost:8000` — gpt-oss-120b (8K ctx) |
| Ollama Gateway | `172.30.140.143:31254` — 5 models (Qwen3, GPT-OSS, Coder) |
| Platform Server | Port 3100 (via nginx on :80) |
| OpenCode Engine | Port 4096 (internal) |
| Databases | 4 SQLite databases in `.platform/` |

### Future Directions

- Multi-user authentication with JWT tokens
- Web-based chat UI alongside the TUI
- Plugin system for custom tools
- Model fine-tuning pipeline integration
- Metrics dashboard with Prometheus/Grafana

---

*Thirdwave AI Coding Platform — v0.1.0*
*Built on OpenCode v1.2.17 | Hono 4.10.7 | Bun 1.3+ | vLLM + Ollama*
