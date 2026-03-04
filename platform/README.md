# Artemis AI Coding Platform

**Your own AI coding assistant — local, private, one command.**

Artemis wraps a self-hosted [OpenCode](https://opencode.ai) engine with a production backend and a beautiful terminal UI. Point it at any OpenAI-compatible LLM (vLLM, Ollama, etc.) and start coding with AI — no cloud API keys required.

```
┌─────────────────────────────────────────────────────────────┐
│  artemis                                                  │
│                                                             │
│    ◆ Artemis   AI Coding Platform — Terminal Client       │
│    ─────────────────────────────────────────────────────     │
│    ● Platform   connected                                   │
│    ● OpenCode   connected                                   │
│    ● vLLM       MiniMax M2.1 REAP 50 W4A16                 │
│                                                             │
│  ❯ ses_352e ❯ Find the bug in src/handler.ts                │
└─────────────────────────────────────────────────────────────┘
```

> **Diagrams:** See [docs/diagrams/](docs/diagrams/) for architecture, request flow, and deployment workflow diagrams.

---

## Table of Contents

1. [Run Locally (Developer)](#part-1-run-locally-developer)
2. [For Users (Global Distribution)](#part-2-for-users-global-distribution)
3. [Docker Deployment](#part-3-docker-deployment)
4. [TUI Commands Reference](#tui-commands-reference)
5. [Configuration](#configuration)
6. [Architecture](#architecture)
7. [SDK & API Reference](#sdk--api-reference)
8. [Project Structure](#project-structure)

---

## Part 1: Run Locally (Developer)

Step-by-step guide to run Artemis on your own machine.

### Prerequisites

| Tool | Min Version | Why |
|------|-------------|-----|
| [Bun](https://bun.sh/) | 1.3+ | Runtime for backend & TUI |
| Git | any | Clone the repo |
| LLM server | any | vLLM, Ollama, or any OpenAI-compatible endpoint |

### Step 1 — Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc   # or restart your terminal
bun --version      # should show 1.3.x or higher
```

### Step 2 — Clone the repository

```bash
git clone https://github.com/sst/opencode.git artemis
cd artemis
```

### Step 3 — Install dependencies

```bash
# Root monorepo deps (needed for building OpenCode)
bun install

# Platform deps
cd platform
bun install

# TUI deps
cd tui && bun install && cd ..
```

### Step 4 — Build the OpenCode engine

```bash
cd ../packages/opencode
bun run build -- --single --skip-install
```

This compiles a native binary for your platform (~150 MB). Then link it:

```bash
mkdir -p ~/.local/bin
# For Linux arm64 (e.g., NVIDIA Jetson, AWS Graviton):
ln -sf "$(pwd)/dist/opencode-linux-arm64/bin/opencode" ~/.local/bin/opencode

# For Linux x64:
# ln -sf "$(pwd)/dist/opencode-linux-x64/bin/opencode" ~/.local/bin/opencode

# For macOS arm64:
# ln -sf "$(pwd)/dist/opencode-darwin-arm64/bin/opencode" ~/.local/bin/opencode

# Ensure it's in PATH
export PATH="$HOME/.local/bin:$PATH"
opencode --version
```

### Step 5 — Configure your LLM

```bash
cd ../../platform
cp .env.example .env
```

Edit `platform/.env` and set your LLM endpoint:

```bash
# Example for vLLM:
VLLM_BASE_URL=http://192.168.1.100:8000/v1
VLLM_API_KEY=your-api-key
VLLM_MODEL_ID=your-org/your-model
VLLM_MODEL_NAME=Your Model Name

# Example for Ollama (running locally):
# VLLM_BASE_URL=http://127.0.0.1:11434/v1
# VLLM_API_KEY=ollama
# VLLM_MODEL_ID=qwen2.5-coder:32b
# VLLM_MODEL_NAME=Qwen 2.5 Coder 32B
```

### Step 6 — Launch!

```bash
# Option A: Full stack in one command (recommended)
bun run launch

# Option B: Headless backend only (no TUI)
bun run start:all

# Option C: Just the TUI (connecting to existing backend)
bun run tui
```

### Step 7 — Verify it works

Once started, you should see:

```
  ╔══════════════════════════════════════════╗
  ║   ◆  A R T E M I S                  ║
  ╚══════════════════════════════════════════╝

  [launch]  OpenCode ready → http://127.0.0.1:4096
  [launch]  Platform ready → http://0.0.0.0:3100
  [launch]  Starting TUI...

    ◆ Artemis    AI Coding Platform — Terminal Client
    ● Platform   connected
    ● OpenCode   connected
```

Type any text to send a prompt to your LLM. Type `/help` for all commands.

---

## Part 2: For Users (Global Distribution)

How **other people** can install and use Artemis with a single command.

### Option A: One-line install (recommended)

```bash
git clone https://github.com/sst/opencode.git artemis
cd artemis
bash install.sh
```

The install script automatically:
1. Installs Bun (if not present)
2. Installs all dependencies
3. Builds the OpenCode engine from source
4. Links the `artemis` CLI to `~/.local/bin`
5. Adds PATH entries to `.bashrc` / `.zshrc`

After install, users just edit one file and run one command:

```bash
# Edit the config (set your LLM endpoint)
nano platform/.env

# Run!
artemis
```

### Option B: Docker (zero dependencies)

Users who have Docker don't need Bun at all:

```bash
git clone https://github.com/sst/opencode.git artemis
cd artemis

# Start the headless backend in Docker
cd platform/docker
VLLM_BASE_URL=http://your-gpu-server:8000/v1 docker compose up --build -d

# Connect TUI locally (needs Bun and TUI deps)
cd ../..
ARTEMIS_URL=http://localhost:3100 bun run platform/tui/src/main.ts
```

### Launch modes

| Command | What it does |
|---------|-------------|
| `artemis` | Full stack: OpenCode + Backend + TUI |
| `artemis --headless` | Backend only (no TUI) — for API/SDK/Docker use |
| `artemis --tui-only` | Connect TUI to an already-running backend |

### Using Artemis as an Agent

Artemis can act as a **fully autonomous AI coding agent**. From the TUI:

1. **Start a session**: Run `artemis` — a session is auto-created
2. **Give it a task**: Type `Refactor the auth module to use JWT tokens` and press Enter
3. **Watch it work**: The AI reads your files, writes code, runs tests — all locally
4. **Multi-agent mode**: Use `/orchestrate` to run complex DAG workflows:
   - Task 1: "Analyze the codebase structure"
   - Task 2 (depends on Task 1): "Generate unit tests"
   - Task 3 (depends on Task 1): "Write API documentation"
5. **Parallel execution**: Use `/parallel` to fan-out tasks across multiple AI workers simultaneously
6. **Budget control**: Use `/budget set 100000` to limit token usage per hour
7. **Audit trail**: Use `/audit` to see every action the agent has taken

### Sharing with a team

Run the backend on a shared server:

```bash
# On the server (start headless)
artemis --headless
# Or with Docker:
docker compose up -d
```

Team members connect their TUIs:

```bash
# On each developer's machine
ARTEMIS_URL=http://team-server:3100 artemis --tui-only
```

---

## Part 3: Docker Deployment

### Build and run

```bash
cd platform/docker
docker compose up --build
```

### With environment variables

```bash
VLLM_BASE_URL=http://gpu-server:8000/v1 \
VLLM_API_KEY=sk-... \
VLLM_MODEL_ID=meta-llama/Llama-4-Scout-17B-16E \
VLLM_MODEL_NAME="Llama 4 Scout" \
docker compose up --build
```

### Using a `.env` file

```bash
cd platform/docker
cp ../platform/.env.example .env
nano .env    # Edit your settings
docker compose up --build
```

### Docker architecture

```
┌─── Docker Container ─────────────────────────────┐
│                                                   │
│  ┌─ OpenCode Engine (:4096) ─┐                    │
│  │  Sessions · Agents · LLM  │                    │
│  └────────────────────────────┘                   │
│                  ↑                                │
│  ┌─ Platform Backend (:3100) ┐                    │
│  │  7 services · REST · SSE  │                    │
│  └────────────────────────────┘                   │
│                                                   │
│  Ports: 3100 (API), 4096 (OpenCode)              │
│  Volume: /workspace → your project               │
│  Volume: opencode-state → persistent data         │
└───────────────────────────────────────────────────┘
         ↕                        ↕
    User's TUI              vLLM / Ollama
  (artemis --tui-only)    (GPU server)
```

### Docker healthcheck

The container has a built-in healthcheck at `GET /health/ready`:

```bash
docker inspect --format='{{.State.Health.Status}}' artemis
# → "healthy"
```

---

## TUI Commands Reference

Once inside the TUI, type any text to send a prompt to your LLM, or use commands:

### Session & Chat
| Command | Alias | Description |
|---------|-------|-------------|
| `/new` | — | Create a new conversation session |
| `/sessions` | `/ls` | List all sessions |
| `/switch <id>` | `/sw` | Switch to a session (use 8-char prefix) |
| `/delete <id>` | `/del` | Delete a session |
| `/history` | `/h` | Show conversation history |
| `/status` | `/st` | Platform health & model info |
| `/providers` | `/models` | List LLM providers and models |
| `/files` | — | List project files |
| `/project` | — | Project directory info |
| `/vcs` | `/git` | Current git branch |
| `/tasks` | — | Background task queue |

### Backend Features
| Command | Description |
|---------|-------------|
| `/audit` | Recent audit log entries |
| `/audit stats` | Aggregate audit statistics |
| `/budget` | Token/request usage summary |
| `/budget check` | Check if budget permits requests |
| `/budget set <n>` | Set hourly token limit |
| `/workspaces` | List workspaces |
| `/workspace new` | Create a workspace (interactive) |
| `/workspace switch` | Switch active workspace |
| `/queue` | Queue worker metrics |
| `/orchestrate` | Multi-agent DAG orchestration (interactive) |
| `/orchestrations` | List running orchestrations |
| `/parallel` | Fan-out parallel execution (interactive) |
| `/parallel list` | List parallel executions |

### General
| Command | Description |
|---------|-------------|
| `/clear` | Clear terminal |
| `/help` | Show all commands |
| `/quit` | Exit |

### Tab completion

Press `Tab` to auto-complete any command. All commands are discoverable.

---

## Configuration

All config lives in `platform/.env`. Key settings:

```bash
# ── Your LLM server ─────────────────────────────────
# Any OpenAI-compatible endpoint: vLLM, Ollama, LiteLLM, etc.
VLLM_BASE_URL=http://YOUR_HOST:8000/v1
VLLM_API_KEY=your-api-key
VLLM_MODEL_ID=your-org/your-model
VLLM_MODEL_NAME=Your Model Name
VLLM_CONTEXT_LIMIT=30000    # Max input tokens
VLLM_OUTPUT_LIMIT=4096      # Max output tokens

# ── Platform ports ───────────────────────────────────
PORT=3100                           # Backend API
OPENCODE_URL=http://127.0.0.1:4096  # OpenCode engine

# ── Optional: auth ───────────────────────────────────
PLATFORM_API_KEY=your-secret-key    # Protect the API
LOG_LEVEL=info                      # debug | info | warn | error
```

### LLM provider examples

**vLLM on a GPU server:**
```bash
VLLM_BASE_URL=http://192.168.1.100:8000/v1
VLLM_API_KEY=vllm-your-key
VLLM_MODEL_ID=plezan/MiniMax-M2.1-REAP-50-W4A16
VLLM_MODEL_NAME=MiniMax M2.1 REAP
```

**Ollama (local):**
```bash
VLLM_BASE_URL=http://127.0.0.1:11434/v1
VLLM_API_KEY=ollama
VLLM_MODEL_ID=qwen2.5-coder:32b
VLLM_MODEL_NAME=Qwen 2.5 Coder 32B
```

**OpenAI (cloud):**
```bash
VLLM_BASE_URL=https://api.openai.com/v1
VLLM_API_KEY=sk-...
VLLM_MODEL_ID=gpt-4o
VLLM_MODEL_NAME=GPT-4o
```

---

## Architecture

```
  User → artemis CLI
           │
           ├─→ OpenCode Engine (:4096)     # AI agent runtime
           │      Sessions · Agents · Tools · MCP · LSP
           │      File ops · Shell · VCS · Snapshots
           │
           ├─→ Platform Backend (:3100)    # Production API layer
           │      7 services: audit, budget, workspaces,
           │      orchestrator, queue, parallel, tasks
           │      SDK · REST API · SSE events
           │
           └─→ Terminal UI                 # Interactive TUI
                  Markdown rendering · Tab completion
                  Session management · Command palette
```

See [docs/diagrams/](docs/diagrams/) for full Mermaid diagrams:
- **01-system-architecture.md** — Component overview
- **02-request-flow.md** — Sequence diagram: startup & chat flow
- **03-deployment-workflow.md** — Install → Run → Deploy pipeline

---

## SDK & API Reference

### Using the SDK

Connect from any TypeScript/JavaScript application:

```typescript
import { PlatformClient } from "@artemis/platform/sdk"

const client = new PlatformClient({
  baseUrl: "http://localhost:3100",
})

// Create a session and prompt
const session = await client.createSession({ title: "Fix bug #42" })
const response = await client.prompt(session.id, {
  content: "Find and fix the null pointer exception in src/handler.ts",
})
console.log(response)

// Multi-agent orchestration
const orch = await client.startOrchestration({
  name: "Refactor auth",
  tasks: [
    { label: "analyze", prompt: "Analyze the current auth module" },
    { label: "refactor", prompt: "Refactor to JWT", dependsOn: ["analyze"] },
    { label: "test", prompt: "Write unit tests", dependsOn: ["refactor"] },
  ],
})
```

### REST API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Platform + OpenCode status |
| GET | `/health/ready` | Readiness probe |
| GET | `/api/sessions` | List sessions |
| POST | `/api/sessions` | Create session |
| POST | `/api/sessions/:id/messages` | Send prompt |
| POST | `/api/sessions/:id/messages/stream` | Stream prompt (SSE) |
| GET | `/api/audit` | Audit log entries |
| GET | `/api/budget` | Budget/quota status |
| GET | `/api/workspaces` | List workspaces |
| GET | `/api/orchestrations` | List orchestrations |
| POST | `/api/orchestrations` | Start orchestration |
| GET | `/api/queue/metrics` | Queue metrics |
| GET | `/api/parallel` | List parallel executions |
| POST | `/api/parallel` | Start parallel execution |
| GET | `/api/providers` | LLM providers & models |
| GET | `/api/files` | File browser |
| GET | `/api/events` | SSE event stream |

---

## Project Structure

```
platform/
├── bin/artemis             # CLI entry point (run from anywhere)
├── scripts/
│   ├── launch.ts             # Unified launcher (OpenCode + Backend + TUI)
│   ├── start-all.ts          # OpenCode + Backend (headless)
│   └── start-opencode.ts     # OpenCode only
├── src/
│   ├── server/index.ts       # Hono server with all routes
│   ├── server/routes/        # REST endpoints
│   ├── services/             # 7 production services
│   │   ├── audit-logger.ts
│   │   ├── budget-manager.ts
│   │   ├── workspace-manager.ts
│   │   ├── subagent-orchestrator.ts
│   │   ├── scalable-queue.ts
│   │   ├── parallel-executor.ts
│   │   └── task-state-tracker.ts
│   ├── sdk/client.ts         # TypeScript SDK
│   ├── config/env.ts         # Zod-validated config
│   └── middleware/           # Auth, logging, rate-limit
├── tui/
│   ├── src/main.ts           # TUI entry point
│   ├── src/theme.ts          # Colors & box drawing
│   ├── src/ui.ts             # Rendering primitives
│   └── src/handlers.ts       # 23 command handlers
├── docker/
│   ├── Dockerfile            # Multi-stage production build
│   └── docker-compose.yml    # Full stack compose
├── docs/diagrams/            # Architecture diagrams (Mermaid)
├── tests/                    # Unit & integration tests
├── .env.example              # Config template
└── package.json
```

## Requirements

- **Bun** ≥ 1.3 — [install](https://bun.sh/)
- **LLM server** — Any OpenAI-compatible endpoint (vLLM, Ollama, LiteLLM, OpenAI, etc.)
- **Linux** (arm64 or x64) or **macOS** — Windows via WSL

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `bun: not found` | Run `export PATH="$HOME/.bun/bin:$PATH"` or restart terminal |
| `opencode: not found` | Build it: `cd packages/opencode && bun run build -- --single` |
| `vLLM not reachable` | Check `VLLM_BASE_URL` in `.env` — is the server running? |
| `Cannot reach platform` | Make sure port 3100 is free: `lsof -i :3100` |
| `Session creation fails` | Check OpenCode is running: `curl http://localhost:4096` |
| Docker build fails | Ensure `.dockerignore` exists in repo root |

## License

MIT
