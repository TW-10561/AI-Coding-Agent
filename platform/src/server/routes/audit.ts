// ---------------------------------------------------------------------------
// Audit routes — /api/audit
// Query audit logs and statistics
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import type { AuditLogger, AuditAction } from "../../services/audit-logger"

const QueryParams = z.object({
  action: z.string().optional(),
  userID: z.string().optional(),
  sessionID: z.string().optional(),
  workspaceID: z.string().optional(),
  success: z.enum(["true", "false"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
})

export function auditRoutes(audit: AuditLogger) {
  return new Hono()
    // Query audit logs
    .get("/", async (c) => {
      const q = QueryParams.parse(c.req.query())
      const entries = audit.query({
        action: q.action as AuditAction | undefined,
        userID: q.userID,
        sessionID: q.sessionID,
        workspaceID: q.workspaceID,
        success: q.success ? q.success === "true" : undefined,
        since: q.from ? new Date(q.from).getTime() : undefined,
        until: q.to ? new Date(q.to).getTime() : undefined,
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
      })
      return c.json(entries)
    })

    // Audit stats
    .get("/stats", async (c) => {
      const from = c.req.query("from")
      const to = c.req.query("to")
      const stats = audit.stats({
        since: from ? new Date(from).getTime() : undefined,
      })
      return c.json(stats)
    })
}
