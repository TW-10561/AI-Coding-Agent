// ---------------------------------------------------------------------------
// Budget routes — /api/budget
// View and manage per-user budget limits and usage
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import type { BudgetManager, BudgetWindow } from "../../services/budget-manager"

const SetLimitsBody = z.object({
  window: z.enum(["hour", "day", "month", "total"]),
  maxTokens: z.number().optional(),
  maxRequests: z.number().optional(),
  maxCostCents: z.number().optional(),
  hardLimit: z.boolean().optional(),
})

export function budgetRoutes(budget: BudgetManager) {
  return new Hono()
    // Check budget for a user
    .get("/check", async (c) => {
      const userID = c.req.query("userID") ?? "default"
      const result = budget.check(userID)
      return c.json(result)
    })

    // Get budget summary for a user
    .get("/summary", async (c) => {
      const userID = c.req.query("userID") ?? "default"
      const summary = budget.summary(userID)
      return c.json(summary)
    })

    // Set budget limits for a user
    .put("/limits", async (c) => {
      const body = SetLimitsBody.parse(await c.req.json())
      const userID = c.req.query("userID") ?? "default"
      budget.setLimit({
        id: (await import("ulid")).ulid(),
        userID,
        window: body.window as BudgetWindow,
        maxTokens: body.maxTokens,
        maxRequests: body.maxRequests,
        maxCostCents: body.maxCostCents,
        hardLimit: body.hardLimit ?? false,
      })
      return c.json({ ok: true })
    })

    // Record usage (internal, but exposed for observability)
    .post("/record", async (c) => {
      const body = z.object({
        userID: z.string(),
        tokens: z.number(),
        costCents: z.number().optional(),
      }).parse(await c.req.json())
      budget.recordUsage({
        userID: body.userID,
        tokensInput: body.tokens,
        tokensOutput: 0,
        costCents: body.costCents,
      })
      return c.json({ ok: true })
    })
}
