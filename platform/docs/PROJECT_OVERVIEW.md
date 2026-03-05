# Artemis AI Coding Platform — Project Overview

## What Is Artemis?

Artemis is a **self-hosted AI coding assistant** that runs entirely on your local network. It uses local GPU-powered LLMs (via vLLM) to provide coding assistance — no data leaves your network. It combines a REST API server, a terminal UI client, and an SDK into a full AI coding platform.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      User Interface                         │
│  ┌───────────┐   ┌──────────────┐   ┌───────────────────┐  │
│  │    TUI     │   │   Browser    │   │   SDK / curl     │  │
│  │  (terminal)│   │  Dashboard   │   │   (any client)   │  │
│  └─────┬──────┘   └──────┬───────┘   └────────┬──────────┘  │
│        │                 │                     │             │
└────────┼─────────────────┼─────────────────────┼─────────────┘
         │                 │                     │
         ▼                 ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                Platform Server (:3100)                       │
│  Hono HTTP framework on Bun runtime                         │
│                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │   Auth   │ │  Logger  │ │Rate Limit│ │  Audit   │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                                                              │
│  Routes:                                                     │
│  /api/chat ──── AI chat with tool-calling (agentic loop)    │
│  /api/sessions ─ Chat sessions via OpenCode engine          │
│  /api/tasks ──── Async coding task queue                    │
│  /api/queue ──── Production scalable queue (SQLite-backed)  │
│  /api/parallel ─ Fan-out/fan-in parallel task execution     │
│  /api/orchestrations ─ Multi-agent orchestration (DAG)      │
│  /api/budget ── Per-user token/request budget limits        │
│  /api/audit ─── Every API call logged to SQLite             │
│  /api/registry ─ Model registry (local vLLM + cloud)       │
│  /api/skills ── Knowledge skill matching                    │
│  /api/policies ─ Security policy engine                     │
│  /api/workspaces ─ Multi-project workspace management       │
│  /api/providers ─  Provider pass-through to OpenCode        │
│  /api/files ───── File operations pass-through              │
│  /api/events ──── SSE event stream                          │
│  /health ──────── Health checks                             │
│                                                              │
│  Services:                                                   │
│  ├── OpenCodeClient ─── Talks to OpenCode engine (:4096)    │
│  ├── TaskQueue ──────── In-memory task queue                │
│  ├── ScalableQueue ──── SQLite-backed persistent queue      │
│  ├── ParallelExecutor ─ Concurrent task execution           │
│  ├── SubagentOrchestrator ─ Multi-agent DAG orchestration   │
│  ├── BudgetManager ──── Token/cost tracking per user        │
│  ├── AuditLogger ────── Every action logged to SQLite       │
│  ├── WorkspaceManager ─ Multi-workspace support             │
│  ├── ProviderRegistry ─ vLLM + 8 cloud providers           │
│  ├── SkillManager ───── 31 knowledge skills                 │
│  ├── PolicyEngine ───── Security policy enforcement         │
│  └── ToolExecutor ───── 6 tools for agentic chat           │
└──────────────────────────┬──────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
   ┌──────────────┐ ┌───────────┐ ┌────────────────┐
   │  OpenCode    │ │  vLLM #1  │ │   vLLM #3      │
   │  Engine      │ │  MiniMax  │ │  Multi-model   │
   │  (:4096)     │ │ (:8000)   │ │  (:11435)      │
   └──────────────┘ └───────────┘ └────────────────┘
```

---

## Component Breakdown

### 1. Platform Server (`src/server/index.ts`)
The main HTTP server built with **Hono** running on **Bun**. It:
- Serves a web dashboard at `/` (dark-themed, shows status of all subsystems)
- Provides REST API endpoints for all features
- Applies middleware chain: logging → CORS → rate-limiting → auth → audit
- Manages service lifecycle (startup, graceful shutdown)

### 2. Chat Route — The AI Agent (`src/server/routes/chat.ts`)
The core AI feature. When you send a message to `/api/chat`:
1. Policy engine checks the message (blocks dangerous commands)
2. Resolves which LLM to use (local vLLM or cloud)
3. Enters **agentic tool-calling loop** (up to 15 rounds):
   - Sends message to LLM with tool definitions
   - If LLM requests a tool call (bash, read_file, write_file, etc.), executes it
   - Feeds tool results back to the LLM
   - Repeats until LLM gives a final text response
4. Returns the response + token usage + tool call log

**6 Available Tools:**
| Tool | What it does |
|------|-------------|
| `bash` | Execute shell commands |
| `read_file` | Read file contents |
| `write_file` | Create/overwrite files |
| `list_dir` | List directory contents |
| `grep_search` | Search text in files |
| `web_fetch` | Fetch URL contents |

Also provides:
- `POST /api/chat/direct` — Fast path, no tools, no policy checks
- `POST /api/chat/reason` — Force chain-of-thought reasoning
- `GET /api/chat/tools` — List available tools

### 3. Terminal UI (`tui/src/main.ts` + `tui/src/handlers.ts`)
An interactive terminal client (~1,500 lines). Features:
- Real-time chat with the AI (markdown-rendered responses)
- Slash commands: `/models`, `/health`, `/budget`, `/skills`, `/policy`, etc.
- Tab-completion for commands
- `/apikey <provider> <key>` — Live-configure cloud provider API keys
- Automatic reconnection, 180-second timeout for long AI responses
- Color-coded output with status indicators

### 4. Provider Registry (`src/services/provider-registry.ts`)
Discovers and manages LLM providers:
- **Local vLLM**: Probes configured endpoints, discovers models via `/v1/models`
- **Cloud**: 8 providers (OpenAI, Anthropic, Google, Mistral, Groq, DeepSeek, Together, Fireworks)
- Health-checks providers, reports latency
- TUI can set API keys at runtime without restart

**Current local vLLM configuration:**
| Server | Endpoint | Models |
|--------|----------|--------|
| Primary (MiniMax) | `172.30.140.91:8000/v1` | MiniMax-M2.1-REAP-50-W4A16 |
| Extra (gpt-oss) | `localhost:8000/v1` | gpt-oss-120b |
| Multi-model | `172.30.140.143:11435` | 5 models (Qwen, Mistral, etc.) |

### 5. Policy Engine (`src/services/policy-engine.ts`)
Security layer with multiple components:
- **Risk Engine** — Scores actions by risk level (0-100)
- **Destructive Command Guard** — Detects `rm -rf`, `DROP TABLE`, etc.
- **Sensitive File Guard** — Blocks access to `.env`, SSH keys, etc.
- **Network Guard** — Controls which URLs tools can access
- **Loop Detection** — Detects infinite agent loops
- **RBAC** — Role-based access control (admin/developer/reviewer/viewer)
- **Skill Trust** — Trust levels for knowledge skills
- **Autonomy Controller** — Controls how autonomous agents can be

### 6. Skill Manager (`src/services/skill-manager.ts`)
Loads 31 knowledge skills from the `skills/` directory. When users ask questions, the system matches relevant skills and injects their knowledge into the AI's context. Covers: Azure services, API design, testing, debugging, TypeScript, React, and more.

### 7. Production Services

| Service | Purpose | Storage |
|---------|---------|---------|
| **ScalableQueue** | Persistent job queue with priority, retries, backpressure | SQLite (`tasks.db`) |
| **ParallelExecutor** | Run N tasks concurrently with dependency resolution | In-memory |
| **SubagentOrchestrator** | Multi-agent DAG execution | In-memory |
| **BudgetManager** | Per-user token/request/cost limits | SQLite (`budget.db`) |
| **AuditLogger** | Logs every API call and action | SQLite (`audit.db`) |
| **WorkspaceManager** | Multi-project workspace switching | SQLite (`workspaces.db`) |

### 8. SDK (`src/sdk/client.ts`)
A TypeScript client library (600 lines) that wraps all REST APIs into typed methods. Used by the TUI and can be used by any TypeScript/JavaScript project:

```typescript
import { PlatformClient } from "@artemis/sdk"

const client = new PlatformClient({ baseUrl: "http://localhost:3100" })
const result = await client.chat({ message: "Explain this code" })
```

---

## Data Flow: What Happens When You Send a Message

```
User types: "Fix the bug in server.ts"
         │
         ▼
  TUI sends POST /api/chat
  { message: "Fix the bug in server.ts", tools: true }
         │
         ▼
  Middleware chain:
    logger → rate-limit → auth → audit
         │
         ▼
  Policy engine checks message → ALLOW
         │
         ▼
  Resolve model → vLLM MiniMax at 172.30.140.91:8000
         │
         ▼
  ┌─── Agentic Loop (up to 15 rounds) ───┐
  │                                        │
  │  Round 1: LLM → "read_file server.ts" │
  │  Execute tool → file contents          │
  │                                        │
  │  Round 2: LLM → "grep_search error"   │
  │  Execute tool → found line 42          │
  │                                        │
  │  Round 3: LLM → "write_file server.ts"│
  │  Execute tool → file updated           │
  │                                        │
  │  Round 4: LLM → final text response   │
  └────────────────────────────────────────┘
         │
         ▼
  Response: {
    text: "I fixed the bug on line 42...",
    model: "MiniMax-M2.1-REAP-50-W4A16",
    tokens: { input: 2340, output: 180 },
    toolCalls: [ ... 3 tool calls ... ]
  }
```

---

## File Structure

```
platform/
├── src/
│   ├── config/
│   │   └── env.ts              # All configuration + env validation
│   ├── middleware/
│   │   ├── auth.ts             # API key authentication
│   │   ├── logger.ts           # Request logging
│   │   └── rate-limit.ts       # Rate limiting
│   ├── server/
│   │   ├── index.ts            # Main server (602 lines) + dashboard
│   │   └── routes/             # 16 route files
│   │       ├── chat.ts         # AI chat with tools (445 lines)
│   │       ├── sessions.ts     # Chat sessions
│   │       ├── tasks.ts        # Task queue
│   │       ├── queue.ts        # Scalable queue
│   │       ├── parallel.ts     # Parallel execution
│   │       ├── orchestrations.ts # Multi-agent orchestration
│   │       ├── budget.ts       # Budget management
│   │       ├── audit.ts        # Audit logs
│   │       ├── registry.ts     # Model registry
│   │       ├── skills.ts       # Knowledge skills
│   │       ├── policies.ts     # Security policies
│   │       ├── workspaces.ts   # Workspaces
│   │       ├── providers.ts    # Provider pass-through
│   │       ├── files.ts        # File operations
│   │       ├── events.ts       # SSE events
│   │       └── health.ts       # Health checks
│   ├── services/               # 14 service files
│   │   ├── opencode-client.ts  # OpenCode API client
│   │   ├── opencode-process.ts # OpenCode process manager
│   │   ├── provider-registry.ts # vLLM + cloud model registry
│   │   ├── tool-executor.ts    # 6 tools for agentic chat
│   │   ├── skill-manager.ts    # Knowledge skill matching
│   │   ├── policy-engine.ts    # Security policy engine (594 lines)
│   │   ├── task-queue.ts       # In-memory task queue
│   │   ├── scalable-queue.ts   # SQLite-backed production queue
│   │   ├── parallel-executor.ts # Parallel task execution
│   │   ├── subagent-orchestrator.ts # Multi-agent orchestration
│   │   ├── budget-manager.ts   # Token/cost budget tracking
│   │   ├── audit-logger.ts     # Action audit logging
│   │   ├── workspace-manager.ts # Workspace management
│   │   └── task-state-tracker.ts # Persistent task state
│   ├── sdk/
│   │   └── client.ts           # TypeScript SDK (602 lines)
│   └── types.ts                # Shared types
├── tui/
│   └── src/
│       ├── main.ts             # TUI entry point (442 lines)
│       └── handlers.ts         # Command handlers (1,494 lines)
├── scripts/
│   ├── launch.ts               # Interactive launcher
│   ├── start-all.ts            # Headless launcher
│   └── start-opencode.ts       # OpenCode-only launcher
├── skills/                     # 31 knowledge skill files
├── deploy/
│   ├── deploy.sh               # Automated deployment script
│   ├── nginx/artemis.conf      # nginx reverse proxy config
│   └── systemd/artemis.service # systemd service unit
├── .env                        # Environment configuration
├── package.json                # Dependencies
└── docs/
    ├── DEPLOY.md               # Deployment guide
    └── PROJECT_OVERVIEW.md     # This file
```

---

## Key Technologies

| Component | Technology |
|-----------|-----------|
| Runtime | Bun 1.3+ |
| HTTP Framework | Hono |
| Database | SQLite (via bun:sqlite) |
| LLM Inference | vLLM (OpenAI-compatible API) |
| AI Engine | OpenCode (optional, for sessions) |
| Terminal UI | Custom (chalk + marked + readline) |
| Deployment | nginx + systemd |

---

## API Endpoints Summary

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Health status |
| `GET` | `/` | Web dashboard |
| `POST` | `/api/chat` | AI chat with tool-calling |
| `POST` | `/api/chat/direct` | Fast chat (no tools) |
| `POST` | `/api/chat/reason` | Chat with reasoning |
| `GET` | `/api/chat/tools` | List available tools |
| `GET/POST` | `/api/sessions` | Session management |
| `POST` | `/api/sessions/:id/messages` | Send prompt in session |
| `GET/POST` | `/api/tasks` | Task queue |
| `GET/POST` | `/api/queue` | Scalable queue |
| `GET` | `/api/queue/metrics` | Queue metrics |
| `GET/POST` | `/api/parallel` | Parallel execution |
| `GET/POST` | `/api/orchestrations` | Multi-agent orchestration |
| `GET/PUT` | `/api/budget/*` | Budget management |
| `GET` | `/api/audit` | Audit logs |
| `GET` | `/api/registry` | Model registry |
| `GET` | `/api/skills` | Knowledge skills |
| `POST` | `/api/policies/evaluate` | Policy evaluation |
| `GET/POST` | `/api/workspaces` | Workspace management |
| `GET` | `/api/providers` | Provider info |
| `GET` | `/api/files` | File listing |
| `GET` | `/api/vcs` | Git status |
