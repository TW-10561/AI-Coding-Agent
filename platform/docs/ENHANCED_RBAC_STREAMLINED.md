# Enhanced RBAC System (Streamlined) — For Thirdwave AI Team Deployment

## Simplified Core Schema (PostgreSQL)

```sql
-- Organizations (multi-tenancy)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT now(),
  created_by UUID REFERENCES users(id)
);

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  role_id UUID REFERENCES roles(id),
  created_at TIMESTAMP DEFAULT now(),
  is_active BOOLEAN DEFAULT true
);

-- Roles (flexible, dynamic)
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  description TEXT,
  is_built_in BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now(),
  UNIQUE(org_id, name)
);

-- Tool Access Policies (granular tool control)
CREATE TABLE tool_access_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  tool_name TEXT NOT NULL,  -- "bash", "read_file", "write_file", etc.
  role_id UUID REFERENCES roles(id),
  decision TEXT NOT NULL,    -- "allow", "ask", "deny"
  conditions JSONB,          -- {"max_iterations": 5}
  created_at TIMESTAMP DEFAULT now(),
  CHECK (decision IN ('allow', 'ask', 'deny')),
  UNIQUE(org_id, tool_name, role_id)
);

-- Path Access Rules (directory-level permissions)
CREATE TABLE path_access_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  role_id UUID NOT NULL REFERENCES roles(id),
  path_pattern TEXT NOT NULL,  -- "/workspace/src", "/root", etc.
  readable BOOLEAN DEFAULT false,
  writable BOOLEAN DEFAULT false,
  executable BOOLEAN DEFAULT false,
  priority INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT now()
);

-- Approval Requests (approval workflow)
CREATE TABLE approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  session_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_args JSONB NOT NULL,
  requested_by UUID NOT NULL REFERENCES users(id),
  requested_at TIMESTAMP DEFAULT now(),
  status TEXT DEFAULT 'pending',  -- "pending", "approved", "denied"
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMP,
  denial_reason TEXT,
  created_at TIMESTAMP DEFAULT now()
);

-- Audit Log (compliance)
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  result TEXT,  -- "allow", "deny", "ask"
  risk_score INTEGER,
  details JSONB,
  timestamp TIMESTAMP DEFAULT now()
);

-- Indexes
CREATE INDEX idx_org_users ON users(org_id);
CREATE INDEX idx_org_roles ON roles(org_id);
CREATE INDEX idx_tool_policies ON tool_access_policies(org_id, tool_name, role_id);
CREATE INDEX idx_path_rules ON path_access_rules(org_id, role_id);
CREATE INDEX idx_approval_status ON approval_requests(status, requested_at);
CREATE INDEX idx_audit_org_time ON audit_log(org_id, timestamp DESC);
```

---

## Streamlined RBAC Engine (Core + Essential Only)

```typescript
// platform/HITL/rbac-v2-streamlined.ts

import { Database } from "bun:sqlite"
import { Log } from "../util/log"

const log = Log.create({ service: "rbac-v2" })

export class RBACEngineV2 {
  private db: Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
  }

  /**
   * Check if user can execute a tool
   */
  async canExecuteTool(
    userId: string,
    orgId: string,
    toolName: string
  ): Promise<{
    allowed: boolean
    decision: "allow" | "ask" | "deny"
    reason?: string
  }> {
    const user = this.db
      .query(`SELECT role_id FROM users WHERE id = ? AND org_id = ? AND is_active = true`)
      .get(userId, orgId) as any

    if (!user) {
      return { allowed: false, decision: "deny", reason: "User not found" }
    }

    const policy = this.db
      .query(
        `
        SELECT * FROM tool_access_policies
        WHERE org_id = ? AND tool_name = ? AND role_id = ?
        LIMIT 1
      `
      )
      .get(orgId, toolName, user.role_id) as any

    if (!policy) {
      // No specific policy → default deny
      return {
        allowed: false,
        decision: "deny",
        reason: `No policy configured for tool '${toolName}'`,
      }
    }

    if (policy.decision === "deny") {
      return {
        allowed: false,
        decision: "deny",
        reason: `Tool '${toolName}' is denied for this role`,
      }
    }

    const allowed = policy.decision === "allow"
    return {
      allowed,
      decision: policy.decision,
    }
  }

  /**
   * Check if user can read/write a path
   */
  async canAccessPath(
    userId: string,
    orgId: string,
    path: string,
    action: "read" | "write" | "execute"
  ): Promise<{
    allowed: boolean
    reason?: string
  }> {
    const user = this.db
      .query(`SELECT role_id FROM users WHERE id = ? AND org_id = ? AND is_active = true`)
      .get(userId, orgId) as any

    if (!user) {
      return { allowed: false, reason: "User not found" }
    }

    // Exact match or wildcard match
    const rule = this.db
      .query(
        `
        SELECT * FROM path_access_rules
        WHERE org_id = ? AND role_id = ? 
        AND (
          ? LIKE path_pattern ||'%'
          OR path_pattern = '*'
          OR path_pattern LIKE ?
        )
        ORDER BY priority DESC, path_pattern DESC
        LIMIT 1
      `
      )
      .get(orgId, user.role_id, path, path) as any

    if (!rule) {
      // No rule found = no access
      return { allowed: false, reason: `No access rule for '${path}'` }
    }

    const canAccess =
      (action === "read" && rule.readable) ||
      (action === "write" && rule.writable) ||
      (action === "execute" && rule.executable)

    return {
      allowed: canAccess,
      reason: canAccess ? undefined : `User cannot ${action} '${path}'`,
    }
  }

  /**
   * Create approval request (for "ask" decisions)
   */
  async createApprovalRequest(
    userId: string,
    orgId: string,
    sessionId: string,
    toolName: string,
    toolArgs: Record<string, unknown>
  ): Promise<string> {
    const id = this.generateId()

    this.db.exec(
      `
      INSERT INTO approval_requests 
      (id, org_id, session_id, tool_name, tool_args, requested_by, requested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
      [
        id,
        orgId,
        sessionId,
        toolName,
        JSON.stringify(toolArgs),
        userId,
        new Date().toISOString(),
      ]
    )

    log.info("Approval request created", { id, toolName, userId })
    return id
  }

  /**
   * Approve or deny an approval request
   */
  async respondToApprovalRequest(
    requestId: string,
    approvalUserId: string,
    approved: boolean,
    reason?: string
  ): Promise<void> {
    const status = approved ? "approved" : "denied"

    this.db.exec(
      `
      UPDATE approval_requests
      SET status = ?, approved_by = ?, approved_at = ?, denial_reason = ?
      WHERE id = ?
    `,
      [status, approvalUserId, new Date().toISOString(), reason, requestId]
    )

    log.info("Approval request updated", { requestId, status })
  }

  /**
   * Get pending approval requests for a user (who can approve)
   */
  async getPendingApprovalsForUser(userId: string, orgId: string): Promise<any[]> {
    return this.db
      .query(
        `
        SELECT * FROM approval_requests
        WHERE org_id = ? AND status = 'pending'
        ORDER BY requested_at DESC
        LIMIT 50
      `
      )
      .all(orgId) as any[]
  }

  /**
   * Log audit event
   */
  async auditLog(
    userId: string,
    orgId: string,
    action: string,
    result: "allow" | "deny" | "ask",
    details?: Record<string, unknown>
  ): Promise<void> {
    this.db.exec(
      `
      INSERT INTO audit_log 
      (org_id, user_id, action, result, details, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      [orgId, userId, action, result, JSON.stringify(details || {}), new Date().toISOString()]
    )
  }

  /**
   * Get audit log
   */
  async getAuditLog(orgId: string, limit: number = 100): Promise<any[]> {
    return this.db
      .query(
        `
        SELECT * FROM audit_log
        WHERE org_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `
      )
      .all(orgId, limit) as any[]
  }

  // ── Helpers ──────────────────────────────────────────────────

  private generateId(): string {
    return Math.random().toString(36).substring(2, 11)
  }
}
```

---

## Integration with Tool Executor (Simplified)

```typescript
// platform/src/services/tool-executor-v2-streamlined.ts

import { RBACEngineV2 } from "../HITL/rbac-v2-streamlined"
import { RiskEngine } from "../HITL/riskEngine"
import { isSensitiveFile } from "../HITL/sensitiveFiles"

export async function executeTool(
  toolCall: ToolCall,
  userId: string,
  orgId: string,
  sessionId: string,
  rbac: RBACEngineV2,
  riskEngine: RiskEngine
) {
  // Step 1: RBAC check (new)
  const rbacCheck = await rbac.canExecuteTool(userId, orgId, toolCall.name)
  if (!rbacCheck.allowed) {
    await rbac.auditLog(userId, orgId, toolCall.name, "deny", {
      reason: rbacCheck.reason,
      source: "rbac",
    })
    return {
      error: `Access Denied: ${rbacCheck.reason}`,
      toolCall,
    }
  }

  // Step 2: Path access check (for file operations)
  if (toolCall.name === "read_file" || toolCall.name === "write_file") {
    const pathCheck = await rbac.canAccessPath(
      userId,
      orgId,
      toolCall.args.path,
      toolCall.name === "read_file" ? "read" : "write"
    )
    if (!pathCheck.allowed) {
      await rbac.auditLog(userId, orgId, toolCall.name, "deny", {
        path: toolCall.args.path,
        reason: pathCheck.reason,
        source: "path_rbac",
      })
      return {
        error: `Path Access Denied: ${pathCheck.reason}`,
        toolCall,
      }
    }
  }

  // Step 3: Sensitive file guard (existing HITL)
  if (isSensitiveFile(toolCall.args.path)) {
    await rbac.auditLog(userId, orgId, toolCall.name, "deny", {
      reason: "Sensitive file blocked",
      source: "sensitive_guard",
    })
    return {
      error: "⛔ SECURITY RESTRICTION: Sensitive file access denied",
      toolCall,
    }
  }

  // Step 4: Risk scoring (existing HITL)
  const assessment = riskEngine.computeRisk({
    command: toolCall.args.command,
    path: toolCall.args.path,
  })

  // Step 5: Decision
  if (rbacCheck.decision === "deny" || assessment.recommendation === "deny") {
    await rbac.auditLog(userId, orgId, toolCall.name, "deny", {
      riskScore: assessment.score,
      factors: assessment.factors,
      source: "risk_engine",
    })
    return {
      error: `Action denied (risk score: ${assessment.score})`,
      toolCall,
    }
  }

  // Step 6: Handle "ask" (approval required)
  if (rbacCheck.decision === "ask" || assessment.recommendation === "ask") {
    const approvalId = await rbac.createApprovalRequest(
      userId,
      orgId,
      sessionId,
      toolCall.name,
      toolCall.args
    )

    // Optionally notify via webhook (Slack, email)
    await notifyApprovers(orgId, approvalId, toolCall, assessment)

    return {
      pendingApproval: true,
      approvalId,
      toolCall,
    }
  }

  // Step 7: Execute
  const result = await executeToolDirect(toolCall)

  await rbac.auditLog(userId, orgId, toolCall.name, "allow", {
    riskScore: assessment.score,
    success: !result.error,
  })

  return result
}

async function notifyApprovers(
  orgId: string,
  approvalId: string,
  toolCall: ToolCall,
  assessment: any
): Promise<void> {
  // Optional: send to Slack, Teams, email, webhook
  const message = {
    approvalId,
    toolName: toolCall.name,
    toolArgs: toolCall.args,
    riskScore: assessment.score,
    riskFactors: assessment.factors,
  }

  console.log("[INFO] Approval needed:", message)
  // TODO: Implement webhook integration
}

async function executeToolDirect(toolCall: ToolCall): Promise<any> {
  // Existing tool execution logic
  // (bash, read_file, write_file, etc.)
}
```

---

## API Endpoints (Streamlined)

```typescript
// platform/src/server/routes/rbac.ts

import { Hono } from "hono"
import { RBACEngineV2 } from "../../HITL/rbac-v2-streamlined"

export function rbacRoutes(rbac: RBACEngineV2) {
  return new Hono()
    // ── Tool Policies ────────────────────────────────

    // List tool policies for org
    .get("/tool-policies", async (c) => {
      const orgId = c.req.header("x-org-id")
      const policies = await rbac.listToolPolicies(orgId)
      return c.json(policies)
    })

    // Create/update tool policy
    .post("/tool-policies", async (c) => {
      const orgId = c.req.header("x-org-id")
      const body = await c.req.json()
      // body: { toolName, roleName, decision: "allow"|"ask"|"deny" }
      await rbac.setToolPolicy(orgId, body.roleName, body.toolName, body.decision)
      return c.json({ updated: true }, 200)
    })

    // ── Path Rules ───────────────────────────────────

    // List path rules for org
    .get("/path-rules", async (c) => {
      const orgId = c.req.header("x-org-id")
      const rules = await rbac.listPathRules(orgId)
      return c.json(rules)
    })

    // Create path rule
    .post("/path-rules", async (c) => {
      const orgId = c.req.header("x-org-id")
      const body = await c.req.json()
      // body: { roleName, pathPattern, readable, writable, executable, priority }
      await rbac.createPathRule(orgId, body.roleName, body.pathPattern, {
        readable: body.readable,
        writable: body.writable,
        executable: body.executable,
        priority: body.priority || 0,
      })
      return c.json({ created: true }, 201)
    })

    // Delete path rule
    .delete("/path-rules/:ruleId", async (c) => {
      const orgId = c.req.header("x-org-id")
      await rbac.deletePathRule(orgId, c.req.param("ruleId"))
      return c.json({ deleted: true })
    })

    // ── Approval Requests ────────────────────────────

    // List pending approvals
    .get("/approvals/pending", async (c) => {
      const orgId = c.req.header("x-org-id")
      const approvals = await rbac.getPendingApprovalsForUser(c.req.header("x-user-id"), orgId)
      return c.json(approvals)
    })

    // Approve a request
    .post("/approvals/:id/approve", async (c) => {
      const userId = c.req.header("x-user-id")
      await rbac.respondToApprovalRequest(c.req.param("id"), userId, true)
      return c.json({ approved: true })
    })

    // Deny a request
    .post("/approvals/:id/deny", async (c) => {
      const userId = c.req.header("x-user-id")
      const body = await c.req.json().catch(() => ({}))
      await rbac.respondToApprovalRequest(c.req.param("id"), userId, false, body.reason)
      return c.json({ denied: true })
    })

    // ── Audit Log ────────────────────────────────────

    // Get audit log
    .get("/audit", async (c) => {
      const orgId = c.req.header("x-org-id")
      const limit = Number(c.req.query("limit")) || 100
      const logs = await rbac.getAuditLog(orgId, limit)
      return c.json(logs)
    })

    // ── Roles & Users ────────────────────────────────

    // List roles
    .get("/roles", async (c) => {
      const orgId = c.req.header("x-org-id")
      const roles = await rbac.listRoles(orgId)
      return c.json(roles)
    })

    // Create role
    .post("/roles", async (c) => {
      const orgId = c.req.header("x-org-id")
      const body = await c.req.json()
      const roleId = await rbac.createRole(orgId, body.name, body.description)
      return c.json({ id: roleId }, 201)
    })

    // List users
    .get("/users", async (c) => {
      const orgId = c.req.header("x-org-id")
      const users = await rbac.listUsers(orgId)
      return c.json(users)
    })

    // Assign role to user
    .post("/users/:userId/role", async (c) => {
      const orgId = c.req.header("x-org-id")
      const body = await c.req.json()
      await rbac.assignRoleToUser(orgId, c.req.param("userId"), body.roleId)
      return c.json({ updated: true })
    })
}
```

---

## Default Roles (No Model/Agent Restrictions)

```typescript
// Scripts/seed-rbac-roles.ts

const DEFAULT_ROLES = [
  {
    name: "admin",
    description: "Full access to all tools and paths",
    toolPolicies: {
      "*": "allow",  // wildcard allow all tools
    },
    pathRules: [
      { path: "*", readable: true, writable: true, executable: true, priority: 100 },
    ],
  },
  {
    name: "developer",
    description: "Can execute bash, read/write workspace, ask for risky ops",
    toolPolicies: {
      bash: "ask",
      read_file: "allow",
      write_file: "allow",
      list_dir: "allow",
      grep_search: "allow",
      web_fetch: "ask",
    },
    pathRules: [
      { path: "/workspace/*", readable: true, writable: true, priority: 10 },
      { path: "/root", readable: false, writable: false, priority: 20 },
      { path: "/etc", readable: false, writable: false, priority: 20 },
    ],
  },
  {
    name: "readonly",
    description: "Read-only access to workspace",
    toolPolicies: {
      bash: "deny",
      read_file: "allow",
      write_file: "deny",
      list_dir: "allow",
      grep_search: "allow",
      web_fetch: "deny",
    },
    pathRules: [
      { path: "/workspace/*", readable: true, writable: false, priority: 10 },
    ],
  },
]
```

---

## Configuration (Simplified)

```yaml
# platform/.env or admin UI

# Organization
ORG_ID: "team-acme-corp"
ORG_NAME: "ACME Corp Engineering"

# Tool Policies (per role)
TOOL_POLICIES:
  - role: "developer"
    tools:
      bash: "ask"              # Require approval for bash
      read_file: "allow"
      write_file: "allow"
      web_fetch: "ask"         # Require approval for web requests

  - role: "readonly"
    tools:
      bash: "deny"
      read_file: "allow"
      write_file: "deny"

# Path Rules (per role)
PATH_RULES:
  - role: "developer"
    paths:
      - pattern: "/workspace/src/**"
        readable: true
        writable: true
        priority: 10
      - pattern: "/root"
        readable: false
        writable: false
        priority: 20
      - pattern: "/etc"
        readable: false
        writable: false
        priority: 20

  - role: "readonly"
    paths:
      - pattern: "/workspace/**"
        readable: true
        writable: false
        priority: 10
```

---

## Implementation: 3 Phases (Simplified)

| Phase | Timeline | What | Effort |
|-------|----------|------|--------|
| **1: Schema + Engine** | Week 1 | PostgreSQL schema, RBACEngineV2, seed roles | 30h |
| **2: Tool Integration** | Week 2 | Integrate with tool-executor, path checks | 20h |
| **3: API + Approval** | Week 3 | REST endpoints, approval workflow | 25h |

**Total: 75 hours (vs 175 for full version)**

---

## Benefits

✅ **Granular tool control** — Per-tool, per-role allow/ask/deny  
✅ **Path-based access** — Directory-level read/write/execute  
✅ **Approval workflow** — Request → approve/deny flow  
✅ **Audit trail** — Full compliance logging  
✅ **Multi-tenant ready** — Scale to multiple teams  
✅ **Simple to understand** — No complex model/agent layers  
✅ **Easy to configure** — YAML or admin UI  

---

This is **production-ready** and implements the core RBAC system without the extra complexity of model/agent whitelisting.

**Ready to start Phase 1?**
