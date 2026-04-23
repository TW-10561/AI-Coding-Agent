# Thirdwave — Final Implementation Plan
**Date Finalized**: April 8, 2026
**Timeline**: 8 Weeks (April 9 – June 3, 2026)
**Total Effort**: ~220 hours

---

## EXECUTION STATUS

| Phase | Description | Status | Started | Completed |
|-------|------------|--------|---------|-----------|
| 1 | PostgreSQL Setup & Schema | ✅ COMPLETE (except PgBouncer/backups) | Apr 8 | Apr 13 |
| 2 | Data Migration | ✅ COMPLETE (PG backends live) | Apr 13 | Apr 13 |
| 3 | User Auth + RBACEngineV2 | ✅ COMPLETE | Apr 13 | Apr 22 |
| 4 | API Key Mgmt + Inline Completion | ✅ COMPLETE | Apr 13 | Apr 22 |
| 5 | Approval Notifications & HITL UI | ✅ COMPLETE | Apr 13 | Apr 22 |
| 6 | VS Code Extension UI | ✅ COMPLETE | Apr 13 | Apr 22 |
| 7–8 | Inline Completion Polish & Testing | ⬜ Not Started | — | — |

---

## FINALIZED DECISIONS SUMMARY

| Decision | What Was Decided |
|----------|-----------------|
| Database | Migrate 3 fragmented SQLite DBs → 1 consolidated PostgreSQL instance |
| RBAC Roles | 4 roles: `admin`, `developer`, `readonly`, `team_leader` (removed `autonomous_agent`) |
| RBAC Engine | Move from hardcoded (rbac.ts) to database-backed policies (no code change to update) |
| HITL Decisions | `allow` = execute immediately; `ask` = approval popup + Slack; `deny` = block + log (no popup) |
| User Auth | Email + password registration → admin approval workflow → role assigned on approval |
| API Keys | Per-user vLLM keys (local inference gateway); inference team tracks usage |
| Key Input | After approval (onboarding) + Account Settings page (ongoing rotation/revocation) |
| Inline Completion | New feature: inline code suggestions with old/new diff visualization |
| Tool Count | 17 tools cataloged, all mapped to 68 RBAC policies (4 roles × 17 tools) |

---

## ARCHITECTURE OVERVIEW

```
[VS Code Extension]
  ├─ Auth: Login / Register form
  ├─ Account Settings: vLLM API key management
  ├─ Agent Chat Panel (Build / Plan / Explore / General)
  └─ Inline Completion: with diff visualization
         ↓ HTTP
[Thirdwave Platform — Port 3100 — Bun + Hono]
  ├─ Auth Service (JWT)
  ├─ RBAC Engine v2 (PostgreSQL-backed)
  ├─ HITL Guard (allow / ask / deny)
  ├─ Tool Executor (17 tools)
  ├─ Admin Dashboard
  └─ API Key Management
         ↓ HTTP
[OpenCode — Port 4096]
  └─ Session & Message Management
         ↓ HTTP
[vLLM Inference Gateway — Port 9080 / 8000]
  └─ Local model inference (usage tracking by inference team)
         ↓
[PostgreSQL — Single Consolidated DB]
  └─ 14 tables: users, roles, registration_requests, api_keys,
                api_key_audit_log, tool_metadata, tool_access_policies,
                path_access_rules, workspaces, sessions, messages,
                approval_requests, audit_log, risk_scores
```

---

## CRITICAL: vLLM API KEY FLOW (Per-Developer Usage Tracking)

### Problem We're Solving
**Current state** (problem):
```
.env has YOUR personal vLLM API key
  ↓
All users (developers, analysts, etc.) clone repo and run agent
  ↓
All requests use .env key (YOUR key)
  ↓
vLLM gateway sees all local model usage under YOUR name
  ↓
❌ Infra team can't track per-user usage
❌ Can't bill users individually
❌ No visibility into who used what
```

**Desired state** (solution):
```
Each user has PERSONAL vLLM API key (from infra team)
  ↓
User registers in agent with SAME EMAIL as infra team account
  ↓
Key stored securely in api_keys table (bcrypt hashed)
  ↓
When agent executes tool:
   1. Retrieve logged-in user's key from api_keys table
   2. Decrypt/unhash the key
   3. Pass to vLLM gateway in request Authorization header
   ↓
vLLM gateway authenticates with user's personal key
  ↓
✅ Usage tracked under USER's email
✅ Infra team sees per-user metrics
✅ Email linking: infra team alice@company.com = agent alice@company.com
✅ Clear accountability for all users
```

### Implementation Flow

**During Tool Execution (Phase 4+):**
```typescript
// platform/src/services/tool-executor.ts

async function executeTool(toolName: string, args: any, context: ExecutionContext) {
  // 1. Get current user (from JWT context)
  const userId = context.user.id;
  
  // 2. Retrieve user's vLLM API key from database
  const apiKey = await db.query(
    'SELECT key_hash, key_preview FROM api_keys WHERE user_id = ? AND status = "active" LIMIT 1',
    [userId]
  );
  
  if (!apiKey) {
    throw new Error('API key not configured. Please set up your vLLM key in Account Settings.');
  }
  
  // 3. When calling vLLM gateway, use user's key (NOT .env key)
  const response = await fetch('http://172.30.140.63:9080/v1/...', {
    headers: {
      'Authorization': `Bearer ${apiKey.key_hash}`,  // User's personal key
      'X-User-ID': userId,                          // For infra team tracking
      'X-User-Email': context.user.email
    },
    body: toolArgs
  });
  
  // 4. Log successful execution under user's name
  await auditLog.create({
    action: 'tool.executed',
    user_id: userId,
    tool_name: toolName,
    timestamp: new Date()
  });
  
  return response;
}
```

### .env Key Role (Fallback Only)

```bash
# .env file (FALLBACK/TESTING ONLY)
VLLM_GATEWAY_URL=http://172.30.140.63:9080/v1
VLLM_GATEWAY_KEY=<your-personal-key>  # ← Only used for:
                                       #   - Local testing before users onboard
                                       #   - Fallback if user hasn't set key
                                       #   - Do NOT use in production for multi-user
```

### Infra Team Tracking (Email-Based Linking)

```
1. Infra Team Setup (separate system):
   └─ Creates vLLM API key for alice@company.com
      └─ Example: vllm_key_alice_xyz

2. User Registers in Agent (Thirdwave):
   User fills: email alice@company.com, password, role request
   Admin approves → user created in users table with email: alice@company.com

3. User Onboards:
   User pastes their vLLM key (provided by infra team)
   Thirdwave stores: api_keys { user_id, key_hash, display_name }

4. User Runs Agent:
   Login email: alice@company.com
   ↓
   Retrieve key from api_keys table
   ↓
   Tool execution: bash "npm build"
   ↓
   Request to vLLM: Authorization: Bearer vllm_key_alice_xyz

5. vLLM Gateway logs:
   {
     timestamp: 2026-04-10T14:32:00Z,
     api_key: vllm_key_alice_xyz,
     user_email: alice@company.com,
     model: qwen-3-coder-30b,
     tokens_used: 2500,
     inference_time_ms: 4200
   }

6. Infra Team Dashboard shows (by email):
   alice@company.com: 15,000 tokens used this week (billed accordingly)
   bob@company.com:   9,200 tokens used this week
   carol@company.com: 12,800 tokens used this week
   
   ✅ Same email = same person across both systems
```

---

## DATABASE SCHEMA (14 Tables)

### Core Auth & User Management (New)
```sql
-- 1. roles (dynamic, not hardcoded)
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL UNIQUE,      -- 'admin' | 'developer' | 'readonly' | 'team_leader'
  description TEXT,
  is_built_in BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,   -- bcrypt 12 rounds
  role_id UUID NOT NULL REFERENCES roles(id),
  company VARCHAR(255),
  status ENUM('active', 'suspended') DEFAULT 'active',
  verified_email BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  last_login_at TIMESTAMP
);

-- 3. registration_requests (admin approval queue)
CREATE TABLE registration_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  requested_role UUID REFERENCES roles(id),
  company VARCHAR(255),
  status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
  verification_token VARCHAR(255),
  reviewed_by UUID REFERENCES users(id),
  review_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  reviewed_at TIMESTAMP
);

-- 4. api_keys (per-user vLLM inference gateway keys)
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash VARCHAR(255) NOT NULL,        -- bcrypt hashed, never plaintext
  key_preview VARCHAR(30),               -- Last chars for display: "vllm_token_...xxxx"
  display_name VARCHAR(100),
  key_type ENUM('vllm', 'custom') DEFAULT 'vllm',
  inference_gateway_url VARCHAR(255),    -- e.g., http://172.30.140.63:9080
  status ENUM('active', 'revoked', 'expired') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP,
  expires_at TIMESTAMP,
  revoked_at TIMESTAMP,
  revoked_by UUID REFERENCES users(id),
  rotation_salt VARCHAR(32)
);

-- 5. api_key_audit_log (key lifecycle only; usage tracked by inference team)
CREATE TABLE api_key_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  api_key_id UUID REFERENCES api_keys(id),
  action ENUM('created', 'rotated', 'revoked', 'validated', 'expired'),
  ip_address INET,
  gateway_response_status INT,
  timestamp TIMESTAMP DEFAULT NOW()
);
```

### RBAC (Migrated from Hardcoded to DB)
```sql
-- 6. tool_metadata (17 tools)
CREATE TABLE tool_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  risky BOOLEAN DEFAULT FALSE,
  category VARCHAR(50),        -- 'filesystem' | 'shell' | 'web' | 'agent' | 'search'
  created_at TIMESTAMP DEFAULT NOW()
);

-- 7. tool_access_policies (68 rows: 4 roles × 17 tools)
CREATE TABLE tool_access_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name VARCHAR(100) NOT NULL REFERENCES tool_metadata(name),
  role_id UUID NOT NULL REFERENCES roles(id),
  decision ENUM('allow', 'ask', 'deny') NOT NULL,
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(tool_name, role_id)
);

-- 8. path_access_rules (directory-level access per role)
CREATE TABLE path_access_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES roles(id),
  path_pattern VARCHAR(255) NOT NULL,   -- e.g., '/workspace/**', '/root', '/etc/**'
  readable BOOLEAN DEFAULT FALSE,
  writable BOOLEAN DEFAULT FALSE,
  executable BOOLEAN DEFAULT FALSE,
  priority INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### HITL & Audit
```sql
-- 9. approval_requests (pending HITL approvals for 'ask' decisions)
CREATE TABLE approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id VARCHAR(255) NOT NULL,
  tool_name VARCHAR(100) NOT NULL,
  tool_args JSONB,
  requested_by UUID NOT NULL REFERENCES users(id),
  status ENUM('pending', 'approved', 'denied', 'expired') DEFAULT 'pending',
  reviewed_by UUID REFERENCES users(id),
  risk_score INT,                        -- 0–100
  decision_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  reviewed_at TIMESTAMP,
  expires_at TIMESTAMP
);

-- 10. audit_log (immutable compliance trail for all decisions)
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action VARCHAR(100) NOT NULL,          -- 'tool.executed' | 'tool.denied' | 'approval_request.created'
  result VARCHAR(50),                    -- 'success' | 'blocked' | 'approved' | 'denied'
  user_id UUID REFERENCES users(id),
  resource VARCHAR(255),                 -- tool name, file path, etc.
  metadata JSONB,
  timestamp TIMESTAMP DEFAULT NOW()
);
```

### Operational
```sql
-- 11. workspaces
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  directory TEXT NOT NULL,
  tags TEXT[],
  owner_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 12. sessions
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  user_id UUID REFERENCES users(id),
  agent_type VARCHAR(50),
  model_id VARCHAR(255),
  status ENUM('active', 'archived') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 13. messages
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id),
  role ENUM('user', 'assistant', 'system') NOT NULL,
  content TEXT NOT NULL,
  tool_calls JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 14. risk_scores (per-session risk tracking)
CREATE TABLE risk_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id),
  tool_name VARCHAR(100),
  score INT NOT NULL,
  factors JSONB,
  timestamp TIMESTAMP DEFAULT NOW()
);
```

---

## RBAC POLICY MATRIX (68 Policies)

> Decision Types: `allow` = execute immediately | `ask` = approval popup + Slack | `deny` = block + log (no popup)

| Tool | Admin | Developer | Team Leader | Readonly |
|------|-------|-----------|-------------|---------|
| `bash` | allow | ask | ask | deny |
| `write` | allow | allow | ask | deny |
| `edit` | allow | allow | ask | deny |
| `multiedit` | allow | allow | ask | deny |
| `apply_patch` | allow | allow | ask | deny |
| `read` | allow | allow | allow | allow |
| `ls` | allow | allow | allow | allow |
| `glob` | allow | allow | allow | allow |
| `grep` | allow | allow | allow | allow |
| `codesearch` | allow | allow | allow | allow |
| `webfetch` | allow | ask | ask | deny |
| `websearch` | allow | allow | allow | deny |
| `batch` | allow | ask | ask | deny |
| `task` | allow | allow | ask | deny |
| `plan` | allow | allow | allow | allow |
| `question` | allow | allow | allow | allow |
| `skill` | allow | allow | ask | deny |

### Path-Level Access Rules per Role
| Path Pattern | Admin | Developer | Team Leader | Readonly |
|-------------|-------|-----------|-------------|---------|
| `/workspace/**` | r/w/x | r/w/x | r/w | r |
| `~/**` | r/w/x | r/w | r | — |
| `/etc/**` | r/w/x | — | — | — |
| `/root/**` | r/w/x | — | — | — |
| `**/.env*` | r/w | — | — | — |
| `**/node_modules/**` | r/w/x | r/x | r | — |

---

## SEEDED DATA

### Default Roles (Phase 1 SQL)
```sql
INSERT INTO roles (name, description) VALUES
  ('admin',       'Full access; manage users, roles, and policies'),
  ('developer',   'Write/read access to workspace; ask for shell and web ops'),
  ('team_leader', 'Broad read, limited write; approves agent actions in their scope'),
  ('readonly',    'View-only access; no write, shell, or web tools');
```

### Tool Metadata Seed (17 tools)
```sql
INSERT INTO tool_metadata (name, risky, category) VALUES
  ('bash',        TRUE,  'shell'),
  ('read',        FALSE, 'filesystem'),
  ('write',       TRUE,  'filesystem'),
  ('edit',        TRUE,  'filesystem'),
  ('apply_patch', TRUE,  'filesystem'),
  ('ls',          FALSE, 'filesystem'),
  ('glob',        FALSE, 'search'),
  ('grep',        FALSE, 'search'),
  ('codesearch',  FALSE, 'search'),
  ('webfetch',    TRUE,  'web'),
  ('websearch',   TRUE,  'web'),
  ('batch',       TRUE,  'agent'),
  ('plan',        FALSE, 'agent'),
  ('task',        TRUE,  'agent'),
  ('question',    FALSE, 'agent'),
  ('skill',       TRUE,  'agent'),
  ('multiedit',   TRUE,  'filesystem');
```

---

## HITL DECISION FLOW

```
Tool Request comes in
    ↓
1. Authenticate: Is user's vLLM API key valid and active?
   └─ No → 401 Unauthorized (log in audit_log)
    ↓
2. Identify Role: Look up user → role from users.role_id → roles.name
    ↓
3. RBAC Lookup: SELECT decision FROM tool_access_policies
                WHERE tool_name = ? AND role_id = ?
    ↓
4a. decision = 'allow'   → Execute immediately; log 'tool.executed' in audit_log
4b. decision = 'ask'     → INSERT into approval_requests (status=pending)
                           Send Slack notification to approvers
                           Return: "Awaiting approval..."
                           On approve → execute; log 'approval_request.approved'
                           On deny    → block;   log 'approval_request.denied'
4c. decision = 'deny'    → Block immediately; log 'tool.denied' in audit_log
                           Return: "Access Denied" in UI (no popup, no Slack)
    ↓
5. Path Check (for filesystem tools):
   Look up path_access_rules WHERE role_id = ? AND path matches
   If no rule matches → deny by default
    ↓
6. Risk Score: Compute 0–100 in riskEngine.ts
   Score ≥ 80 → elevate to 'ask' even if policy says 'allow'
   Log score in risk_scores table
```

---

## USER REGISTRATION & APPROVAL FLOW

```
1. Developer visits registration page (VS Code Extension or Web UI)
2. Fills in: company email, password, requested role, company name
3. POST /auth/register → INSERT into registration_requests (status='pending')
   Response: "Registration submitted. Admin will review within 24 hours."

4. Admin views /admin/registrations (port 3100 admin dashboard)
   Sees list: email | requested role | company | submitted date

5a. Admin approves:
    POST /admin/registrations/approve
    Body: { requestId, approvedRole (can differ from requested), reason }
    Backend:
      → INSERT into users (with approved role)
      → DELETE from registration_requests
      → Send activation email with onboarding link (expires 24h)

5b. Admin rejects:
    POST /admin/registrations/reject
    Body: { requestId, reason }
    Backend:
      → UPDATE registration_requests SET status='rejected'
      → Send rejection email

6. Developer opens onboarding link
   → Prompted: "Paste your vLLM API key from the local inference gateway"
   → POST /auth/api-keys/initialize
   → api_keys table: INSERT (hashed key, preview, gateway URL)
   → "Key saved! You can now use the agent."

7. Developer installs VS Code Extension / opens TUI
   Extension detects token + valid API key → Agent is ready
```

---

## API KEY LIFECYCLE

```
[Onboarding]  POST /auth/api-keys/initialize      → First key setup
[List]        GET  /auth/api-keys                 → View active/revoked keys
[Rotate]      POST /auth/api-keys/rotate           → Paste new key; old auto-revoked
[Revoke]      DELETE /auth/api-keys/{keyId}        → Instant revocation

Key Rules:
- Stored as: bcrypt hash + last-N-chars preview (never plaintext)
- Usage tracking: handled by local vLLM inference gateway (inference team)
- Thirdwave tracks: created / rotated / revoked / validated events only
- Revoked key: any request using it returns 401 immediately

Admin can also revoke any user's key:
  DELETE /admin/api-keys/{keyId}  (admin only)
```

---

## 8-WEEK IMPLEMENTATION PLAN

### Phase 1 — PostgreSQL Setup & Schema (Week 1: Apr 9–15)
**Owner**: DevOps + 1 Backend Engineer | **Effort**: 30h | **Status**: 🟡 IN PROGRESS

- [x] Provision PostgreSQL instance (Docker Compose for dev)
- [x] Install `postgres` driver (`bun add postgres`)
- [x] Create database connection module (`platform/src/config/db.ts`)
- [x] Create all 14 tables with indexes (`platform/src/config/schema.sql`)
- [x] Seed default roles (admin, developer, team_leader, readonly)
- [x] Seed 17 tool_metadata rows
- [x] Seed 68 tool_access_policies rows (RBAC matrix from this document)
- [x] Seed path_access_rules (directory-level permissions per role)
- [ ] Set up PgBouncer connection pooling (target: 30+ concurrent connections) — deferred
- [ ] Configure daily backups + WAL archiving (point-in-time recovery) — deferred
- [x] Write health-check endpoint: `GET /health/db`
- [x] Update `platform/src/config/env.ts` to read `POSTGRES_URL` from `.env`

**Done When**: `GET /health/db` returns `{ status: "ok", tables: 19 }` with real data. ✅ VERIFIED

---

### Phase 2 — Data Migration (Week 2: Apr 16–22)
**Owner**: 1 Backend Engineer | **Effort**: 30h

- [x] Write migration script: OpenCode SQLite → PostgreSQL — N/A (OpenCode not running)
- [x] Write migration script: Platform SQLite → PostgreSQL — N/A (fresh start on new machine)
- [ ] Convert JSONL audit logs → audit_log table rows — deferred
- [x] Update `workspace-manager.ts` to query PostgreSQL instead of SQLite
- [x] Update `chat-log.ts` to query PostgreSQL instead of SQLite
- [x] Update session references to point to PostgreSQL
- [ ] Delete old SQLite files after validation (keep 14-day backup)
- [x] Regression test: create session, send message, verify in PostgreSQL ✅

**Done When**: All new data stored in PostgreSQL; SQLite used only as fallback. ✅ VERIFIED

---

### Phase 3 — User Auth + RBACEngineV2 (Week 3: Apr 23–29)
**Owner**: 2 Backend Engineers | **Effort**: 35h | **Status**: ✅ COMPLETE (Apr 22)

**User Auth Endpoints:**
- [x] `POST /auth/register` — Create registration_requests row
- [x] `GET /auth/registration-status/{requestId}` — Check pending/approved/rejected
- [x] `POST /auth/login` — Return JWT token (bcrypt 12 rounds)
- [x] `GET /auth/validate` — Token validity check (via `/auth/me`)
- [x] `POST /auth/logout` — Invalidate token

**Admin Endpoints:**
- [x] `GET /admin/registrations` — List all pending/approved/rejected
- [x] `POST /admin/registrations/approve` — Approve + create user
- [x] `POST /admin/registrations/reject` — Reject registration

**RBACEngineV2 (replace platform/HITL/rbac.ts):**
- [x] Class `RBACEngineV2` reads `tool_access_policies` from PostgreSQL
- [x] Method `checkToolAccess(toolName, userRole)` → `'allow' | 'ask' | 'deny'` (30s TTL cache)
- [x] Cache invalidation on policy update via `invalidate()`
- [x] Tool execution in `chat.ts` checks `RBACEngineV2` before tool calls
- [x] 116 policies seeded in DB (covering all tool types and roles)
- [x] `GET /admin/policies` + `PATCH /admin/policies/:id` endpoints live

**Done When**: Tool execution checks PostgreSQL RBAC; no code change needed to update a policy. ✅ VERIFIED

---

### Phase 4 — API Key Management + Inline Completion Endpoint (Week 4: Apr 30–May 6)
**Owner**: 2 Backend Engineers | **Effort**: 35h | **Status**: ✅ COMPLETE (Apr 22)

**API Key Endpoints:**
- [x] `POST /auth/api-keys/initialize` — First key setup (onboarding)
- [x] `GET /auth/api-keys` — List user's keys (active + revoked)
- [x] `POST /auth/api-keys/rotate` — Paste new key; old marked revoked
- [x] `DELETE /auth/api-keys/{keyId}` — Revoke key immediately
- [x] `GET /auth/api-keys/active` — Get current active key (for VS Code extension)
- [x] `GET /auth/api-keys/{keyId}/status` — Validation status (delegates to gateway)
- [x] `DELETE /admin/api-keys/{keyId}` — Admin-level revocation
- [x] `POST /admin/api-keys/{keyId}/verify` — Admin approves submitted key
- [x] `POST /admin/api-keys/{keyId}/reject` — Admin rejects submitted key

**Middleware:**
- [x] JWT auth middleware — every `/api/*` route validates Bearer token
- [x] Per-user API key retrieval — chat routes fetch user's key from `api_keys` table
- [x] On missing/revoked key → `401 { error: "API key not configured..." }`
- [x] `apiKeyValidationMiddleware` — validate every agent request against `api_keys` table status

**⭐ CRITICAL: Tool Executor vLLM Key Integration:**
- [x] Chat routes (`/api/chat`, `/api/chat/stream`, `/api/chat/direct`) fetch user's vLLM key from `api_keys` table (not `.env`)
- [x] Workspace auto-registration sets `ownerId` from JWT
- [x] Budget tracking (`recordUsage`) wired into all chat responses
- [x] 403 = "Model access restricted" (gateway ACL) — clear error shown, no silent fallback
- [x] 502/503 = "Model backend down" — clear error shown with model name
- [x] Update `tool-executor.ts` to use user key for non-chat tool calls
- [x] X-User-Email header on all vLLM requests for infra tracking

**Admin Policy Management Endpoints:**
- [x] `GET /admin/rbac/policies` — List all policies
- [x] `PATCH /admin/policies/{id}` — Update single decision (live endpoint, tested)
- [x] `POST /admin/rbac/tools` — Add new tool without code change
- [x] `GET /admin/rbac/tools` — List all registered tools

**Inline Completion Endpoint:**
- [x] `POST /api/chat/direct` — Used by `InlineCompletionProvider` (FIM-style, temperature=0.15)
- [x] `InlineCompletionProvider.ts` — 600ms debounce, min 3 chars, 1500 char prefix/suffix
- [x] `thirdwave.toggleInlineCompletion` command registered in extension
- [x] `POST /api/chat/sessions/register` — Session sync after stream completes

**Done When**: 
- API keys validated on every request; admin can modify RBAC policy via API call (no redeploy)
- ⭐ Tool execution ALWAYS uses the logged-in developer's vLLM API key (not .env key)
- Infra team can see per-developer usage metrics

---

### Phase 5 — Approval Notifications & HITL UI (Week 5: May 7–13)
**Owner**: 1 Backend Engineer + 1 Frontend Engineer | **Effort**: 20h | **Status**: ✅ COMPLETE (Apr 22)

- [x] HITL guards active (`/api/hitl`, `/api/hitl/:id/approve`, `/api/hitl/:id/deny`)
- [x] `GET /api/hitl` root endpoint → list pending approval requests ✅ TESTED
- [x] `GET /api/hitl/resolve/:id?decision=approved|denied` → Slack button URL handler ✅ TESTED
- [x] `POST /api/hitl/:id/approve` + `POST /api/hitl/:id/deny` legacy endpoints ✅ TESTED
- [x] Admin dashboard HITL approval UI (web page at port 3100)
- [x] Pending registrations list with approve/reject buttons (admin dashboard)
- [x] RBAC policy table visible in admin dashboard
- [x] Audit log view (filterable, in admin dashboard)
- [x] Slack webhook integration: On `ask` decision → POST to Slack channel (set `SLACK_WEBHOOK_URL` env var)
- [x] Approval expiry: `approval_requests` auto-expire via 30s timer in `HITLService`

**Done When**: When an `ask` tool is triggered, Slack message arrives within 5 seconds; approve/deny from Slack or web UI. ✅ VERIFIED

---

### Phase 6 — VS Code Extension UI (Week 6: May 14–20)
**Owner**: 1 Frontend Engineer | **Effort**: 40h | **Status**: ✅ COMPLETE (Apr 22)

**Auth Views:**
- [x] Login form (email + password, JWT stored in `vscode.SecretStorage`)
- [x] Register form (email, password, role, company; submit → pending state)
- [x] `_ensureToken()` — auto-fetches fresh token before each chat message
- [x] `AuthGuard` — chat panel shows login prompt when no valid token
- [x] `RegistrationStatusView` — poll `/auth/registration-status/{requestId}` every 30s; shows pending/approved/rejected inline in auth screen (`_startRegistrationPoll` + `showRegPendingState` in `chat.js`)

**Account Settings Page:**
- [x] API key submit form (paste vLLM key → stored in DB, pending admin approval)
- [x] API key status shown in extension (verified/pending/not set)
- [x] Full Account Settings page (profile, key history, rotate/revoke buttons in right sidebar)

**Error Handling (done this session):**
- [x] 403 "Model access restricted" — shows model name + "select a different model" message
- [x] 502/503 "Model backend down" — shows model name + "try again or switch model" message
- [x] 429 rate-limit message
- [x] Policy violation message

**Inline Completion UI:**
- [x] `InlineCompletionProvider.ts` — `vscode.InlineCompletionItemProvider` (600ms debounce, FIM prompt)
- [x] `DiffPanel.ts` — side-by-side diff with Accept/Reject/Edit (LCS-based, webview panel)
- [x] `thirdwave.showDiff` command registered; `thirdwave.toggleInlineCompletion` command
- [x] Key bindings: Tab = accept (VS Code native inline completion), Escape = reject

**Done When**: Full registration → approval → API key setup → agent use flow works end to end in VS Code. ✅ VERIFIED

---

### Phase 7–8 — UI Polish & Session Consistency (Weeks 7–8: May 21–Jun 3) ✅ COMPLETE (Apr 22)
**Owner**: 1 Full-Stack Engineer | **Effort**: 30h

- [x] UI animation polish across ALL extension pages (CSS keyframes + JS stagger)
  - Auth card: `authCardIn` entrance animation + `shakeX` on auth error
  - Message bubbles: `msgIn` animation on every new message / stream message
  - Session cards: `ssc-enter` + stagger delay (up to 8 items)
  - Model cards: `mc-enter` + stagger + hover lift with box-shadow
  - Skill items: `sk-enter` + stagger
  - HITL cards: `hitl-card-enter` + stagger
  - Panel transitions: `panelReveal` for sidebar panels, `overlayIn` for history overlay
  - Floating toast notification system (`tw-toast-container` + `toastIn`/`toastOut`)
  - Connection status dot in topbar (online/offline/checking states)
  - Typing dots (`dotBounce`), progress bar, shimmer skeleton loader
  - Topbar title gradient text, input glow on focus, send button micro-interactions
- [x] Session consistency E2E test (extension ↔ backend ↔ PostgreSQL)
  - Login → JWT, `POST /api/chat/sessions/register` → `{"ok":true}`
  - `GET /api/chat/sessions` → session appears with correct title/model/timestamps
  - PostgreSQL `chat_sessions` table → row confirmed (id, title, model, created_at all match)
- [x] VSIX rebuilt: `thirdwave-ai-0.1.0.vsix` (21 files, 123.21KB)

**Done When**: All UI pages have smooth animations, session consistency is verified extension ↔ backend ↔ DB. ✅ VERIFIED

---

## ENDPOINT SUMMARY

### Auth
| Method | Path | Who | Purpose |
|--------|------|-----|---------|
| POST | `/auth/register` | Guest | Submit registration request |
| GET | `/auth/registration-status/{id}` | Guest | Poll approval status |
| POST | `/auth/login` | Guest | Login → JWT |
| GET | `/auth/validate` | Any | Validate token |
| POST | `/auth/logout` | Any | Invalidate token |

### API Keys
| Method | Path | Who | Purpose |
|--------|------|-----|---------|
| POST | `/auth/api-keys/initialize` | User (onboarding) | First key setup |
| GET | `/auth/api-keys` | User | List my keys |
| POST | `/auth/api-keys/rotate` | User | Swap key |
| DELETE | `/auth/api-keys/{keyId}` | User | Revoke own key |
| DELETE | `/admin/api-keys/{keyId}` | Admin | Revoke any key |

### Admin
| Method | Path | Who | Purpose |
|--------|------|-----|---------|
| GET | `/admin/registrations` | Admin | Pending signups |
| POST | `/admin/registrations/approve` | Admin | Approve + create user |
| POST | `/admin/registrations/reject` | Admin | Reject signup |
| POST | `/admin/approvals/{id}/approve` | Admin/Team Leader | Approve HITL request |
| POST | `/admin/approvals/{id}/deny` | Admin/Team Leader | Deny HITL request |
| GET | `/admin/rbac/policies` | Admin | List all policies |
| PUT | `/admin/rbac/policies/{tool}/{role}` | Admin | Update policy |
| POST | `/admin/rbac/tools` | Admin | Register new tool |

### Agent
| Method | Path | Who | Purpose |
|--------|------|-----|---------|
| POST | `/agent/complete-inline` | User | Inline code completion |
| POST | `/api/chat` | User | Agentic chat (build) |
| POST | `/api/chat/stream` | User | Streaming chat (plan/explore) |

---

## FILES TO CREATE / MODIFY

### New Files
```
platform/src/
├─ services/
│  ├─ rbac-engine-v2.ts           ← Database-backed RBAC (replaces HITL/rbac.ts)
│  ├─ user-auth.ts                ← Registration, login, JWT
│  └─ api-key-manager.ts          ← vLLM key lifecycle management
├─ middleware/
│  ├─ auth-middleware.ts          ← JWT token validation
│  └─ api-key-middleware.ts       ← vLLM key validation per request
└─ routes/
   ├─ auth.ts                     ← /auth/* endpoints
   ├─ admin.ts                    ← /admin/* endpoints
   └─ inline-completion.ts        ← /agent/complete-inline endpoint

platform/vscode-extension/src/
├─ auth/
│  ├─ LoginView.tsx
│  ├─ RegisterView.tsx
│  └─ AuthGuard.tsx
├─ account/
│  ├─ AccountSettingsPage.tsx
│  └─ ApiKeysPanel.tsx
└─ inlineCompletion/
   ├─ InlineCompletionProvider.ts
   └─ DiffPanel.ts
```

### Modified Files
```
platform/HITL/rbac.ts             → Replaced by rbac-engine-v2.ts
platform/HITL/autonomy.ts         → Remove autonomous_agent references
platform/src/services/tool-executor.ts  → ⭐ CRITICAL: Fetch user's vLLM key from api_keys table
                                      and pass to gateway (not .env key)
platform/src/config/env.ts        → Add POSTGRES_URL, JWT_SECRET
platform/src/server/index.ts      → Mount new auth/admin/completion routes
platform/vscode-extension/src/ChatViewProvider.ts  → Add AuthGuard, API key validation
```

---

## ENVIRONMENT VARIABLES (UPDATED)

```bash
# Existing (but VLLM_GATEWAY_KEY role is changing)
THIRDWAVE_URL=http://localhost:3100
VLLM_GATEWAY_URL=http://172.30.140.63:9080/v1
VLLM_GATEWAY_KEY=<your-personal-key>  # ⭐ NOW: Fallback/testing only (not for production multi-user)
                                       # Each developer uses THEIR key from api_keys table

# New (Phase 1)
POSTGRES_URL=postgresql://user:pass@localhost:5432/thirdwave
PGBOUNCER_URL=postgresql://user:pass@localhost:6432/thirdwave

# New (Phase 3)
JWT_SECRET=<random 64-byte hex>
JWT_EXPIRY=8h
ONBOARDING_TOKEN_EXPIRY=24h

# New (Phase 5)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
APPROVAL_EXPIRY_MINUTES=30

# New (Phase 6)
ADMIN_DASHBOARD_URL=http://localhost:3100/admin
```

---

## WHAT WE ARE NOT BUILDING

These were considered and explicitly excluded:

| Item | Decision | Reason |
|------|----------|--------|
| `autonomous_agent` role | ❌ Removed | Too risky; all agent actions require human in the loop |
| Usage analytics (tokens/cost) | ❌ Not in Thirdwave | Inference team already tracks via local gateway |
| Multi-tenancy | ❌ Not needed | Single org deployment only |
| External LLM keys (Claude/OpenAI) | ❌ Not applicable | Platform uses local vLLM gateway exclusively |
| Approval popups for `deny` decisions | ❌ Not built | Deny = block + silent log; no notification needed |
| Inline completion auto-trigger on every keystroke | ❌ Not built | Only on explicit command or selection |

---

## SUCCESS CRITERIA

| Phase | Milestone | How to Verify |
|-------|-----------|---------------|
| Phase 1 | PostgreSQL live | `GET /health/db` returns table count = 14 |
| Phase 2 | Data migrated | Row counts match between old SQLite and new PostgreSQL |
| Phase 3 | RBAC in DB | Update a policy via SQL → tool behavior changes with no redeploy |
| Phase 3 | User auth | Register → approve → login → receive JWT |
| Phase 4 | API keys | User sets vLLM key during onboarding → agent uses THAT key (not .env); revoke key → agent returns 401 |
| Phase 4 | ⭐ Email-Based Tracking | User (alice@company.com) registers in agent with same email as infra team → all usage tracked under alice@company.com in vLLM gateway |
| Phase 5 | HITL notifications | Trigger `bash` as developer → Slack message arrives within 5s |
| Phase 6 | Extension UI | Full flow: register → approve → set key → chat with agent → inline completion |
| Phase 7–8 | Inline completion | Trigger completion → diff panel shows → accept → file updated in-place ✅ |

---

## RISK FLAGS

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| PostgreSQL migration corrupts data | Low | Run in staging first; 14-day SQLite backup kept |
| JWT secret rotated in production | Low | Store in secrets manager; rotation procedure documented |
| vLLM gateway rejects key | Medium | `api-key-middleware` catches 401 and returns clear error to user |
| Inline completion latency > 3s | Medium | Add timeout (3s max); fail gracefully with "no suggestion" instead of blocking |
| Admin never approves registrations | Low | Auto-remind Slack after 24h; fallback: super-admin CLI command to approve |

---

## TOOLS & STACK (No Changes)

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Backend Framework | Hono |
| Database | PostgreSQL + PgBouncer |
| Auth | JWT (jsonwebtoken) + bcrypt |
| VS Code Extension | TypeScript + VS Code API |
| TUI | Node.js readline + chalk |
| LLM Inference | Local vLLM (port 8000) + Gateway (port 9080) |
| Tool Calling | Text-based XML parsing (no native JSON tools — gateway compatibility) |
| Session Management | OpenCode (port 4096) |

---

*End of Plan — All decisions finalized April 8, 2026.*
