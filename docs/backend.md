# Kadavuley Backend

Self-hosted AI coding platform powered by local vLLM inference.

## Architecture

```
�────────────┐     �────────────┐
│  Platform  │──▶│  OpenCode   │
│  (:3100)   │   │  (:4096)    │
└────────────┘     └────────────┘
        │
   �─────┼─────┬─────┬──────┬───────┬────────┐
   │     │     │     │      │       │        ▼
�────�───�─────�─�───────�──────�───────┬────────┐
│ Audit │ Budget │ Queue │ Workspaces │ Tasks  │
└───────�────────�────────�─────────────�────────┘
```

## Components

| Component  | Path                          | Purpose                      |
| ---------- | ----------------------------- | ---------------------------- |
| Server     | `platform/src/server/`        | Hono HTTP server             |
| Services   | `platform/src/services/`      | Business logic               |
| Routes     | `platform/src/server/routes/` | REST API                     |
| Middleware | `platform/src/middleware/`    | Auth, logging, rate-limiting |

## Services

- `AuditLogger` — API request/response logging
- `BudgetManager` — Usage limits and quotas
- `TaskQueue` — Async task execution
- `WorkspaceManager` — Project workspaces
- `ScalableQueue` — Production queue with concurrency
- `SubagentOrchestrator` — Multi-agent task orchestration
- `ParallelExecutor` — Concurrent task runner
- `OpenCodeClient` — HTTP client to local LLM engine

## API Endpoints

| Method | Path                       | Description           |
| ------ | -------------------------- | --------------------- |
| GET    | `/health`                  | Platform health check |
| GET    | `/api/sessions`            | List chat sessions    |
| POST   | `/api/sessions`            | Create session        |
| POST   | `/api/sessions/:id/prompt` | Send prompt to LLM    |
| GET    | `/api/audit`               | Audit logs            |
| GET    | `/api/audit/stats`         | Statistics            |
| GET    | `/api/budget/summary`      | Usage summary         |
| GET    | `/api/budget/check`        | Quota check           |
| GET    | `/api/workspaces`          | List workspaces       |
| GET    | `/api/queue/metrics`       | Queue metrics         |
| GET    | `/api/orchestrations`      | Orchestrations        |
| GET    | `/api/parallel`            | Parallel executions   |
| GET    | `/api/providers`           | LLM providers         |
| GET    | `/api/files`               | Project files         |
| GET    | `/api/vcs`                 | VCS status            |
| GET    | `/api/project`             | Current project       |
| GET    | `/api/config`              | Configuration         |
| PATCH  | `/api/config`              | Update config         |

## Middleware

- `loggerMiddleware` — Request/response logging
- `authMiddleware` — Authentication (basic)
- `rateLimitMiddleware` — Rate limiting

## Tech Stack

- Runtime: Bun
- Web server: Hono
- Database: SQLite (via Drizzle ORM)
- LLM: vLLM local inference
