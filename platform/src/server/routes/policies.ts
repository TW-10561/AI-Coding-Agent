// ---------------------------------------------------------------------------
// Policy routes — /api/policies
// Exposes security policy status, evaluation, and configuration
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import { PolicyEngine } from "../../services/policy-engine"

const EvalBody = z.object({
  command: z.string().optional(),
  filePath: z.string().optional(),
  url: z.string().optional(),
  role: z.enum(["admin", "developer", "readonly", "autonomous_agent"]).optional(),
  permission: z.enum(["bash", "edit", "read", "webfetch", "external_directory", "skill"]).optional(),
  agentName: z.string().optional(),
  skillName: z.string().optional(),
  isDelete: z.boolean().optional(),
  diffSize: z.number().optional(),
})

const RiskBody = z.object({
  command: z.string().optional(),
  filePath: z.string().optional(),
  isDelete: z.boolean().optional(),
  isRepeatedCommand: z.boolean().optional(),
  isRepeatedError: z.boolean().optional(),
  iterations: z.number().optional(),
  diffSize: z.number().optional(),
})

export function policyRoutes(engine: PolicyEngine) {
  return new Hono()

    // Get full policy status
    .get("/", async (c) => c.json(engine.getStatus()))

    // Evaluate an action against all policies
    .post("/evaluate", async (c) => {
      const body = EvalBody.parse(await c.req.json())
      const result = engine.evaluate(body as any)
      return c.json(result)
    })

    // Risk assessment only
    .post("/risk", async (c) => {
      const body = RiskBody.parse(await c.req.json())
      const assessment = engine.risk.assess(body)
      return c.json(assessment)
    })

    // Check if a command is destructive
    .post("/check-command", async (c) => {
      const { command } = z.object({ command: z.string() }).parse(await c.req.json())
      const { isDestructiveCommand, getCommandSeverity, getDestructiveReason } = await import("../../services/policy-engine")
      return c.json({
        destructive: isDestructiveCommand(command),
        severity: getCommandSeverity(command),
        reason: getDestructiveReason(command),
      })
    })

    // Check if file is sensitive
    .post("/check-file", async (c) => {
      const { filePath } = z.object({ filePath: z.string() }).parse(await c.req.json())
      const { isSensitiveFile } = await import("../../services/policy-engine")
      return c.json({ sensitive: isSensitiveFile(filePath) })
    })

    // Check network URL
    .post("/check-url", async (c) => {
      const { url } = z.object({ url: z.string() }).parse(await c.req.json())
      return c.json(engine.network.checkUrl(url))
    })

    // Loop guard status
    .get("/loop", async (c) => c.json(engine.loopGuard.getSummary()))

    // Reset loop guard
    .post("/loop/reset", async (c) => {
      engine.loopGuard.reset()
      return c.json({ reset: true })
    })

    // RBAC — check permission
    .get("/rbac/:role/:permission", async (c) => {
      const role = c.req.param("role") as any
      const perm = c.req.param("permission") as any
      return c.json({
        role,
        permission: perm,
        decision: engine.rbac.check(role, perm),
      })
    })

    // RBAC — get full matrix for a role
    .get("/rbac/:role", async (c) => {
      const role = c.req.param("role") as any
      return c.json({ role, permissions: engine.rbac.getMatrix(role) })
    })

    // Autonomy — get agent summary
    .get("/autonomy", async (c) => c.json(engine.autonomy.getSummary()))

    // Skill trust — list all
    .get("/trust", async (c) => c.json(engine.skillTrust.getAll()))
}
