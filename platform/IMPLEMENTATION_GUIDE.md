# Artemis Platform — Full Implementation Guide

This document explains what is implemented in the `platform/` folder, how pieces fit together, and why each file exists.

---

## 1) What this platform is

Artemis platform is a **local AI coding backend + CLI/TUI** that wraps a self-hosted OpenCode engine.

High-level runtime:

1. TUI / SDK / REST clients call the Platform API on `:3100`
2. Platform API adds middleware, auth, rate limits, queueing, audit, budgets, workspaces
3. Platform proxies to OpenCode engine on `:4096`
4. OpenCode calls the configured LLM provider (vLLM/OpenAI-compatible)

---

## 2) Top-level folder map (`platform/`)

- `src/` — backend API server, routes, services, SDK, middleware, shared types
- `tui/` — terminal UI client (`bun run tui/src/main.ts`)
- `scripts/` — launch/start orchestration scripts
- `bin/` — global CLI wrapper script (`artemis`)
- `docker/` — Dockerfile + Compose deployment
- `docs/diagrams/` — Mermaid architecture/flow/deployment docs
- `tests/` — integration and unit tests
- `README.md` — full run/deploy/usage docs
- `package.json` — runtime scripts and dependencies for platform package
- `tsconfig.json` — TypeScript config
- `.env` — local environment config (machine-specific)
- `platform.db*` — SQLite runtime artifacts (WAL/SHM files included)
- `.platform/`, `.turbo/`, `node_modules/` — generated/build tooling state

---

## 3) Backend implementation (`src/`)

## 3.1 Server entrypoint

- `src/server/index.ts`
  - **What**: Builds and starts the Hono API server.
  - **Why**: Central app composition point for all middleware/routes/services.
  - **Key behavior**:
    - Instantiates service singletons (OpenCode client, queues, audit, budget, workspace, orchestration, parallel execution)
    - Registers middleware (`logger`, CORS, `rate-limit`, `auth`, audit wrapper)
    - Mounts all route groups
    - Exposes convenience pass-through endpoints (`/api/project`, `/api/config`, `/api/vcs`, `/api/paths`)
    - Hosts a dashboard HTML page at `/`

## 3.2 Route modules (`src/server/routes/`)

- `health.ts`
  - **What**: `GET /health`, `GET /health/ready`
  - **Why**: Liveness/readiness checks for CLI, Docker health checks, and monitoring.

- `sessions.ts`
  - **What**: session + message APIs (`/api/sessions/...`)
  - **Why**: Primary chat/session control surface; maps platform REST to OpenCode endpoints.
  - **Includes**: blocking prompt, async prompt, SSE stream prompt, fork/revert/summarize.

- `providers.ts`
  - **What**: providers, agents, skills, provider auth endpoints
  - **Why**: lets clients inspect model/provider/agent capability and provider credentials.

- `files.ts`
  - **What**: list/read/find/search files
  - **Why**: exposes OpenCode file tools over platform API for TUI/SDK use.

- `events.ts`
  - **What**: SSE bridge at `/api/events`
  - **Why**: streams OpenCode events + queue task updates to clients in real time.

- `tasks.ts`
  - **What**: simple async task queue API (`TaskQueue`)
  - **Why**: basic background jobs layer.

- `audit.ts`
  - **What**: query audit logs and stats
  - **Why**: observability/compliance/debug traceability.

- `budget.ts`
  - **What**: budget check/summary/limits/record usage
  - **Why**: token/request/cost guardrails and governance.

- `workspaces.ts`
  - **What**: create/list/update/switch/delete workspaces
  - **Why**: isolate multiple project roots and active context.

- `orchestrations.ts`
  - **What**: start/list/get/cancel multi-agent orchestration plans
  - **Why**: coordinate dependent subagent tasks.

- `queue.ts`
  - **What**: scalable queue enqueue + metrics + start/stop
  - **Why**: production queue controls and health introspection.

- `parallel.ts`
  - **What**: run/list/get/cancel parallel fan-out/fan-in jobs + progress
  - **Why**: structured concurrency for multi-task execution.

## 3.3 Services (`src/services/`)

- `opencode-client.ts`
  - **What**: typed HTTP/SSE wrapper for OpenCode API
  - **Why**: one adapter layer between platform and OpenCode; keeps route code thin.
  - **Important**: converts platform prompt payload into OpenCode `parts` format.

- `opencode-process.ts`
  - **What**: child-process manager to spawn/monitor/stop OpenCode server
  - **Why**: enables one-command local startup and lifecycle control.
  - **Important**: pre-checks port conflicts, waits for readiness, injects vLLM config.

- `task-queue.ts`
  - **What**: in-memory async queue (simple)
  - **Why**: straightforward background task execution path.

- `scalable-queue.ts`
  - **What**: persistent/retryable/concurrent queue with backpressure
  - **Why**: production-grade queue behavior beyond simple in-memory queue.

- `task-state-tracker.ts`
  - **What**: persistent task FSM + transition validation + progress tracking
  - **Why**: reliable task lifecycle model that survives restarts.

- `audit-logger.ts`
  - **What**: buffered structured audit log in SQLite
  - **Why**: durable event history and request accountability.

- `budget-manager.ts`
  - **What**: usage recording + limit checks per time window
  - **Why**: enforce or warn on budget policies.

- `workspace-manager.ts`
  - **What**: workspace registry/switching + directory validation
  - **Why**: multi-project workflow support.

- `subagent-orchestrator.ts`
  - **What**: dependency-aware subagent orchestration engine
  - **Why**: split larger workflows into role-based subagent tasks.

- `parallel-executor.ts`
  - **What**: fan-out/fan-in DAG execution manager with timeout/progress
  - **Why**: parallelize independent work and aggregate results.

## 3.4 Middleware (`src/middleware/`)

- `auth.ts`
  - **What**: API key auth (Bearer or `x-api-key`)
  - **Why**: optional protection in non-open deployments.

- `rate-limit.ts`
  - **What**: sliding-window per-IP limiter
  - **Why**: abuse protection and request fairness.

- `logger.ts`
  - **What**: request latency/status logs
  - **Why**: operational visibility and debugging.

## 3.5 Config, SDK, and types

- `src/config/env.ts`
  - **What**: zod-validated env schema + defaults
  - **Why**: single source of truth for runtime config.

- `src/sdk/client.ts`
  - **What**: typed SDK client for all platform routes
  - **Why**: stable programmatic API for TUI/tests/external integrations.

- `src/sdk/events.ts`
  - **What**: EventSource helper for SSE stream
  - **Why**: easier event subscription from consumers.

- `src/sdk/index.ts`
  - **What**: SDK barrel exports
  - **Why**: clean import surface.

- `src/types/index.ts`
  - **What**: shared type contracts across backend + SDK + TUI
  - **Why**: type safety and consistent payload schema.

---

## 4) Terminal UI implementation (`tui/`)

## 4.1 TUI architecture

- `tui/src/main.ts`
  - **What**: readline loop, command dispatch, startup flow, prompt rendering loop
  - **Why**: entrypoint and control plane for interactive terminal UX.

- `tui/src/handlers.ts`
  - **What**: command handlers (`/status`, `/sessions`, `/agents`, `/build`, `/plan`, etc.)
  - **Why**: keeps business logic separated from input loop.

- `tui/src/ui.ts`
  - **What**: rendering primitives (panels/tables/spinner/chat markdown formatting)
  - **Why**: reusable, consistent terminal presentation layer.

- `tui/src/theme.ts`
  - **What**: color palette, box drawing chars, layout constants
  - **Why**: centralized visual design system.

- `tui/src/types.d.ts`
  - **What**: custom type declarations for `marked-terminal`
  - **Why**: fixes TS typing gap in third-party package.

## 4.2 TUI package and dependencies

- `tui/package.json`
  - `chalk` for terminal colors
  - `marked` + `marked-terminal` for markdown-to-terminal rendering

---

## 5) Launching, distribution, and deployment

- `scripts/launch.ts`
  - **What**: one-command launcher (`OpenCode -> Platform -> TUI`)
  - **Why**: best DX for local users.

- `scripts/start-all.ts`
  - **What**: starts OpenCode + Platform (headless)
  - **Why**: server/API mode without TUI.

- `scripts/start-opencode.ts`
  - **What**: starts only OpenCode
  - **Why**: split deployment/testing modes.

- `bin/artemis`
  - **What**: shell wrapper exposed as global CLI
  - **Why**: run from anywhere; supports `--headless`, `--tui-only`, default full-stack.

- `docker/Dockerfile`
  - **What**: multi-stage image building OpenCode binary + platform runtime
  - **Why**: portable containerized deployment.

- `docker/docker-compose.yml`
  - **What**: compose service wiring, env pass-through, volumes, healthcheck
  - **Why**: single-command container startup.

- `docs/diagrams/*.md`
  - **What**: Mermaid architecture/request/deployment diagrams
  - **Why**: fast visual onboarding.

---

## 6) Tests

- `tests/integration.test.ts`
  - End-to-end API behavior against running server.

- `tests/opencode-client.test.ts`
  - Unit tests for OpenCode client with mocked fetch.

- `tests/task-queue.test.ts`
  - Unit tests for queue logic and state transitions.

---

## 7) Config/build metadata

- `package.json`
  - scripts: `start`, `start:all`, `launch`, `tui`, `test`, `typecheck`
  - dependencies: `hono`, `zod`, `ulid`, `remeda`

- `tsconfig.json`
  - strict TS, Bun types, bundler module resolution
  - includes `src`, `tests`, `scripts`, `tui`

---

## 8) What was developed by me (in our sessions)

Based on the implemented code and recent changes, these are the major pieces I added/iterated:

1. **Modular TUI architecture** (`main.ts`, `handlers.ts`, `ui.ts`, `theme.ts`)
2. **TUI reliability fixes**
   - input echo / prompt handling
   - async command handling and non-crashing error boundaries
   - spinner line erase behavior
3. **Markdown rendering fix** in `tui/src/ui.ts`
   - switched to correct `marked-terminal` usage
   - removed raw HTML/entity artifacts from output
4. **OpenCode agent integration in TUI**
   - `/agents`, `/build`, `/plan`, `/explore`, `/docs`
   - active agent state and prompt display
   - prompt/session forwarding with `agentID`
5. **Launcher and distribution flow**
   - `scripts/launch.ts`
   - `bin/artemis`
6. **Docker packaging and compose setup**
7. **Documentation enhancements**
   - detailed `platform/README.md`
   - 3 Mermaid diagrams in `docs/diagrams/`

---

## 9) Why this structure works well

- **Separation of concerns**: routes are thin, services hold logic, SDK is typed, TUI is modular.
- **Production-readiness**: audit + budget + persistent task state + scalable queue.
- **Developer ergonomics**: one-command launch, clear scripts, visual TUI, complete README.
- **Extensibility**: easy to add new route/service/command without rewriting core layers.

---

## 10) Quick mental model

If you remember only this:

- `src/server/index.ts` = API assembly
- `src/services/*` = core platform capabilities
- `src/server/routes/*` = HTTP surface
- `src/sdk/*` = typed client surface
- `tui/src/*` = human-facing CLI UX
- `scripts/*` + `bin/artemis` = startup/distribution
- `docker/*` = container deployment
