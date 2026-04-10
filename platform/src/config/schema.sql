-- ---------------------------------------------------------------------------
-- Thirdwave Platform — PostgreSQL Schema (14 tables)
-- ---------------------------------------------------------------------------
-- Auto-executed on first docker-compose up via initdb.d mount.
-- Idempotent: uses IF NOT EXISTS throughout.
-- ---------------------------------------------------------------------------

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. ROLES — dynamic role definitions (not hardcoded)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(50) NOT NULL UNIQUE,
  description   TEXT,
  is_built_in   BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. USERS — authenticated platform users
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           VARCHAR(255) NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  role_id         UUID NOT NULL REFERENCES roles(id),
  company         VARCHAR(255),
  status          VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  verified_email  BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  last_login_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. REGISTRATION_REQUESTS — admin approval queue for new signups
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS registration_requests (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               VARCHAR(255) NOT NULL UNIQUE,
  password_hash       VARCHAR(255) NOT NULL,
  requested_role      UUID REFERENCES roles(id),
  company             VARCHAR(255),
  status              VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  verification_token  VARCHAR(255),
  reviewed_by         UUID REFERENCES users(id),
  review_reason       TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at         TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reg_requests_status ON registration_requests(status);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. API_KEYS — per-user vLLM inference gateway keys
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS api_keys (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash              VARCHAR(255) NOT NULL,
  key_preview           VARCHAR(30),
  display_name          VARCHAR(100),
  key_type              VARCHAR(20) DEFAULT 'vllm' CHECK (key_type IN ('vllm', 'custom')),
  inference_gateway_url VARCHAR(255),
  status                VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  last_used_at          TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ,
  revoked_at            TIMESTAMPTZ,
  revoked_by            UUID REFERENCES users(id),
  rotation_salt         VARCHAR(32)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user   ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(user_id, status);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. API_KEY_AUDIT_LOG — key lifecycle events only
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS api_key_audit_log (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users(id),
  api_key_id              UUID REFERENCES api_keys(id),
  action                  VARCHAR(20) NOT NULL CHECK (action IN ('created', 'rotated', 'revoked', 'validated', 'expired')),
  ip_address              INET,
  gateway_response_status INT,
  timestamp               TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_key_audit_user ON api_key_audit_log(user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. TOOL_METADATA — 17 registered agent tools
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tool_metadata (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  risky       BOOLEAN DEFAULT FALSE,
  category    VARCHAR(50) CHECK (category IN ('filesystem', 'shell', 'web', 'agent', 'search')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. TOOL_ACCESS_POLICIES — RBAC matrix (4 roles × 17 tools = 68 rows)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tool_access_policies (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name  VARCHAR(100) NOT NULL REFERENCES tool_metadata(name),
  role_id    UUID NOT NULL REFERENCES roles(id),
  decision   VARCHAR(10) NOT NULL CHECK (decision IN ('allow', 'ask', 'deny')),
  updated_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tool_name, role_id)
);

CREATE INDEX IF NOT EXISTS idx_tool_policies_lookup ON tool_access_policies(tool_name, role_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. PATH_ACCESS_RULES — directory-level access per role
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS path_access_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id      UUID NOT NULL REFERENCES roles(id),
  path_pattern VARCHAR(255) NOT NULL,
  readable     BOOLEAN DEFAULT FALSE,
  writable     BOOLEAN DEFAULT FALSE,
  executable   BOOLEAN DEFAULT FALSE,
  priority     INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_path_rules_role ON path_access_rules(role_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. APPROVAL_REQUESTS — pending HITL approvals for 'ask' decisions
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS approval_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      VARCHAR(255) NOT NULL,
  tool_name       VARCHAR(100) NOT NULL,
  tool_args       JSONB,
  requested_by    UUID NOT NULL REFERENCES users(id),
  status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  reviewed_by     UUID REFERENCES users(id),
  risk_score      INT,
  decision_reason TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_approvals_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approvals_session ON approval_requests(session_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. AUDIT_LOG — immutable compliance trail for all decisions
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS audit_log (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action    VARCHAR(100) NOT NULL,
  result    VARCHAR(50),
  user_id   UUID REFERENCES users(id),
  resource  VARCHAR(255),
  metadata  JSONB,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_user      ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. WORKSPACES
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS workspaces (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(255) NOT NULL,
  directory  TEXT NOT NULL,
  tags       TEXT[],
  owner_id   UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. SESSIONS
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  user_id      UUID REFERENCES users(id),
  agent_type   VARCHAR(50),
  model_id     VARCHAR(255),
  status       VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user      ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 13. MESSAGES
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content    TEXT NOT NULL,
  tool_calls JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 14. RISK_SCORES — per-session risk tracking
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS risk_scores (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id),
  tool_name  VARCHAR(100),
  score      INT NOT NULL,
  factors    JSONB,
  timestamp  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_risk_session ON risk_scores(session_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 15. BUDGET_LIMITS — per-user token/request/cost caps
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS budget_limits (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        TEXT NOT NULL,
  window         VARCHAR(10) NOT NULL CHECK (window IN ('hour', 'day', 'month', 'total')),
  max_tokens     BIGINT,
  max_requests   BIGINT,
  max_cost_cents BIGINT,
  hard_limit     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, window)
);

CREATE INDEX IF NOT EXISTS idx_budget_limits_user ON budget_limits(user_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 16. BUDGET_USAGE — per-request token consumption records
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS budget_usage (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  timestamp     TIMESTAMPTZ DEFAULT NOW(),
  tokens_input  BIGINT NOT NULL DEFAULT 0,
  tokens_output BIGINT NOT NULL DEFAULT 0,
  cost_cents    BIGINT NOT NULL DEFAULT 0,
  session_id    TEXT,
  task_id       TEXT,
  model_id      TEXT
);

CREATE INDEX IF NOT EXISTS idx_budget_usage_user ON budget_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_budget_usage_ts   ON budget_usage(timestamp);

-- ═══════════════════════════════════════════════════════════════════════════
-- 17. TASKS — persistent task state machine
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tasks (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL DEFAULT 'default',
  workspace_id     TEXT,
  session_id       TEXT,
  orchestration_id TEXT,
  type             VARCHAR(20) NOT NULL DEFAULT 'prompt' CHECK (type IN ('prompt', 'subagent', 'parallel', 'custom')),
  state            VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'completed', 'failed', 'aborted', 'paused', 'retrying')),
  title            TEXT NOT NULL,
  prompt           TEXT NOT NULL,
  agent_id         TEXT,
  model_id         TEXT,
  progress         INT NOT NULL DEFAULT 0,
  current_step     TEXT,
  result           TEXT,
  error            TEXT,
  retries          INT NOT NULL DEFAULT 0,
  max_retries      INT NOT NULL DEFAULT 2,
  priority         INT NOT NULL DEFAULT 5,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  metadata         JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_tasks_state    ON tasks(state);
CREATE INDEX IF NOT EXISTS idx_tasks_user     ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_ws       ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tasks_orch     ON tasks(orchestration_id);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority, created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- 18. CHAT_SESSIONS — VS Code extension chat history
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chat_sessions (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  model           TEXT NOT NULL DEFAULT '',
  message_count   INT NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_session_time ON chat_sessions(last_message_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 19. CHAT_ENTRIES — individual chat messages
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS chat_entries (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL DEFAULT '',
  model           TEXT NOT NULL DEFAULT '',
  tool_call_count INT NOT NULL DEFAULT 0,
  latency_ms      INT,
  timestamp       TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_entry_session ON chat_entries(session_id);
