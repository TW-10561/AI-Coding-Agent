# Current Schema vs Proposed Schema — Thirdwave Platform

---

## CURRENT SCHEMA (Multiple DBs - Fragmented)

### 1. **OpenCode State DB** (SQLite - `opencode-state`)
Location: `opencode-state` volume (Docker)

```sql
-- OpenCode manages these internally (exact schema not exposed to us)
-- But we know it contains:
- sessions (id, state JSON, created_at, updated_at)
- messages (id, session_id, role, content, tool_calls)
- task_queue (id, session_id, tool_call, status)
```

**Current behavior:** Platform talks to OpenCode via HTTP (port 4096). We DON'T query this DB directly.

---

### 2. **Platform Workspaces DB** (SQLite - `platform-workspaces.db`)
Location: Local filesystem

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,                        -- ULID
  name TEXT NOT NULL,
  directory TEXT NOT NULL UNIQUE,
  description TEXT,
  tags TEXT DEFAULT '[]',                     -- JSON array as string
  active INTEGER NOT NULL DEFAULT 0,          -- 0/1 boolean
  created_at INTEGER NOT NULL,                -- Unix timestamp
  last_accessed_at INTEGER NOT NULL,
  metadata TEXT DEFAULT '{}'                  -- JSON object as string
);

-- Indexes
CREATE INDEX idx_ws_active ON workspaces(active);
CREATE INDEX idx_ws_dir ON workspaces(directory);
```

**Current behavior:** Platform owns workspaces fully. Manages workspace lifecycle locally.

---

### 3. **Platform Audit Log** (SQLite - embedded in `audit-logger.ts`)
Location: Local SQLite (TBD exact file)

```sql
-- Inferred schema from code:
CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,                        -- ULID
  timestamp INTEGER NOT NULL,                 -- Unix timestamp ms
  action TEXT NOT NULL,                       -- "session.create", "prompt.send", etc.
  userID TEXT,
  sessionID TEXT,
  taskID TEXT,
  workspaceID TEXT,
  metadata TEXT,                              -- JSON as string
  duration INTEGER,
  success INTEGER,                            -- 0/1 boolean
  error TEXT
);
```

**Current behavior:** Append-only log. No RBAC integration. No approval tracking.

---

### 4. **HITL RBAC** (In-Memory Config - `rbac.ts`)
Location: `platform/HITL/rbac.ts`

```typescript
// NOT in any database - hardcoded in code
const rolePolicies = {
  admin: { permissions: { "*": "allow" } },
  developer: { permissions: { "bash": "ask", "read_file": "allow", ... } },
  readonly: { permissions: { "bash": "deny", "read_file": "allow", ... } },
  autonomous_agent: { permissions: { "*": "ask" } }
};

// Risk scoring (hardcoded thresholds)
// Destructive: 95 critical, 85 high, 60 medium, 30 low
// Package install: 40
// Network: 30
```

**Current behavior:** Static 4 roles. No runtime flexibility. No approval workflow. No database persistence.

---

### 5. **Summary of Current Schema**

| Component | DB Type | Tables | Owned By | Flexible? |
|-----------|---------|--------|----------|-----------|
| Sessions/Messages | SQLite | 2–3 | OpenCode (HTTP) | ❌ No |
| Workspaces | SQLite | 1 | Platform | ✅ Yes |
| Audit Log | SQLite | 1 | Platform | ⚠️ Append-only |
| RBAC/Roles | Memory/Config | — | Platform | ❌ Hardcoded |
| **Total** | **3 DBs** | **~5 tables** | **Fragmented** | **❌ Low** |

---

## PROPOSED SCHEMA (Single PostgreSQL - Unified, Single Organization)

### Consolidated PostgreSQL: `thirdwave_prod`

**NOTE:** No `organizations` table since Thirdwave is a single team deployment.

```sql
-- 1. USERS & AUTHENTICATION ──────────────────────────────

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  password_hash TEXT,                         -- bcrypt
  role_id UUID REFERENCES roles(id),
  is_active BOOLEAN DEFAULT true,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT now()
);

-- 2. ROLES (DYNAMIC, FLEXIBLE) ───────────────────────────

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,                  -- "admin", "developer", "readonly", etc.
  description TEXT,
  is_built_in BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);

-- 3. TOOL ACCESS POLICIES ────────────────────────────────

CREATE TABLE tool_access_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name TEXT NOT NULL,                    -- "bash", "read_file", "write_file", etc.
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  decision TEXT NOT NULL,                     -- "allow", "ask", "deny"
  conditions JSONB,                           -- Max iterations, timeouts, etc.
  created_at TIMESTAMP DEFAULT now(),
  created_by UUID REFERENCES users(id),
  UNIQUE(tool_name, role_id),
  CHECK (decision IN ('allow', 'ask', 'deny'))
);

-- 4. PATH ACCESS RULES (DIRECTORY-LEVEL PERMISSIONS) ─────

CREATE TABLE path_access_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  path_pattern TEXT NOT NULL,                 -- "/workspace/*", "/etc", etc.
  readable BOOLEAN DEFAULT false,
  writable BOOLEAN DEFAULT false,
  executable BOOLEAN DEFAULT false,
  priority INTEGER DEFAULT 0,                 -- Higher priority wins
  created_at TIMESTAMP DEFAULT now(),
  created_by UUID REFERENCES users(id)
);

-- 5. WORKSPACES (FROM OLD SQLITE) ─────────────────────────

CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  directory TEXT NOT NULL UNIQUE,
  description TEXT,
  tags TEXT,                                  -- CSV or JSON
  active BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now(),
  last_accessed_at TIMESTAMP DEFAULT now(),
  metadata JSONB
);

-- 6. SESSIONS (FROM OPENCODE VIA SYNC) ────────────────────

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                        -- From OpenCode
  workspace_id UUID REFERENCES workspaces(id),
  user_id UUID REFERENCES users(id),
  state JSONB NOT NULL,                       -- OpenCode state snapshot
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  synced_from_opencode_at TIMESTAMP           -- When last synced from port 4096
);

-- 7. MESSAGES (FROM OPENCODE VIA SYNC) ───────────────────

CREATE TABLE messages (
  id TEXT PRIMARY KEY,                        -- From OpenCode
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                         -- "user", "assistant"
  content TEXT NOT NULL,
  tool_calls JSONB,                           -- Tool invocations
  created_at TIMESTAMP DEFAULT now(),
  synced_from_opencode_at TIMESTAMP
);

-- 8. APPROVAL REQUESTS (HITL WORKFLOW) ────────────────────

CREATE TABLE approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  tool_name TEXT NOT NULL,                    -- "bash", "write_file", etc.
  tool_args JSONB NOT NULL,                   -- Arguments for the tool
  requested_by UUID NOT NULL REFERENCES users(id),
  requested_at TIMESTAMP DEFAULT now(),
  status TEXT DEFAULT 'pending',              -- "pending", "approved", "denied", "expired"
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMP,
  denial_reason TEXT,
  expiration_at TIMESTAMP,
  risk_score INTEGER,                         -- Risk assessment (0–100)
  risk_factors JSONB,                         -- {"destructive": 95, "network": 30, ...}
  UNIQUE(session_id, tool_name, requested_at),
  CHECK (status IN ('pending', 'approved', 'denied', 'expired'))
);

-- 9. AUDIT LOG (COMPLIANCE - EXPANDED FROM OLD) ──────────

CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  session_id TEXT REFERENCES sessions(id),
  approval_id UUID REFERENCES approval_requests(id),
  action TEXT NOT NULL,                       -- "tool.executed", "approval.created", "policy.updated", etc.
  resource_type TEXT,                         -- "tool", "path_rule", "role", "workspace"
  resource_id TEXT,
  result TEXT NOT NULL,                       -- "allow", "deny", "ask", "error", "approved", "rejected"
  risk_score INTEGER,                         -- Risk at time of action
  details JSONB,                              -- Metadata, error messages, etc.
  ip_address TEXT,
  user_agent TEXT,
  timestamp TIMESTAMP DEFAULT now(),
  CHECK (result IN ('allow', 'deny', 'ask', 'error', 'approved', 'rejected'))
);

-- 10. TOOL METADATA ──────────────────────────────────────

CREATE TABLE tool_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,                  -- "bash", "read_file", etc.
  description TEXT,
  parameters JSONB,                           -- Parameter schema
  is_risky BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now()
);

-- 11. RISK ENGINE SCORES (OPTIONAL - FOR ANALYTICS) ──────

CREATE TABLE risk_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name TEXT,
  command_pattern TEXT,
  base_risk INTEGER,                          -- 0–100
  factors JSONB,                              -- Scoring factors
  created_at TIMESTAMP DEFAULT now()
);

-- INDEXES (Performance) ──────────────────────────────────

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_active ON users(is_active);
CREATE INDEX idx_roles_name ON roles(name);
CREATE INDEX idx_tool_policies_lookup ON tool_access_policies(tool_name, role_id);
CREATE INDEX idx_path_rules_lookup ON path_access_rules(role_id, path_pattern);
CREATE INDEX idx_workspaces_active ON workspaces(active);
CREATE INDEX idx_workspaces_dir ON workspaces(directory);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_messages_session_time ON messages(session_id, created_at DESC);
CREATE INDEX idx_approvals_status_time ON approval_requests(status, requested_at DESC);
CREATE INDEX idx_approvals_user ON approval_requests(requested_by);
CREATE INDEX idx_audit_time ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_user ON audit_log(user_id, timestamp DESC);
CREATE INDEX idx_audit_session ON audit_log(session_id, timestamp DESC);
```

---

## COMPARISON TABLE

| Aspect | Current | Proposed |
|--------|---------|----------|
| **Database Engine** | SQLite (3 instances) | PostgreSQL (1 instance) |
| **Total Tables** | ~5 | **11** (removed organizations) |
| **Multi-tenancy** | ❌ None | ❌ Not needed (single org) |
| **RBAC** | ❌ Hardcoded (4 roles) | ✅ Dynamic (unlimited roles) |
| **Tool Policies** | ❌ In-memory map | ✅ DB table + queries |
| **Path Rules** | ❌ Not implemented | ✅ DB table with patterns |
| **Approval Workflow** | ❌ None | ✅ Full HITL table |
| **User Management** | ❌ None | ✅ users table |
| **Role Management** | ❌ None | ✅ roles table |
| **Audit Logging** | ⚠️ Basic (1 table) | ✅ Comprehensive (1 table, expanded) |
| **Compliance Ready** | ⚠️ Partial | ✅ Full |
| **Scalability** | 1–5 users | 50–500 users |
| **Connection Pooling** | ❌ None | ✅ PgBouncer |
| **High Availability** | ❌ None | ✅ Streaming replication |
| **Backup Strategy** | ❌ Manual | ✅ WAL archiving + daily snapshots |

---

## WHAT HITL MEANS (Two Core Tables Only)

### 1. **approval_requests** — **CORE HITL TABLE**
- **Purpose:** Track approval workflow (Human-In-The-Loop)
- **How it works:**
  1. Tool action receives risk assessment (e.g., `bash` command = 85 risk score)
  2. RBAC engine says: "developer role → bash = 'ask'" (requires approval)
  3. System creates row in `approval_requests` with:
     - `tool_name`: "bash"
     - `tool_args`: the actual command
     - `requested_by`: userId who caused this
     - `status`: "pending"
     - `risk_score`: 85
  4. **Human approver** sees request (via webhook/UI)
  5. Approver clicks "Approve" or "Deny"
  6. System updates row: `status: "approved"`, `approved_by`: approverUserId
  7. Tool execution proceeds (or is blocked)

- **HITL benefit:** Prevents autonomous agents from doing risky things without human sign-off

---

### 2. **audit_log** — **HITL COMPLIANCE**
- **Purpose:** Immutable record of all actions (audit trail for forensics)
- **HITL connection:**
  - Records **every HITL decision** (tool requested, who approved/denied, when)
  - Enables compliance: "Who approved this risky bash command? When? Why?"
  - Example audit entry:
    ```json
    {
      "action": "approval_request.approved",
      "approval_id": "uuid-123",
      "requested_by": "user-alice",
      "approved_by": "user-bob",
      "tool_name": "bash",
      "result": "approved",
      "timestamp": "2026-04-07T10:30:00Z"
    }
    ```

- **HITL benefit:** Tamper-evident proof of human oversight; required for SOC2/FedRAMP compliance

---

## WHAT HITL MEANS IN THESE THREE TABLES

### 1. **organizations** — NOT HITL
- **Purpose:** Isolate data by team/company (multi-tenancy)
- **HITL connection:** Enables role-based approval workflows per organization
- **Example:** Org "ACME Corp" has 10 users; Org "TechStartup" has 5 users. Each org's approval requests, audit logs, and policies are separate.

---

### 2. **approval_requests** — **CORE HITL TABLE**
- **Purpose:** Track approval workflow (Human-In-The-Loop)
- **How it works:**
  1. Tool action receives risk assessment (e.g., `bash` command = 85 risk score)
  2. RBAC engine says: "developer role → bash = 'ask'" (requires approval)
  3. System creates row in `approval_requests` with:
     - `tool_name`: "bash"
     - `tool_args`: the actual command
     - `requested_by`: userId who caused this
     - `status`: "pending"
     - `risk_score`: 85
  4. **Human approver** sees request (via webhook/UI)
  5. Approver clicks "Approve" or "Deny"
  6. System updates row: `status: "approved"`, `approved_by`: approverUserId
  7. Tool execution proceeds (or is blocked)

- **HITL benefit:** Prevents autonomous agents from doing risky things without human sign-off

---

### 3. **audit_log** — **HITL COMPLIANCE**
- **Purpose:** Immutable record of all actions (audit trail for forensics)
- **HITL connection:**
  - Records **every HITL decision** (tool requested, who approved/denied, when)
  - Enables compliance: "Who approved this risky bash command? When? Why?"
  - Example audit entry:
    ```json
    {
      "action": "approval_request.approved",
      "approval_id": "uuid-123",
      "requested_by": "user-alice",
      "approved_by": "user-bob",
      "tool_name": "bash",
      "result": "approved",
      "timestamp": "2026-04-07T10:30:00Z"
    }
    ```

- **HITL benefit:** Tamper-evident proof of human oversight; required for SOC2/FedRAMP compliance

---

## WORK TIMELINE: Current → Proposed

### Phase 1: Schema Setup (1 week - 25 hours)
- **Days 1–2 (8 hours):** PostgreSQL provisioning + PgBouncer setup
- **Days 3–4 (10 hours):** Create all 11 tables, indexes, constraints
- **Days 5 (7 hours):** Seed default roles (admin, developer, readonly) and tool policies

**Deliverable:** Empty PostgreSQL with schema ready

---

### Phase 2: Data Migration (1 week - 30 hours)
- **Days 1–2 (8 hours):** Export SQLite workspaces → PostgreSQL workspaces
- **Days 3–4 (12 hours):** Sync OpenCode sessions/messages → PostgreSQL (via HTTP polling)
- **Days 5 (10 hours):** Migrate audit log entries → PostgreSQL; validate consistency

**Deliverable:** All historical data in PostgreSQL; no data loss

---

### Phase 3: Engine Integration (1 week - 30 hours)
- **Days 1–2 (10 hours):** Write RBACEngineV2 class (tool checks, path checks, approvals)
- **Days 3–4 (12 hours):** Integrate into tool-executor; add path validation before execution
- **Days 5 (8 hours):** Test RBAC deny/allow/ask flow end-to-end

**Deliverable:** Tool execution gated by PostgreSQL RBAC policies

---

### Phase 4: API Endpoints (1 week - 25 hours)
- **Days 1–2 (8 hours):** Build `/rbac/*` endpoints (list policies, set policies, list rules)
- **Days 3–4 (12 hours):** Build `/approvals/*` endpoints (list pending, approve, deny)
- **Days 5 (5 hours):** Build `/audit` endpoint (query logs)

**Deliverable:** REST API for policy admin + approval management

---

### Phase 5: Approval Workflow UI (1 week - 20 hours)
- **Days 1–3 (12 hours):** Build approval notification system (Slack/email webhook)
- **Days 4–5 (8 hours):** Simple web UI for approvers (list pending, approve, deny)

**Deliverable:** Approvers can see and act on requests

---

### Phase 6: Testing + Rollout (1 week - 25 hours)
- **Days 1–2 (8 hours):** Unit tests (RBAC engine, audit logging)
- **Days 3–4 (10 hours):** Integration tests (tool executor + approval flow)
- **Days 5 (7 hours):** Shadow mode (PostgreSQL runs in parallel, SQLite still primary)

**Deliverable:** Zero-downtime cutover to PostgreSQL

---

## TOTAL WORK TIMELINE

| Phase | Duration | Effort | Owner |
|-------|----------|--------|-------|
| 1. Schema Setup | 1 week | 25h | DevOps + DBA |
| 2. Data Migration | 1 week | 30h | Backend + DBA |
| 3. Engine Integration | 1 week | 30h | Backend |
| 4. API Endpoints | 1 week | 25h | Backend |
| 5. Approval UI | 1 week | 20h | Backend + Frontend |
| 6. Testing + Rollout | 1 week | 25h | QA + DevOps |
| **TOTAL** | **6 weeks** | **155 hours** | **Full team** |

---

## Parallel Work Opportunity

If you have 2–3 engineers:
- **Engineer A:** Schema setup + data migration (weeks 1–2)
- **Engineer B:** RBACEngineV2 + tool integration (weeks 1–2, in parallel)
- **Engineer C:** API endpoints + UI (weeks 3–4, waits for schema)
- **QA:** Testing (weeks 5–6)

**Risk:** Requires tight coordination. Recommend starting phases 1–2 in parallel with caution.

---

## Recommended Next Steps

1. **Immediate:** Provision PostgreSQL instance (managed service recommended: AWS RDS, Azure Database, etc.)
2. **Week 1:** Run Phase 1 + early Phase 2 (export workspaces, validate counts)
3. **Week 2:** Complete Phase 2 (full data sync); start Phase 3 (RBACEngineV2)
4. **Weeks 3–6:** Complete phases 3–6 as team capacity allows

---

**Ready to start Phase 1?**
