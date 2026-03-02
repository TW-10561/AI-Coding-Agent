# Kadavuley AI Coding Platform

Production AI coding platform built on a self-hosted [OpenCode](https://opencode.ai) engine with a slim backend and standalone SDK.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Your Application                        │
│              (Web UI / CLI / CI pipeline / API)               │
└───────────────────────┬──────────────────────────────────────┘
                        │  SDK  (@kadavuley/platform/sdk)
                        ▼
┌──────────────────────────────────────────────────────────────┐
│               Platform Backend  (:3100)                      │
│                                                              │
│   ┌──────────────┐  ┌───────────┐  ┌──────────────────┐     │
│   │   Auth MW     │  │  Rate MW  │  │   Logger MW      │     │
│   └──────────────┘  └───────────┘  └──────────────────┘     │
│                                                              │
│   /api/sessions   — session + message CRUD & streaming       │
│   /api/tasks      — async job queue (enqueue, track, abort)  │
│   /api/providers  — list models, agents, set auth            │
│   /api/files      — browse, read, search project files       │
│   /api/events     — SSE stream (OpenCode events + tasks)     │
│   /api/config     — read/write OpenCode config               │
│   /api/project    — project info                             │
│   /api/vcs        — git branch info                          │
│   /health         — platform + engine health/readiness       │
│                                                              │
└───────────────────────┬──────────────────────────────────────┘
                        │  HTTP (localhost:4096)
                        ▼
┌──────────────────────────────────────────────────────────────┐
│             Self-Hosted OpenCode Engine (:4096)               │
│                                                              │
│   Sessions  ·  Agents  ·  Tools  ·  MCP  ·  LSP             │
│   Providers (Anthropic, OpenAI, OpenRouter, …)               │
│   File ops  ·  Shell  ·  VCS  ·  Snapshots                  │
│   SQLite storage  ·  Bus events (SSE)                        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Prerequisites

- [Bun](https://bun.sh/) ≥ 1.3
- [OpenCode](https://opencode.ai) installed (`npm i -g opencode-ai`)
- An LLM API key (Anthropic, OpenAI, or OpenRouter)

### 2. Start the OpenCode engine

```bash
# In your project directory:
opencode serve --hostname=127.0.0.1 --port=4096
```

### 3. Start the platform

```bash
cd platform
cp .env.example .env
# Edit .env to set your ANTHROPIC_API_KEY, OPENCODE_DIR, etc.

bun install
bun run dev          # http://localhost:3100
```

Or start both together:

```bash
bun run start:all    # launches OpenCode + Platform
```

### 4. Use the SDK

```typescript
import { PlatformClient } from "@kadavuley/platform/sdk"

const client = new PlatformClient({
  baseUrl: "http://localhost:3100",
  apiKey: "your-platform-key",  // optional in dev
})

// Create a session and prompt
const session = await client.createSession({ title: "Fix bug #42" })
const response = await client.prompt(session.id, {
  content: "Find and fix the null pointer exception in src/handler.ts",
})
console.log(response)

// Or fire-and-forget with task queue
const task = await client.enqueueTask({
  prompt: "Refactor the auth module to use JWT",
  directory: "/path/to/project",
})
console.log(task.id, task.status) // "queued"
```

### 5. Stream events

```typescript
import { PlatformEventSource } from "@kadavuley/platform/sdk"

const events = new PlatformEventSource("http://localhost:3100")
events.on("session.updated", (e) => console.log("Session:", e))
events.on("task.updated", (e) => console.log("Task:", e))
events.onAny((e) => console.log(e.type))
```

## Docker

```bash
# Build and run
cd platform/docker
docker compose up --build

# Or with env vars
ANTHROPIC_API_KEY=sk-ant-... PROJECT_DIR=/my/code docker compose up
```

## API Reference

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Platform + OpenCode status |
| GET | `/health/ready` | Readiness probe |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | List sessions |
| POST | `/api/sessions` | Create session |
| GET | `/api/sessions/:id` | Get session |
| DELETE | `/api/sessions/:id` | Delete session |
| POST | `/api/sessions/:id/abort` | Abort session |
| POST | `/api/sessions/:id/fork` | Fork session |
| POST | `/api/sessions/:id/summarize` | Compact/summarize |
| GET | `/api/sessions/:id/messages` | List messages |
| POST | `/api/sessions/:id/messages` | Send prompt (blocking) |
| POST | `/api/sessions/:id/messages/async` | Send prompt (fire-and-forget) |
| POST | `/api/sessions/:id/messages/stream` | Send prompt (SSE stream) |
| DELETE | `/api/sessions/:id/messages/:mid` | Delete message |
| POST | `/api/sessions/:id/revert` | Revert last message |
| POST | `/api/sessions/:id/unrevert` | Undo revert |

### Tasks (Job Queue)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tasks` | Enqueue coding task |
| GET | `/api/tasks` | List tasks |
| GET | `/api/tasks/:id` | Get task |
| POST | `/api/tasks/:id/abort` | Abort task |

### Providers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/providers` | List providers + models |
| GET | `/api/providers/agents` | List agents |
| GET | `/api/providers/skills` | List skills |
| PUT | `/api/providers/auth/:id` | Set provider auth |
| DELETE | `/api/providers/auth/:id` | Remove provider auth |

### Files

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/files` | List directory |
| GET | `/api/files/content?path=...` | Read file |
| GET | `/api/files/status` | Git status |
| GET | `/api/files/find?q=...` | Find files by name |
| GET | `/api/files/search?q=...` | Grep text search |

### Events

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/events` | SSE event stream |

### Other

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/project` | Current project |
| GET | `/api/config` | Get config |
| PATCH | `/api/config` | Update config |
| GET | `/api/vcs` | Git branch info |

## Project Structure

```
platform/
├── src/
│   ├── server/
│   │   ├── index.ts              # Hono server entry — assembles routes + middleware
│   │   └── routes/
│   │       ├── health.ts         # /health, /health/ready
│   │       ├── sessions.ts       # /api/sessions (CRUD + prompt + stream)
│   │       ├── tasks.ts          # /api/tasks (job queue)
│   │       ├── providers.ts      # /api/providers
│   │       ├── files.ts          # /api/files
│   │       └── events.ts         # /api/events (SSE)
│   ├── sdk/
│   │   ├── index.ts              # SDK public exports
│   │   ├── client.ts             # PlatformClient — typed HTTP client
│   │   └── events.ts             # PlatformEventSource — SSE helper
│   ├── services/
│   │   ├── opencode-client.ts    # Low-level OpenCode HTTP client
│   │   ├── opencode-process.ts   # Spawn/manage OpenCode child process
│   │   └── task-queue.ts         # In-memory async job queue
│   ├── middleware/
│   │   ├── auth.ts               # API key / JWT validation
│   │   ├── logger.ts             # Request logging
│   │   └── rate-limit.ts         # Sliding-window rate limiter
│   ├── config/
│   │   └── env.ts                # Zod-validated environment config
│   └── types/
│       └── index.ts              # Shared TypeScript types
├── tests/
│   ├── integration.test.ts       # End-to-end tests (needs running server)
│   ├── task-queue.test.ts        # Unit tests for task queue
│   └── opencode-client.test.ts   # Unit tests for OpenCode client
├── scripts/
│   ├── start-all.ts              # Launch OpenCode + Platform together
│   └── start-opencode.ts         # Launch just OpenCode
├── docker/
│   ├── Dockerfile                # Multi-stage production build
│   └── docker-compose.yml        # Full stack compose
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

## Testing

```bash
# Unit tests (no server needed)
bun test tests/task-queue.test.ts
bun test tests/opencode-client.test.ts

# Integration tests (start platform first)
bun run dev &
PLATFORM_URL=http://localhost:3100 bun test tests/integration.test.ts
```

## License

MIT
