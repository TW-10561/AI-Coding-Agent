// ---------------------------------------------------------------------------
// Admin routes — /api/admin (requires admin role)
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import { userService, verifyJWT } from "../../services/user-service"
import { apiKeyService } from "../../services/api-key-service"
import { sql, pgEnabled } from "../../config/db"
import { defaultRBACEngineV2 } from "../../services/policy-engine"

/** Middleware: extract JWT user and require admin role */
async function requireAdmin(c: any, next: any) {
  const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "")
  if (!bearer) return c.json({ error: "Authentication required" }, 401)

  try {
    const payload = await verifyJWT(bearer)
    if (!payload || payload.role !== "admin") {
      return c.json({ error: "Admin access required" }, 403)
    }
    c.set("user", payload)
    return next()
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401)
  }
}

export function adminRoutes() {
  const router = new Hono()

  // All admin routes require admin role
  router.use("*", requireAdmin)

  // ── User Management ──────────────────────────────────────────────

  // GET /api/admin/users — list all users
  router.get("/users", async (c) => {
    const users = await userService.listUsers()
    return c.json({ users })
  })

  // GET /api/admin/users/:id — get single user
  router.get("/users/:id", async (c) => {
    const user = await userService.getUser(c.req.param("id"))
    if (!user) return c.json({ error: "User not found" }, 404)
    return c.json({ user })
  })

  // PATCH /api/admin/users/:id/role — update user role
  router.patch("/users/:id/role", async (c) => {
    const { roleName } = await c.req.json()
    if (!roleName) return c.json({ error: "roleName required" }, 400)
    try {
      await userService.updateUserRole(c.req.param("id"), roleName)
      return c.json({ ok: true })
    } catch (err: any) {
      return c.json({ error: err.message }, err.status || 400)
    }
  })

  // PATCH /api/admin/users/:id/status — activate/deactivate user
  router.patch("/users/:id/status", async (c) => {
    const { status } = await c.req.json()
    if (!status || !["active", "suspended", "deactivated"].includes(status)) {
      return c.json({ error: "status must be active, suspended, or deactivated" }, 400)
    }
    try {
      await userService.updateUserStatus(c.req.param("id"), status)
      return c.json({ ok: true })
    } catch (err: any) {
      return c.json({ error: err.message }, err.status || 400)
    }
  })

  // DELETE /api/admin/users/:id — permanently delete a user (admin only, cannot self-delete)
  router.delete("/users/:id", async (c) => {
    const adminUser = c.get("user") as any
    try {
      await userService.deleteUser(c.req.param("id"), adminUser.sub)
      return c.json({ ok: true })
    } catch (err: any) {
      return c.json({ error: err.message }, err.status || 400)
    }
  })

  // ── Registration Approvals ───────────────────────────────────────

  // GET /api/admin/registrations — list pending registrations
  router.get("/registrations", async (c) => {
    const status = c.req.query("status") || "pending"
    const regs = status === "all"
      ? await userService.listAllRegistrations()
      : await userService.listPendingRegistrations()
    return c.json({ registrations: regs })
  })

  // POST /api/admin/registrations/:id/approve — approve a registration
  router.post("/registrations/:id/approve", async (c) => {
    const { roleName } = await c.req.json().catch(() => ({ roleName: undefined }))
    const adminUser = c.get("user") as any
    try {
      const user = await userService.approveRegistration(c.req.param("id"), adminUser.sub, roleName || "developer")
      return c.json({ user })
    } catch (err: any) {
      return c.json({ error: err.message }, err.status || 400)
    }
  })

  // POST /api/admin/registrations/:id/reject — reject a registration
  router.post("/registrations/:id/reject", async (c) => {
    const { reason } = await c.req.json().catch(() => ({ reason: undefined }))
    const adminUser = c.get("user") as any
    try {
      await userService.rejectRegistration(c.req.param("id"), adminUser.sub, reason)
      return c.json({ ok: true })
    } catch (err: any) {
      return c.json({ error: err.message }, err.status || 400)
    }
  })

  // ── Roles & Policies ────────────────────────────────────────────

  // GET /api/admin/roles — list all roles
  router.get("/roles", async (c) => {
    if (!pgEnabled) return c.json({ roles: [] })
    const roles = await sql`SELECT * FROM roles ORDER BY name`
    return c.json({ roles })
  })

  // GET /api/admin/policies — RBAC policy matrix
  router.get("/policies", async (c) => {
    if (!pgEnabled) return c.json({ policies: [] })
    const policies = await sql`
      SELECT p.id, p.tool_name, p.decision, p.updated_at,
             r.name as role_name,
             tm.description as tool_description, tm.risky, tm.category
      FROM tool_access_policies p
      JOIN roles r ON r.id = p.role_id
      LEFT JOIN tool_metadata tm ON tm.name = p.tool_name
      ORDER BY r.name, p.tool_name
    `
    return c.json({ policies })
  })

  // PATCH /api/admin/policies/:id — update a single policy
  router.patch("/policies/:id", async (c) => {
    if (!pgEnabled) return c.json({ error: "PostgreSQL required" }, 503)
    const { decision } = await c.req.json()
    if (!["allow", "ask", "deny"].includes(decision)) {
      return c.json({ error: "decision must be allow, ask, or deny" }, 400)
    }
    const adminUser = c.get("user") as any

    const [row] = await sql`
      UPDATE tool_access_policies
      SET decision = ${decision}, updated_by = ${adminUser.sub}, updated_at = NOW()
      WHERE id = ${c.req.param("id")}
      RETURNING *, (SELECT name FROM roles WHERE id = role_id) as role_name
    `
    if (!row) return c.json({ error: "Policy not found" }, 404)
    // Invalidate RBACEngineV2 cache for this tool+role combination
    defaultRBACEngineV2.invalidate(row.tool_name, row.role_name)
    return c.json({ policy: row })
  })

  // POST /api/admin/policies/seed — seed default tool_metadata and policies
  router.post("/policies/seed", async (c) => {
    if (!pgEnabled) return c.json({ error: "PostgreSQL required" }, 503)
    const TOOLS = [
      { name: "read_file",         description: "Read file contents",         risky: false, category: "filesystem" },
      { name: "write_file",        description: "Write/create files",         risky: false, category: "filesystem" },
      { name: "edit_file",         description: "Patch/edit existing files",  risky: false, category: "filesystem" },
      { name: "delete_file",       description: "Delete files",               risky: true,  category: "filesystem" },
      { name: "list_directory",    description: "List directory contents",    risky: false, category: "filesystem" },
      { name: "search_files",      description: "Search files by pattern",    risky: false, category: "search"     },
      { name: "grep_search",       description: "Text search in files",       risky: false, category: "search"     },
      { name: "bash",              description: "Execute shell commands",      risky: true,  category: "shell"      },
      { name: "run_command",       description: "Run a single command",       risky: true,  category: "shell"      },
      { name: "web_fetch",         description: "Fetch URL content",          risky: false, category: "web"        },
      { name: "web_search",        description: "Search the web",             risky: false, category: "web"        },
      { name: "call_skill",        description: "Invoke a registered skill",  risky: false, category: "agent"      },
      { name: "spawn_agent",       description: "Spawn a sub-agent",          risky: true,  category: "agent"      },
      { name: "memory_read",       description: "Read from memory store",     risky: false, category: "agent"      },
      { name: "memory_write",      description: "Write to memory store",      risky: false, category: "agent"      },
      { name: "git_operation",     description: "Execute git commands",       risky: true,  category: "shell"      },
      { name: "database_query",    description: "Query a database",           risky: true,  category: "shell"      },
    ]
    // Upsert tool_metadata
    for (const t of TOOLS) {
      await sql`
        INSERT INTO tool_metadata (name, description, risky, category)
        VALUES (${t.name}, ${t.description}, ${t.risky}, ${t.category})
        ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, risky = EXCLUDED.risky, category = EXCLUDED.category`
    }
    // Get all roles
    const roles = await sql`SELECT id, name FROM roles`
    const roleMap: Record<string, string> = {}
    for (const r of roles) roleMap[r.name] = r.id

    const MATRIX: Record<string, Record<string, string>> = {
      admin:            { bash: "allow", run_command: "allow", write_file: "allow", edit_file: "allow", delete_file: "allow", read_file: "allow", list_directory: "allow", search_files: "allow", grep_search: "allow", web_fetch: "allow", web_search: "allow", call_skill: "allow", spawn_agent: "allow", memory_read: "allow", memory_write: "allow", git_operation: "allow", database_query: "allow" },
      developer:        { bash: "ask",   run_command: "ask",   write_file: "ask",   edit_file: "ask",   delete_file: "ask",   read_file: "allow", list_directory: "allow", search_files: "allow", grep_search: "allow", web_fetch: "ask",   web_search: "allow", call_skill: "ask",   spawn_agent: "ask",   memory_read: "allow", memory_write: "ask",   git_operation: "ask",   database_query: "ask" },
      readonly:         { bash: "deny",  run_command: "deny",  write_file: "deny",  edit_file: "deny",  delete_file: "deny",  read_file: "allow", list_directory: "allow", search_files: "allow", grep_search: "allow", web_fetch: "deny",  web_search: "allow", call_skill: "deny",  spawn_agent: "deny",  memory_read: "allow", memory_write: "deny",  git_operation: "deny",  database_query: "deny" },
      autonomous_agent: { bash: "allow", run_command: "allow", write_file: "allow", edit_file: "allow", delete_file: "allow", read_file: "allow", list_directory: "allow", search_files: "allow", grep_search: "allow", web_fetch: "allow", web_search: "allow", call_skill: "allow", spawn_agent: "allow", memory_read: "allow", memory_write: "allow", git_operation: "allow", database_query: "allow" },
    }
    let seeded = 0
    for (const [roleName, perms] of Object.entries(MATRIX)) {
      const roleId = roleMap[roleName]
      if (!roleId) continue
      for (const [toolName, decision] of Object.entries(perms)) {
        await sql`
          INSERT INTO tool_access_policies (tool_name, role_id, decision)
          VALUES (${toolName}, ${roleId}, ${decision})
          ON CONFLICT (tool_name, role_id) DO NOTHING`
        seeded++
      }
    }
    defaultRBACEngineV2.invalidate()
    return c.json({ ok: true, seeded })
  })

  // ── API Key Management (admin view) ──────────────────────────────

  // GET /api/admin/api-keys — list all API keys (all users)
  router.get("/api-keys", async (c) => {
    if (!pgEnabled) return c.json({ keys: [] })
    const rows = await sql`
      SELECT k.id, k.user_id, k.key_preview, k.display_name, k.key_type,
             k.status, k.admin_verified, k.admin_verified_at, k.admin_verified_by,
             k.created_at, k.last_used_at,
             u.email as user_email, u.full_name as user_name
      FROM api_keys k
      LEFT JOIN users u ON u.id = k.user_id
      ORDER BY k.created_at DESC
    `
    // Transform to camelCase for frontend
    const keys = rows.map((r: any) => ({
      id: r.id,
      userId: r.user_id,
      keyPreview: r.key_preview,
      displayName: r.display_name,
      keyType: r.key_type,
      status: r.status,
      adminVerified: r.admin_verified,
      adminVerifiedAt: r.admin_verified_at,
      adminVerifiedBy: r.admin_verified_by,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      userEmail: r.user_email,
      userName: r.user_name,
    }))
    return c.json({ keys })
  })

  // DELETE /api/admin/api-keys/:id — revoke any API key
  router.delete("/api-keys/:id", async (c) => {
    const adminUser = c.get("user") as any
    try {
      await apiKeyService.revoke(adminUser.sub, c.req.param("id"))
      return c.json({ ok: true })
    } catch (err: any) {
      return c.json({ error: err.message }, err.status || 400)
    }
  })

  // POST /api/admin/api-keys/verify-gateway — test a key against the APISIX gateway
  router.post("/api-keys/verify-gateway", async (c) => {
    const body = await c.req.json<{ apiKey?: string; gatewayUrl?: string }>()
    const result = await apiKeyService.verifyGatewayKey(
      body.apiKey || "",
      body.gatewayUrl
    )
    return c.json(result)
  })

  // POST /api/admin/api-keys/:id/verify — admin approves a user's API key
  router.post("/api-keys/:id/verify", async (c) => {
    const adminUser = c.get("user") as any
    try {
      const key = await apiKeyService.adminVerifyKey(c.req.param("id"), adminUser.sub)
      return c.json({ ok: true, key })
    } catch (err: any) {
      return c.json({ error: err.message }, err.status || 400)
    }
  })

  // POST /api/admin/api-keys/:id/reject — admin rejects a user's API key
  router.post("/api-keys/:id/reject", async (c) => {
    const adminUser = c.get("user") as any
    try {
      await apiKeyService.adminRejectKey(c.req.param("id"), adminUser.sub)
      return c.json({ ok: true })
    } catch (err: any) {
      return c.json({ error: err.message }, err.status || 400)
    }
  })

  // ── Dashboard Stats ──────────────────────────────────────────────

  // GET /api/admin/stats — overview stats for admin dashboard
  router.get("/stats", async (c) => {
    if (!pgEnabled) return c.json({ users: 0, pendingRegistrations: 0, apiKeys: 0, roles: 0 })
    const [stats] = await sql`
      SELECT
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM users WHERE status = 'active') as active_users,
        (SELECT COUNT(*) FROM registration_requests WHERE status = 'pending') as pending_registrations,
        (SELECT COUNT(*) FROM api_keys WHERE status = 'active') as active_api_keys,
        (SELECT COUNT(*) FROM api_keys WHERE status = 'active' AND admin_verified = FALSE) as pending_api_keys,
        (SELECT COUNT(*) FROM roles) as total_roles
    `
    return c.json(stats)
  })

  return router
}
