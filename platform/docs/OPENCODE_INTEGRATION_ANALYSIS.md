# OpenCode Integration Analysis

## Overview

OpenCode is a self-hosted Go-based code intelligence engine running on **port 4096** that the Thirdwave platform delegates heavyweight operations to via HTTP. The platform acts as a thin wrapper/gateway around OpenCode, providing REST API abstraction, user management, policy enforcement, and skill management.

---

## 1. Files That Interact with OpenCode

### Core Integration Files

| File | Location | Purpose |
|------|----------|---------|
| [opencode-client.ts](platform/src/services/opencode-client.ts) | `platform/src/services/` | Typed HTTP client wrapping OpenCode REST API. Core abstraction layer. |
| [opencode-process.ts](platform/src/services/opencode-process.ts) | `platform/src/services/` | Process manager that spawns/supervises OpenCode as a child process |
| [sessions.ts](platform/src/server/routes/sessions.ts) | `platform/src/server/routes/` | REST API routes mapping `/api/sessions/*` → OpenCode `/session/*` |
| [files.ts](platform/src/server/routes/files.ts) | `platform/src/server/routes/` | REST API routes for file operations, delegates to OpenCode |
| [providers.ts](platform/src/server/routes/providers.ts) | `platform/src/server/routes/` | Agent/provider listing, delegates to OpenCode `/agent` and `/provider` |
| [index.ts](platform/src/server/index.ts) | `platform/src/server/` | Server initialization, creates OpenCodeClient and starts OpenCodeProcess |
| [env.ts](platform/src/config/env.ts) | `platform/src/config/` | Configuration parsing for `OPENCODE_URL`, `OPENCODE_BIN`, `OPENCODE_DIR` |
| [client.ts](platform/src/sdk/client.ts) | `platform/src/sdk/` | Public SDK client connecting TUI/extensions to platform (which proxies to OpenCode) |
| [handlers.ts](platform/tui/src/handlers.ts) | `platform/tui/src/` | TUI command handlers that call platform client (not directly OpenCode) |
| [task-queue.ts](platform/src/services/task-queue.ts) | `platform/src/services/` | Task queue enqueuer that fires async prompts to OpenCode |

### Configuration/Build Files

| File | Purpose |
|------|---------|
| [docker-compose.dev.yml](docker-compose.dev.yml) | Development compose: exposes ports 3100 (platform) and 4096 (OpenCode) |
| [platform/docker/docker-compose.yml](platform/docker/docker-compose.yml) | Production compose: same ports, different image |
| [Dockerfile.dev](Dockerfile.dev) | Dev image: builds/includes OpenCode binary, starts via `opencode serve` |
| [platform/docker/Dockerfile](platform/docker/Dockerfile) | Prod image: same structure |
| [platform/.env](platform/.env) | Environment file (not tracked) with OPENCODE_URL config |

---

## 2. HTTP Endpoints & Operations Called

### OpenCode Client Methods → HTTP Endpoints

```
OpenCodeClient (platform/src/services/opencode-client.ts)
│
├─ Health
│  └─ health()                         → GET /session (checks if up)
│
├─ Sessions (conversation threads)
│  ├─ sessions(opts)                   → GET /session (list+search)
│  ├─ session(id)                      → GET /session/{id}
│  ├─ createSession(opts)              → POST /session
│  ├─ deleteSession(id)                → DELETE /session/{id}
│  ├─ abortSession(id)                 → POST /session/{id}/abort
│  ├─ forkSession(id)                  → POST /session/{id}/fork
│  ├─ summarizeSession(id)             → POST /session/{id}/summarize
│  └─ sessionStatus()                  → GET /session/status
│
├─ Messages (prompts & responses)
│  ├─ messages(sessionID, opts)        → GET /session/{id}/message
│  ├─ message(sessionID, messageID)    → GET /session/{id}/message/{messageID}
│  ├─ prompt(sessionID, input)         → POST /session/{id}/message (blocking)
│  ├─ promptAsync(sessionID, input)    → POST /session/{id}/prompt_async (fire-and-forget)
│  ├─ promptStream(sessionID, input)   → POST /session/{id}/message (SSE stream)
│  └─ deleteMessage(sessionID, msgID)  → DELETE /session/{id}/message/{messageID}
│
├─ Agents & Providers
│  ├─ agents()                         → GET /agent
│  ├─ providers()                      → GET /provider
│  ├─ skills()                         → GET /skill
│  ├─ setAuth(providerID, body)        → PUT /provider/{id}/auth
│  └─ removeAuth(providerID)           → DELETE /provider/{id}/auth
│
├─ File Operations
│  ├─ currentProject()                 → GET /project
│  ├─ projects()                       → GET /project (returns current only)
│  ├─ files(dir)                       → GET /file?path={dir}
│  ├─ readFile(path)                   → GET /file/read?path={path}
│  ├─ findFiles(query)                 → GET /file/search?q={query}
│  ├─ fileStatus()                     → GET /file/status
│  └─ findText(query)                  → GET /file/grep?q={query}
│
├─ VCS/Config
│  ├─ config()                         → GET /config
│  ├─ updateConfig(patch)              → PATCH /config
│  ├─ vcs()                            → GET /vcs
│  └─ paths()                          → GET /path
│
├─ Session Modification
│  ├─ revert(sessionID)                → POST /session/{id}/revert
│  └─ unrevert(sessionID)              → POST /session/{id}/unrevert
│
└─ Events (SSE)
   └─ subscribe(listener)              → EventSource at /event
```

### HTTP Request Details

**Base URL:** `http://127.0.0.1:4096` (configurable via `OPENCODE_URL`)

**Headers:**
- `Content-Type: application/json`
- `Accept: application/json` (or `text/event-stream` for SSE)
- `X-OpenCode-Directory: <OPENCODE_DIR>` (when set)
- `Authorization: Basic <base64>` (optional, for `OPENCODE_SERVER_USERNAME/PASSWORD`)

**Request Pattern Examples:**

```typescript
// Each request is JSON-based
POST /session/{id}/message
{
  "parts": [
    { "type": "text", "text": "Fix the bug in foo.ts" }
  ],
  "agent": "build",
  "model": { "modelID": "modelname", "providerID": "vllm" }
}

// Platform-to-platform (TUI talks to platform, not directly to OpenCode)
POST /api/sessions/{id}/messages
{
  "content": "Fix the bug in foo.ts",
  "agentID": "build",
  "modelID": "modelname",
  "providerID": "vllm"
}
```

---

## 3. Operations: OpenCode vs. Platform

### What OpenCode Does (Delegated to port 4096)

| Operation | OpenCode Responsibility |
|-----------|------------------------|
| **Session Management** | Create/list/delete/fork/abort coding sessions |
| **Message Processing** | Accept prompts, route to agents, stream responses |
| **Agents** | Implement agent logic (build, plan, explore, general modes) |
| **File I/O** | Read/write files in `OPENCODE_DIR` |
| **Git Operations** | Clone, commit, push, diff, status, blame, VCS metadata |
| **Search** | ripgrep integration for file/text search in workspace |
| **Code Intelligence** | AST parsing, language detection, symbol lookup |
| **Provider Integration** | Manage LLM/API provider auth, model listing |
| **Skill Execution** | Execute registered skills as part of agent operations |
| **Event Streaming** | SSE event bus for real-time progress (tool executions, errors) |
| **Session Snapshots** | Full conversation history, revert/unrevert capability |

### What Platform Does (Implemented Locally)

| Operation | Platform Responsibility |
|-----------|------------------------|
| **User/Workspace Isolation** | Multi-user sessions, workspace boundaries (RBAC) |
| **Policy Enforcement** | Security policies, rate limiting, resource budgets |
| **HITL (Human-in-the-Loop)** | Approval gates for destructive operations |
| **Chat Abstraction** | vLLM tool-calling with XML `<tool_use>` parsing for models without native function_calling |
| **Tool Execution** | bash, read_file, write_file, grep_search, etc. via SDK (NOT through OpenCode) |
| **Skill Management** | Load/register skills, manage skill manifest, trust levels |
| **Provider Registry** | Aggregate providers from config, environment variables |
| **Task Queueing** | TaskQueue (4 concurrency), ScalableQueue (persistent, with SQLite) |
| **Audit Logging** | SQLite audit.db tracking all operations |
| **Budget Tracking** | Token budget, operation limits per user/workspace |
| **TUI/Extension API** | REST gateway on port 3100 serving clients |
| **File Route Mapping** | `/api/files/*` → platform directory queries (uses OpenCode `/file` under the hood) |

---

## 4. Environment Variables & Configuration

### Core OpenCode Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `OPENCODE_URL` | `http://127.0.0.1:4096` | URL for OpenCode server (http://host:port format) |
| `OPENCODE_BIN` | `opencode` | Binary name/path to launch (must be in PATH or absolute) |
| `OPENCODE_DIR` | `process.cwd()` | Working directory where OpenCode operates (workspace root) |
| `OPENCODE_PORT` | `4096` | Port for Docker Compose mapping (not used when URL is set) |
| `OPENCODE_SERVER_USERNAME` | (none) | Optional: HTTP Basic auth username to OpenCode |
| `OPENCODE_SERVER_PASSWORD` | (none) | Optional: HTTP Basic auth password to OpenCode |
| `AGENT_WORKSPACE_DIR` | `.agent-workspace` | Subdirectory under `OPENCODE_DIR` where AI writes files |

### Multi-User Port Shifting

```bash
# Single developer: default ports
PORT=3100 OPENCODE_URL=http://127.0.0.1:4096 bun run start

# Multiple developers on same host with offset
THIRDWAVE_PORT_OFFSET=10  # Shifts both ports
# → Platform: 3110, OpenCode: 4106

# Or explicit per-user setup
PORT=9000 OPENCODE_URL=http://127.0.0.1:9096 AUTO_PORT=false
```

### Inference Configuration

| Variable | Purpose |
|----------|---------|
| `VLLM_GATEWAY_URL` | Gateway proxy for all vLLM requests (bypasses direct endpoint) |
| `VLLM_BASE_URL` | Direct vLLM endpoint (fallback if no gateway) |
| `VLLM_GATEWAY_KEY` | API key for gateway |
| `VLLM_MODEL_ID` | Model identifier for direct calls |
| `VLLM_CONTEXT_LIMIT` | Max input tokens (default: 30000) |
| `VLLM_OUTPUT_LIMIT` | Max output tokens (default: 4096) |

### Where Config is Loaded

1. **Dockerfile.dev / Production Dockerfile:**
   ```dockerfile
   ENV OPENCODE_URL=http://127.0.0.1:4096
   ENV OPENCODE_BIN=opencode
   ENV OPENCODE_DIR=/workspace
   ```

2. **docker-compose.dev.yml:**
   ```yaml
   environment:
     OPENCODE_URL: "http://127.0.0.1:4096"
     OPENCODE_BIN: opencode
     OPENCODE_DIR: /workspace
   ```

3. **platform/.env (manual setup):**
   ```bash
   OPENCODE_URL=http://127.0.0.1:4096
   OPENCODE_BIN=opencode
   OPENCODE_DIR=/workspace
   VLLM_GATEWAY_URL=http://172.30.140.63:9080/v1
   ```

4. **Runtime environment at startup** (`OpenCodeProcess.start()`):
   - Checks `OPENCODE_URL` port availability
   - If busy and `AUTO_PORT=true`: auto-selects free port
   - Spawns OpenCode binary with: `opencode serve --port=4096 --hostname=127.0.0.1`
   - Waits for "listen" output (max 30 seconds)
   - Passes `OPENCODE_CONFIG_CONTENT` (JSON with vLLM setup) via env var

---

## 5. Docker Compose Setup

### Development: docker-compose.dev.yml

```yaml
services:
  platform:
    build:
      context: .
      dockerfile: Dockerfile.dev
    container_name: thirdwave-dev
    ports:
      - "3100:3100"    # Platform backend
      - "4096:4096"    # OpenCode
    environment:
      OPENCODE_URL: "http://127.0.0.1:4096"
      OPENCODE_DIR: /workspace
    volumes:
      - ./platform/src:/app/platform/src:ro       # Live reload
      - workspace-data:/workspace                  # Agent files
      - opencode-state:/root/.local/share/opencode # Persistence

volumes:
  workspace-data:
  opencode-state:
```

### Production: platform/docker/docker-compose.yml

```yaml
services:
  platform:
    build:
      context: ../..
      dockerfile: platform/docker/Dockerfile
    ports:
      - "3100:3100"    # Platform backend
      - "4096:4096"    # OpenCode
    environment:
      OPENCODE_URL: "http://127.0.0.1:4096"
      OPENCODE_DIR: "/workspace"
      VLLM_BASE_URL: "${VLLM_BASE_URL:-http://172.30.140.91:8000/v1}"
    volumes:
      - ${PROJECT_DIR:-.}:/workspace:rw
      - opencode-state:/root/.local/share/opencode
```

### Build Stages (Dockerfile.dev)

1. **Stage 1: OpenCode Build**
   ```dockerfile
   FROM oven/bun:1.3.10-alpine AS opencode-build
   COPY packages/opencode/ packages/opencode/
   RUN cd packages/opencode && bun run build
   ```

2. **Stage 2: Platform Runtime**
   ```dockerfile
   FROM oven/bun:1.3.10-alpine AS runtime
   RUN apk add --no-cache git ripgrep curl docker-cli
   COPY --from=opencode-build /build/packages/opencode/dist/.../opencode /usr/local/bin/opencode
   COPY platform/src ./platform/src
   EXPOSE 3100 4096
   CMD ["bun", "run", "scripts/start-all.ts"]
   ```

---

## 6. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Client Layer (Port 3100)                                    │
├──────────────────────────────────────────────────────────────┤
│  TUI                    VS Code Extension                   │
│  (platform/tui/)        (vscode-extension/)                 │
│  - connects to Platform - connects to Platform               │
│  - calls /api/sessions  - calls REST API                     │
└────────────┬───────────────────────────────────────┬────────┘
             │                                       │
             └──────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ Platform Backend (Port 3100)                                 │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─ REST API Routes (platform/src/server/routes/)          │
│  │  ├─ /api/sessions/*       → OpenCodeClient              │
│  │  ├─ /api/files/*          → OpenCodeClient              │
│  │  ├─ /api/chat             → vLLM (tool-calling)        │
│  │  ├─ /api/tasks            → TaskQueue                   │
│  │  └─ /api/agents           → OpenCodeClient              │
│  │                                                          │
│  ├─ Services                                               │
│  │  ├─ OpenCodeClient        ◄────────────────────────┐   │
│  │  │  (platform/src/services/opencode-client.ts)     │   │
│  │  │  Wraps HTTP requests to port 4096               │   │
│  │  │                                                  │   │
│  │  ├─ OpenCodeProcess       ◄────────────────────────┤   │
│  │  │  (platform/src/services/opencode-process.ts)    │   │
│  │  │  Spawns/supervises OpenCode as child process   │   │
│  │  │                                                  │   │
│  │  ├─ TaskQueue / ScalableQueue                       │   │
│  │  │  Chains prompts to OpenCode sessions             │   │
│  │  │                                                  │   │
│  │  ├─ PolicyEngine                                    │   │
│  │  ├─ SkillManager                                    │   │
│  │  ├─ AuditLogger (SQLite)                            │   │
│  │  ├─ BudgetManager (SQLite)                          │   │
│  │  └─ HITL Service                                    │   │
│  │                                                      │   │
│  └─ Tool Execution (NOT via OpenCode)                   │   │
│     - bash, read_file, write_file via                   │   │
│       platform/src/services/tool-executor.ts            │   │
│                                                          │   │
└──────────────────────────────────────────────────────────────┤
             ↓ HTTP (localhost) ↓                               │
         POST /session/{id}/message                            │
         POST /session/{id}/abort                              │
         GET  /file/read?path={path}                           │
         POST /session (create)                                │
         GET  /agent (list agents)                             │
         EventSource /event (streaming)                        │
                                                                │
┌──────────────────────────────────────────────────────────────┐
│ OpenCode Engine (Port 4096) — Go Binary                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Session Engine                                             │
│  ├─ Session store (conversation threads)                    │
│  ├─ Message processing (prompt → agent → response)          │
│  └─ Event bus (SSE /event)                                  │
│                                                              │
│  Agents                                                      │
│  ├─ build:   read/write files, execute commands             │
│  ├─ plan:    read-only planning                             │
│  ├─ explore: codebase search & analysis                     │
│  └─ general: multi-step reasoning                           │
│                                                              │
│  File System Integration                                    │
│  ├─ Read: /file/read → fs.readFile(OPENCODE_DIR)           │
│  ├─ List: /file      → fs.readdir(OPENCODE_DIR)             │
│  ├─ Search: /file/grep → ripgrep for fast search            │
│  └─ Write: (via session completion)                         │
│                                                              │
│  Git Integration                                             │
│  ├─ /vcs → git status, log, diff, blame                     │
│  └─ Modify via agents (commit, push, etc.)                  │
│                                                              │
│  Provider/VCS Config                                        │
│  ├─ /provider → list LLM/API providers                      │
│  ├─ /agent → list available agents                          │
│  └─ /config → workspace configuration                       │
│                                                              │
│  Working Directory: /workspace (OPENCODE_DIR)               │
│  └─ Code files, git repo, .agent-workspace/                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
         ↓                                              ↓
    Workspace (/workspace/)              External Services
    • Project code                        • vLLM (port 8000/8001)
    • .git/ (if git repo)                 • API providers (OpenAI, Anthropic, etc.)
    • .agent-workspace/ (AI writes here)  • Docker daemon (for image ops)
    • File cache                          • System shell (bash/zsh)
```

---

## 7. Dependency Relationship Summary

```
TUI / Extension
    ↓
    └─→ PlatformClient (port 3100)
            ↓
            ├─→ OpenCodeClient (HTTP to port 4096)
            │   ├─→ Sessions API
            │   ├─→ Messages/Prompts API
            │   ├─→ Files API
            │   ├─→ Agents/Providers API
            │   └─→ Event Stream (SSE)
            │
            ├─→ PolicyEngine (local SQLite)
            ├─→ AuditLogger (local SQLite)
            ├─→ SkillManager (local filesystem)
            ├─→ TaskQueue (enqueues to OpenCode)
            └─→ Tool Executor (bash, file ops — NOT delegated)
                ↓
                OpenCode Engine (port 4096)
                    ├─→ Files on /workspace
                    ├─→ Git ops on /workspace/.git
                    ├─→ External vLLM/APIs (for inference)
                    └─→ Agent Logic (build/plan/explore/general)
```

---

## 8. Key Integration Points

### 1. Session Architecture

- **Platform creates:** Task references, user records, budget tracking
- **OpenCode creates:** Session objects, message history, conversation state
- **Both interact:** Platform enqueues tasks → OpenCode processes → Platform tracks completion

### 2. File Operations Flow

```
Client request → /api/files/content?path=foo.ts
    ↓
Platform fileRoutes
    ↓
OpenCodeClient.readFile(path)
    ↓
HTTP GET http://127.0.0.1:4096/file/read?path=<path>
    ↓
OpenCode reads from /workspace/foo.ts
    ↓
Returns { type, content }
    ↓
Platform responds to client
```

### 3. Prompt Chain Flow

```
Client request → /api/sessions/{id}/messages (POST)
    ↓
Platform sessionRoutes
    ↓
OpenCodeClient.prompt(sessionID, {content, agentID, modelID})
    ↓
HTTP POST http://127.0.0.1:4096/session/{id}/message
    Body: {
      parts: [{ type: "text", text: "..." }],
      agent: "build",
      model: { modelID: "...", providerID: "vllm" }
    }
    ↓
OpenCode agent processes:
  • Parses prompt
  • Enumerates tools (read, write, bash, etc.)
  • Routes to vLLM for inference
  • Receives tool calls from model
  • Executes tools (file I/O, git, etc.)
  • Streams result parts back via SSE
    ↓
Platform collects response
    ↓
Returns MessageWithParts to client
```

### 4. TUI to Platform Flow

```
TUI handler (handlers.ts)
    ↓
PlatformClient (SDK client at platform/src/sdk/client.ts)
    ↓
HTTP requests to http://localhost:3100/api/*
    ↓
Platform REST routes
    ↓
OpenCodeClient (if needed)
    ↓
HTTP to http://127.0.0.1:4096/*
```

**Important:** TUI does NOT directly call OpenCode. It always goes through the Platform.

---

## 9. Execution Flow Example: "Fix the bug in foo.ts"

```
User (TUI)
    ↓
POST /api/sessions/{id}/messages
Content: "Fix the bug in foo.ts"
    ↓
Platform: sessions.ts::POST /:id/messages
    ├─ Parse PromptBody { content, agentID, modelID, ... }
    ├─ Call client.prompt(sessionID, body)
    ↓
OpenCodeClient.prompt()
    ├─ Transform to OpenCode format:
    │   { parts: [{ type: "text", text: "Fix the bug in foo.ts" }],
    │     agent: "build" }
    ├─ HTTP POST http://127.0.0.1:4096/session/{id}/message
    ↓
OpenCode Agent (build mode)
    ├─ Receives prompt with /session/{id}/message
    ├─ Looks up session, appends message
    ├─ Calls vLLM with tools schema:
    │   - bash (execute commands)
    │   - file_read, file_write
    │   - search (ripgrep)
    ├─ vLLM returns:
    │   { "tool_calls": [
    │       { "name": "file_read", "args": { "path": "foo.ts" } }
    │     ] }
    ├─ Executes: fs.readFile(/workspace/foo.ts)
    ├─ Sends SSE event: { type: "file", path: "foo.ts", content: "..." }
    ├─ Continues loop until complete or error
    ├─ Final response contains all executed steps
    ↓
HTTP 200 with MessageWithParts response
    { id: "msg123", parts: [
        { type: "reasoning", text: "..." },
        { type: "tool", name: "bash", output: "..." },
        { type: "file", path: "foo.ts", patch: "..." },
        { type: "text", text: "Summary: fixed the off-by-one error" }
      ]
    }
    ↓
Platform returns to client
    ↓
TUI displays results
```

---

## 10. Summary Table: What's Delegated

| Capability | OpenCode (4096) | Platform (3100) | Notes |
|------------|-----------------|-----------------|-------|
| Session management | ✅ | ⚠️ wrapper | OpenCode owns state, platform tracks users |
| Message history | ✅ | ⚠️ queries | OpenCode stores, platform may log |
| Git operations | ✅ | ❌ | ripgrep, commit, push all in OpenCode |
| File read/write | ✅ | ❌ | OpenCode controls /workspace directly |
| Bash execution | ✅ | ❌ | Agent's tool, runs in OpenCode context |
| LLM inference | ⚠️ | ✅ | OpenCode calls vLLM, platform configures gateway |
| Policy enforcement | ❌ | ✅ | Platform gates destructive ops via HITL |
| User isolation | ❌ | ✅ | Platform tracks users, workspaces, budgets |
| Tool calling loop | ✅ | ⚠️ mixed | OpenCode native for agents, platform for chat API |
| Audit logging | ❌ | ✅ | Platform SQLite audit.db |
| Skill management | ❌ | ✅ | Platform SkillManager, OpenCode executes |
| Event streaming | ✅ | ⚠️ pass-through | OpenCode SSE, platform relays to clients |
| Provider registry | ⚠️ | ✅ | OpenCode lists, platform aggregates/manages |

---

## 11. Critical Files to Modify When Changing Integration

1. **Adding a new OpenCode endpoint:**
   - Add method to [opencode-client.ts](platform/src/services/opencode-client.ts)
   - Create route in one of `platform/src/server/routes/*.ts`
   - Update vscode-extension or TUI to call the new route

2. **Changing port/URL strategy:**
   - Modify [env.ts](platform/src/config/env.ts) (parsing logic)
   - Update [opencode-process.ts](platform/src/services/opencode-process.ts) (spawn logic)
   - Update docker-compose files, Dockerfile.dev, Dockerfile

3. **Changing auth to OpenCode:**
   - Update [opencode-client.ts](platform/src/services/opencode-client.ts) constructor
   - Add env vars in [env.ts](platform/src/config/env.ts)
   - Update Dockerfile/docker-compose

4. **Adding HITL/policy gates:**
   - Modify [tool-executor.ts](platform/src/services/tool-executor.ts) (not OpenCode delegated)
   - No change needed in OpenCode integration (policy is platform-side)

---

## Conclusion

**OpenCode is the heavyweight execution engine.** The platform is a thin, policy-aware REST gateway that:
- Routes client requests (TUI, extensions) through REST API
- Abstracts OpenCode's session/message model
- Adds user isolation, policy enforcement, audit logging
- Manages skills, budgets, and HITL approvals
- Delegates all file I/O, git ops, bash execution to OpenCode
