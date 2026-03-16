# RBAC Implementation Plan — Thirdwave AI Coding Platform

## Current State

- **Auth:** Single shared API key (`PLATFORM_API_KEY`) or fully open mode
- **Users:** No user identity — all requests appear as `"default"`
- **Middleware:** `authMiddleware` → check key → pass/reject, no role info
- **Audit:** Logs `userID: "default"` for every request

---

## Proposed RBAC Architecture

### 1. Roles

| Role       | Description                                    | Access Level |
| ---------- | ---------------------------------------------- | ------------ |
| `admin`    | Full control — user management, policy config  | Everything   |
| `operator` | Run tasks, manage sessions, view audit/budget  | Most APIs    |
| `developer`| Chat, create sessions, use tools               | Core dev APIs|
| `viewer`   | Read-only dashboards, health, models           | GET only     |

### 2. Permission Matrix

| Endpoint                    | admin | operator | developer | viewer |
| --------------------------- | ----- | -------- | --------- | ------ |
| `GET  /health`              | ✓     | ✓        | ✓         | ✓      |
| `GET  /` (dashboard)        | ✓     | ✓        | ✓         | ✓      |
| `POST /api/chat`            | ✓     | ✓        | ✓         | ✗      |
| `POST /api/chat/stream`     | ✓     | ✓        | ✓         | ✗      |
| `POST /api/chat/direct`     | ✓     | ✓        | ✓         | ✗      |
| `GET  /api/chat/models`     | ✓     | ✓        | ✓         | ✓      |
| `*    /api/sessions`        | ✓     | ✓        | ✓         | ✗      |
| `*    /api/tasks`           | ✓     | ✓        | ✓         | ✗      |
| `GET  /api/tasks`           | ✓     | ✓        | ✓         | ✓      |
| `*    /api/files`           | ✓     | ✓        | ✓         | ✗      |
| `*    /api/workspaces`      | ✓     | ✓        | ✓         | ✗      |
| `GET  /api/registry`        | ✓     | ✓        | ✓         | ✓      |
| `POST /api/registry`        | ✓     | ✓        | ✗         | ✗      |
| `*    /api/skills`          | ✓     | ✓        | ✓         | ✓(GET) |
| `GET  /api/audit`           | ✓     | ✓        | ✗         | ✗      |
| `GET  /api/budget`          | ✓     | ✓        | ✓(own)    | ✓      |
| `*    /api/policies`        | ✓     | ✗        | ✗         | ✗      |
| `*    /api/orchestrations`  | ✓     | ✓        | ✗         | ✗      |
| `*    /api/queue`           | ✓     | ✓        | ✗         | ✗      |
| `*    /api/parallel`        | ✓     | ✓        | ✓         | ✗      |

### 3. Authentication Flow

```
Client                     Platform
  │                           │
  ├── POST /auth/login ──────►│  { username, password }
  │◄── { token, role } ──────┤  JWT with { sub, role, iat, exp }
  │                           │
  ├── GET /api/chat ─────────►│  Authorization: Bearer <jwt>
  │   (middleware decodes JWT, │
  │    sets c.var.user)        │
  │◄── Response ──────────────┤
```

### 4. Implementation Steps

#### Phase 1: User Store + JWT Auth (replaces shared API key)

**New files:**
- `src/services/user-store.ts` — SQLite-backed user storage (like budget-manager)
- `src/types/auth.ts` — Role, User, Token types

**Changes:**
- `src/config/env.ts` — Add `PLATFORM_JWT_SECRET` (already exists), `RBAC_ENABLED` flag
- `src/middleware/auth.ts` — Decode JWT, extract role, set `c.set("user", ...)`. Fall back to API key mode when RBAC disabled.

```typescript
// src/types/auth.ts
export type Role = "admin" | "operator" | "developer" | "viewer"

export interface AuthUser {
  id: string
  username: string
  role: Role
}

// Stored in Hono context via c.set("user", authUser)
```

```typescript
// src/services/user-store.ts  (sketch)
import { Database } from "bun:sqlite"
import { timingSafeEqual } from "crypto"

export class UserStore {
  private db: Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.run(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'developer',
      created_at TEXT DEFAULT (datetime('now')),
      is_active INTEGER DEFAULT 1
    )`)
    this.ensureDefaultAdmin()
  }

  private ensureDefaultAdmin() {
    const admin = this.db.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get()
    if (!admin) {
      // Create default admin on first run — password from env or generated
      this.createUser("admin", env.PLATFORM_ADMIN_PASSWORD ?? "changeme", "admin")
    }
  }

  async createUser(username: string, password: string, role: Role) { ... }
  async validateCredentials(username: string, password: string): Promise<AuthUser | null> { ... }
  async listUsers(): Promise<AuthUser[]> { ... }
  async updateRole(userId: string, role: Role) { ... }
  async deactivate(userId: string) { ... }
}
```

#### Phase 2: RBAC Middleware

```typescript
// src/middleware/rbac.ts  (sketch)
import type { Context, Next } from "hono"
import type { Role, AuthUser } from "../types/auth"

// Route → minimum role required
const ROLE_HIERARCHY: Record<Role, number> = {
  admin: 4,
  operator: 3,
  developer: 2,
  viewer: 1,
}

interface RoutePermission {
  path: string          // glob pattern
  methods: string[]     // ["GET", "POST", ...] or ["*"]
  minRole: Role
}

const PERMISSIONS: RoutePermission[] = [
  { path: "/health*",           methods: ["*"],    minRole: "viewer" },
  { path: "/api/chat/models",   methods: ["GET"],  minRole: "viewer" },
  { path: "/api/chat*",         methods: ["POST"], minRole: "developer" },
  { path: "/api/sessions*",     methods: ["*"],    minRole: "developer" },
  { path: "/api/registry",      methods: ["GET"],  minRole: "viewer" },
  { path: "/api/registry*",     methods: ["POST", "PUT", "DELETE"], minRole: "operator" },
  { path: "/api/audit*",        methods: ["*"],    minRole: "operator" },
  { path: "/api/policies*",     methods: ["*"],    minRole: "admin" },
  // ... etc
]

export function rbacMiddleware(c: Context, next: Next) {
  const user = c.get("user") as AuthUser | undefined
  if (!user) return c.json({ error: "unauthorized" }, 401)

  const method = c.req.method
  const path = c.req.path

  const rule = PERMISSIONS.find(p =>
    matchPath(path, p.path) && (p.methods.includes("*") || p.methods.includes(method))
  )

  if (!rule) return next()  // No rule = allow (or deny by default — configurable)

  if (ROLE_HIERARCHY[user.role] < ROLE_HIERARCHY[rule.minRole]) {
    return c.json({
      error: "forbidden",
      message: `Role '${user.role}' cannot access ${method} ${path}`,
      requiredRole: rule.minRole,
    }, 403)
  }

  return next()
}
```

#### Phase 3: Auth Routes

```typescript
// src/server/routes/auth.ts  (new)
// POST /auth/login     → { username, password } → { token, user }
// POST /auth/register  → admin-only: create new users
// GET  /auth/me        → current user info
// POST /auth/refresh   → refresh JWT
// POST /auth/users     → admin: list/manage users
```

#### Phase 4: TUI Integration

- Add `/login <username>` command
- Store JWT in `~/.thirdwave/credentials`
- SDK `client.ts` — send JWT instead of API key
- Add `/users` admin command for user management

### 5. Migration Path

1. **Backward compatible**: When `RBAC_ENABLED=false` (default), existing API key auth works as-is
2. **Opt-in**: Set `RBAC_ENABLED=true` + `PLATFORM_JWT_SECRET=<secret>` to enable
3. **First run**: Auto-creates admin user with password from `PLATFORM_ADMIN_PASSWORD` env var
4. **Gradual**: API key still works as a "superadmin" bypass for automation/CI

### 6. Data Model

```sql
-- users table (SQLite via bun:sqlite)
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,        -- Bun.password.hash() (argon2id)
  role          TEXT NOT NULL DEFAULT 'developer',
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now')),
  is_active     INTEGER DEFAULT 1,
  last_login    TEXT
);

-- optional: per-user API keys for CI/automation
CREATE TABLE api_keys (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id),
  key_hash   TEXT NOT NULL,
  name       TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  is_active  INTEGER DEFAULT 1
);
```

### 7. Security Considerations

- **Password hashing**: Use `Bun.password.hash()` (argon2id) — NOT base64
- **JWT**: HS256 with `PLATFORM_JWT_SECRET`, 24h expiry, refresh token rotation
- **Timing-safe comparison**: Already fixed in auth.ts (this session)
- **Rate limiting**: Per-user instead of per-IP when RBAC enabled
- **Audit**: Log `user.id` instead of `"default"` in all audit entries
- **Session isolation**: Each user sees only their own sessions

### 8. Effort Estimate

| Phase | Scope                               | Files Changed |
| ----- | ----------------------------------- | ------------- |
| 1     | User store, JWT auth, types         | 4 new, 2 edit |
| 2     | RBAC middleware, permissions         | 2 new, 1 edit |
| 3     | Auth routes, login/register         | 1 new, 1 edit |
| 4     | TUI commands, SDK bearer token      | 3 edit        |
| Total |                                     | 7 new, 7 edit |
