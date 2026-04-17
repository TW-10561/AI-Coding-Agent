# Thirdwave AI Platform — Beginner Setup Guide

> **What is this?** This guide explains Phase 1 (PostgreSQL database) and Phase 2
> (standalone mode + data migration) of the Thirdwave AI Coding Platform in
> plain language. No prior database or DevOps knowledge is assumed.

---

## Table of Contents

1. [What Was Built](#1-what-was-built)
2. [Prerequisites](#2-prerequisites)
3. [Quick Start (5 minutes)](#3-quick-start-5-minutes)
4. [Step-by-Step Setup](#4-step-by-step-setup)
5. [How Everything Connects](#5-how-everything-connects)
6. [Configuration Reference](#6-configuration-reference)
7. [Testing](#7-testing)
8. [Common Issues & Fixes](#8-common-issues--fixes)
9. [Glossary](#9-glossary)

---

## 1. What Was Built

### Phase 1 — PostgreSQL Database

Previously, data was stored in **SQLite** — a simple file-based database. That's
fine for a single user, but has limits when multiple users or services need to
access data at the same time.

**Phase 1 added:**
- A **PostgreSQL** database (a production-grade database server)
- **PgBouncer** (a connection pooler that handles many simultaneous connections)
- **19 database tables** that store everything: users, roles, API keys, audit logs,
  workspaces, sessions, messages, tasks, budgets, and more
- **Default seed data**: 4 roles (admin, developer, team_leader, readonly),
  17 tools (bash, read, write, etc.), and 68 access control policies

### Phase 2 — Standalone Mode + Data Migration

Previously, the platform depended on an external tool called **OpenCode** to talk
to AI models. Phase 2 removed that dependency.

**Phase 2 added:**
- **AgentExecutor** — a built-in AI engine that handles the prompt → LLM → tools → response loop
- **LLM Client** — connects directly to AI providers (Anthropic, Google, OpenAI, local vLLM, etc.)
- **Dual-write pattern** — data is written to SQLite (for backward compatibility) AND
  PostgreSQL (for the future). If PostgreSQL is down, everything still works.
- **Migration script** — moves existing SQLite data into PostgreSQL
- All routes rewritten to work without OpenCode

---

## 2. Prerequisites

| What | Why | Install |
|------|-----|---------|
| **Bun** (v1.3+) | JavaScript/TypeScript runtime | `curl -fsSL https://bun.sh/install \| bash` |
| **Docker** + **Docker Compose** | Runs PostgreSQL & PgBouncer | [docs.docker.com/get-docker](https://docs.docker.com/get-docker/) |
| **Git** | Version control | Usually pre-installed on Linux/Mac |

**Optional** (for AI features):
- An API key from Anthropic, Google, OpenAI, etc. — OR
- A local vLLM server running

---

## 3. Quick Start (5 minutes)

```bash
# 1. Clone and enter the project
cd AI-Coding-Agent/platform

# 2. Install dependencies
bun install

# 3. Start PostgreSQL + PgBouncer (runs in background)
cd docker && docker compose up -d && cd ..

# 4. Set the database URL
export POSTGRES_URL="postgresql://thirdwave:thirdwave_secret@localhost:5432/thirdwave"

# 5. Start the platform
bun run dev
```

Open http://localhost:3100 in your browser. You should see the Thirdwave dashboard.

**To verify the database is working:**
```bash
curl http://localhost:3100/health/db
# Should show: { "status": "ok", "tables": 19, ... }
```

---

## 4. Step-by-Step Setup

### Step 1: Install Dependencies

```bash
cd AI-Coding-Agent/platform
bun install
```

This installs all packages listed in `package.json`, including:
- `hono` — the web framework (like Express, but faster)
- `postgres` — the PostgreSQL driver for connecting to the database
- `zod` — validates data shapes (prevents garbage from entering your system)
- `ulid` — generates unique IDs

### Step 2: Start the Database

```bash
cd docker
docker compose up -d
```

**What happens behind the scenes:**
1. Docker downloads `postgres:16-alpine` (a small PostgreSQL image)
2. Docker downloads `pgbouncer` (connection pooler)
3. PostgreSQL starts and automatically runs:
   - `schema.sql` → creates all 19 tables (users, roles, sessions, etc.)
   - `seed.sql` → inserts default roles, tools, and access policies
4. PgBouncer starts and connects to PostgreSQL

**Check that it's running:**
```bash
docker compose ps
# Should show: thirdwave-postgres (healthy), thirdwave-pgbouncer (running)
```

### Step 3: Configure Environment Variables

Create a `.env` file in the `platform/` directory (or export these variables):

```bash
# Required for PostgreSQL
POSTGRES_URL="postgresql://thirdwave:thirdwave_secret@localhost:5432/thirdwave"

# Optional: use PgBouncer instead (recommended for production)
# PGBOUNCER_URL="postgresql://thirdwave:thirdwave_secret@localhost:6432/thirdwave"

# Optional: AI provider API keys (add any you have)
# ANTHROPIC_API_KEY="sk-ant-..."
# GOOGLE_AI_API_KEY="..."
# OPENAI_API_KEY="sk-..."

# Optional: local vLLM server
# VLLM_BASE_URL="http://localhost:8000/v1"
# VLLM_API_KEY="your-key"
```

**Understanding the variables:**
| Variable | What it does | Required? |
|----------|--------------|-----------|
| `POSTGRES_URL` | Connects to PostgreSQL directly | Yes (for database features) |
| `PGBOUNCER_URL` | Connects through PgBouncer (better for many connections) | Optional |
| `PORT` | Which port the platform runs on (default: 3100) | No |
| `ANTHROPIC_API_KEY` | Enables Claude AI models | No |
| `GOOGLE_AI_API_KEY` | Enables Gemini AI models | No |
| `OPENAI_API_KEY` | Enables GPT models | No |
| `VLLM_BASE_URL` | Points to your local vLLM server | No |

### Step 4: Start the Platform

```bash
bun run dev
```

This starts the platform in development mode with auto-reload. You'll see:
```
[skills] Loaded X skills
[policies] Security policy engine initialized
[hitl] Human-in-the-Loop service initialized
Platform listening on http://0.0.0.0:3100
```

### Step 5: Verify Everything Works

```bash
# Check platform health
curl http://localhost:3100/health
# → { "platform": "ok", "opencode": "standalone", "uptime": ..., "version": "..." }

# Check database
curl http://localhost:3100/health/db
# → { "status": "ok", "tables": 19, "latencyMs": ... }

# Check readiness
curl http://localhost:3100/health/ready
# → { "ready": true, "standalone": true }
```

---

## 5. How Everything Connects

```
┌──────────────────────────────────────────────────────┐
│                  Your Browser / API Client            │
│                  http://localhost:3100                 │
└─────────────────────────┬────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────┐
│               Thirdwave Platform (Bun + Hono)        │
│                                                      │
│  Routes:                Services:                    │
│  /health    ───►  healthRoutes()                     │
│  /api/sessions ► sessionRoutes()  ──► AgentExecutor  │
│  /api/tasks    ► taskRoutes()     ──► ScalableQueue  │
│  /api/files    ► fileRoutes()     (local filesystem) │
│  /api/audit    ► auditRoutes()    ──► AuditLogger    │
│  /api/budget   ► budgetRoutes()   ──► BudgetManager  │
│  /api/workspaces► workspaceRoutes()► WorkspaceMgr    │
│                                                      │
│  Middleware: auth → rate-limit → audit-logging        │
└─────────┬──────────────────┬─────────────────────────┘
          │                  │
          ▼                  ▼
┌──────────────┐   ┌──────────────────────────────────┐
│   SQLite     │   │  PostgreSQL (via PgBouncer)       │
│  (.platform/ │   │  thirdwave database               │
│   directory) │   │  19 tables                        │
│              │   │  Port 5432 (direct)               │
│  Primary     │   │  Port 6432 (pooled)               │
│  (always on) │   │                                   │
└──────────────┘   │  Mirror (when POSTGRES_URL is set)│
                   └──────────────────────────────────┘
```

### The Dual-Write Pattern Explained

Every service writes to **two databases**:

1. **SQLite** (always) — small files in `.platform/` directory, works offline
2. **PostgreSQL** (when configured) — full-scale database, works for teams

```
    Your Action          SQLite             PostgreSQL
    ───────────          ──────             ──────────
    Create workspace  →  INSERT (sync)   →  INSERT (async, fire-and-forget)
    Log audit event   →  INSERT (sync)   →  INSERT (async, fire-and-forget)
    Record budget     →  INSERT (sync)   →  INSERT (async, fire-and-forget)
```

If PostgreSQL is down:
- SQLite still works normally ✓
- PG writes fail silently (console.warn) ✓
- No data loss — you can re-sync later with the migration script ✓

### The AgentExecutor Pipeline

When you send a prompt to the platform:

```
1. You send: POST /api/sessions/:id/messages { content: "Fix the bug" }
2. AgentExecutor.run() starts:
   a. Resolves which AI model to use (local vLLM or cloud)
   b. Sends your prompt + system instructions to the LLM
   c. LLM responds (possibly with tool calls like "read file X")
   d. Tool calls are executed locally
   e. Results are sent back to the LLM
   f. Loop continues until LLM gives a final answer (max 25 rounds)
3. Response returned to you with: text, model used, token counts, tool calls made
```

---

## 6. Configuration Reference

### Database Files

| File | Location | Purpose |
|------|----------|---------|
| `src/config/schema.sql` | Auto-loaded by Docker | Defines all 19 PostgreSQL tables |
| `src/config/seed.sql` | Auto-loaded by Docker | Inserts default roles, tools, policies |
| `src/config/db.ts` | Loaded at startup | PostgreSQL connection pool (max 20 connections) |
| `src/config/env.ts` | Loaded at startup | All environment variable definitions |

### Docker Services

| Service | Container Name | Port | Purpose |
|---------|---------------|------|---------|
| PostgreSQL | thirdwave-postgres | 5432 | Main database |
| PgBouncer | thirdwave-pgbouncer | 6432 | Connection pooler |

### SQLite Databases (in `.platform/` directory)

| File | Service | What it stores |
|------|---------|---------------|
| `workspaces.db` | WorkspaceManager | Project directories and metadata |
| `audit.db` | AuditLogger | All platform activity logs |
| `budget.db` | BudgetManager | Token/request budgets and usage |
| `chat-log.db` | ChatLogStore | Chat sessions and messages |
| `tasks.db` | TaskStateTracker | Task queue state and history |

---

## 7. Testing

### Run All Tests

```bash
cd AI-Coding-Agent/platform

# Run just the Phase 1 + Phase 2 tests (no server needed)
bun test tests/phase1-phase2.test.ts

# Run all unit tests
bun test tests/hitl.test.ts tests/task-queue.test.ts tests/workspace-file-handling.test.ts tests/phase1-phase2.test.ts

# Run integration tests (requires running server)
bun run dev &   # Start server in background first
bun test tests/integration.test.ts

# Type check (no runtime needed)
npx tsc --noEmit
```

### What the Tests Cover

| Test File | Tests | What it verifies |
|-----------|-------|-----------------|
| `phase1-phase2.test.ts` | 97 | PostgreSQL config, all 5 services, OpenCode removal, routes, types |
| `hitl.test.ts` | 90+ | Security modules (RBAC, risk engine, sandbox, audit) |
| `task-queue.test.ts` | 4 | Task enqueue/list/abort with AgentExecutor mock |
| `workspace-file-handling.test.ts` | 20+ | File operations, log format, workspace isolation |
| `integration.test.ts` | 15 | End-to-end API tests (needs running server) |

---

## 8. Common Issues & Fixes

### "Cannot connect to PostgreSQL"

```bash
# Check if Docker is running
docker compose ps

# If not running, start it
cd docker && docker compose up -d

# Check PostgreSQL logs
docker logs thirdwave-postgres
```

### "Port 3100 already in use"

```bash
# Find what's using the port
lsof -i :3100

# Use a different port
PORT=3200 bun run dev
```

### "Schema not created" (0 tables)

```bash
# Recreate the database (destroys data!)
cd docker
docker compose down -v   # Remove volumes
docker compose up -d     # Start fresh
```

### "POSTGRES_URL not set" warnings

This is normal if you haven't configured PostgreSQL. The platform falls back to
SQLite-only mode. To enable PostgreSQL:

```bash
export POSTGRES_URL="postgresql://thirdwave:thirdwave_secret@localhost:5432/thirdwave"
```

### Migrating Existing SQLite Data to PostgreSQL

If you've been running on SQLite-only and now want to move data to PostgreSQL:

```bash
# Preview what will be migrated (safe, doesn't change anything)
POSTGRES_URL="postgresql://thirdwave:thirdwave_secret@localhost:5432/thirdwave" \
  bun run scripts/migrate-sqlite-to-pg.ts --dry-run

# Run the actual migration
POSTGRES_URL="postgresql://thirdwave:thirdwave_secret@localhost:5432/thirdwave" \
  bun run scripts/migrate-sqlite-to-pg.ts

# Migrate only specific tables
POSTGRES_URL="..." bun run scripts/migrate-sqlite-to-pg.ts --only=workspaces,audit
```

The migration script:
- Backs up all SQLite files before starting
- Is **idempotent** (safe to run multiple times — won't duplicate data)
- Validates row counts after migration

---

## 9. Glossary

| Term | Meaning |
|------|---------|
| **PostgreSQL** | A powerful open-source database that runs as a server. Stores data reliably and supports many simultaneous users. |
| **PgBouncer** | Sits between your app and PostgreSQL. Reuses database connections instead of creating new ones each time (much faster). |
| **SQLite** | A simple database stored as a single file. Great for single-user, no setup needed. |
| **Dual-write** | Writing data to two places at once (SQLite + PostgreSQL) so nothing is lost. |
| **Fire-and-forget** | Send the write to PostgreSQL but don't wait for it to finish. If it fails, log a warning and move on. |
| **Idempotent** | Safe to run multiple times — doing it twice has the same result as doing it once. |
| **AgentExecutor** | The AI brain of the platform. Takes your prompt, sends it to an LLM, executes tool calls, and returns a response. |
| **LLM** | Large Language Model — the AI that generates text (e.g., Claude, GPT, Gemini). |
| **vLLM** | A fast local server for running LLMs on your own GPU. |
| **Hono** | A lightweight web framework for handling HTTP requests (similar to Express). |
| **Bun** | A fast JavaScript/TypeScript runtime (alternative to Node.js). |
| **RBAC** | Role-Based Access Control — different users get different permissions. |
| **HITL** | Human-in-the-Loop — risky operations require human approval before executing. |
| **Docker Compose** | A tool for running multiple Docker containers (PostgreSQL + PgBouncer) with one command. |
| **Schema** | The structure of a database — which tables exist, what columns they have. |
| **Seed data** | Initial data inserted into the database (default roles, tools, policies). |
| **Connection pool** | A set of pre-opened database connections ready to be reused (avoids the overhead of opening a new connection for every query). |
| **Migration** | Moving data from one database to another (in our case: SQLite → PostgreSQL). |
