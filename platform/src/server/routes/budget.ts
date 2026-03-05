// ---------------------------------------------------------------------------
// Budget routes — /api/budget
// Budget checking, usage summary, and limit management.
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import { ulid } from "ulid"
import type { BudgetManager } from "../../services/budget-manager"

const SetLimitsBody = z.object({
  window: z.enum(["hour", "day", "month", "total"]),
  maxTokens: z.number().optional(),
  maxRequests: z.number().optional(),
  maxCostCents: z.number().optional(),
  hardLimit: z.boolean().optional(),
})

const RecordBody = z.object({
  tokensInput: z.number().min(0),
  tokensOutput: z.number().min(0),
  costCents: z.number().min(0).optional(),
  modelID: z.string().optional(),
  sessionID: z.string().optional(),
  taskID: z.string().optional(),
})

export function budgetRoutes(budget: BudgetManager) {
  return new Hono()

    // Check if user is within budget
    .get("/check", async (c) => {
      const userID = c.req.query("userID") ?? "default"
      return c.json(budget.check(userID))
    })

    // Get usage summary by window
    .get("/summary", async (c) => {
      const userID = c.req.query("userID") ?? "default"
      return c.json(budget.summary(userID))
    })

    // Set budget limits
    .put("/limits", async (c) => {
      const userID = c.req.query("userID") ?? "default"
      const body = SetLimitsBody.parse(await c.req.json())
      const limit = budget.setLimit({
        id: ulid(),
        userID,
        window: body.window,
        maxTokens: body.maxTokens,
        maxRequests: body.maxRequests,
        maxCostCents: body.maxCostCents,
        hardLimit: body.hardLimit ?? true,
      })
      return c.json(limit)
    })

    // Get user's limits
    .get("/limits", async (c) => {
      const userID = c.req.query("userID") ?? "default"
      return c.json(budget.getLimits(userID))
    })

    // Record usage (usually called internally)
    .post("/record", async (c) => {
      const userID = c.req.query("userID") ?? "default"
      const body = RecordBody.parse(await c.req.json())
      budget.recordUsage({
        userID,
        tokensInput: body.tokensInput,
        tokensOutput: body.tokensOutput,
        costCents: body.costCents ?? 0,
        modelID: body.modelID,
        sessionID: body.sessionID,
        taskID: body.taskID,
      })
      return c.json({ recorded: true })
    })
}
