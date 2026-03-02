// ---------------------------------------------------------------------------
// Platform auth middleware — validates API key or JWT in incoming requests
// ---------------------------------------------------------------------------

import type { Context, Next } from "hono"
import { env } from "../config/env"

/**
 * Simple API-key auth middleware.
 * Checks `Authorization: Bearer <key>` or `x-api-key` header.
 * Skip if no PLATFORM_API_KEY is configured (open mode for dev).
 */
export async function authMiddleware(c: Context, next: Next) {
  if (!env.PLATFORM_API_KEY) return next()

  const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "")
  const header = c.req.header("x-api-key")
  const key = bearer ?? header

  if (!key || key !== env.PLATFORM_API_KEY) {
    return c.json({ error: "unauthorized", message: "Invalid or missing API key" }, 401)
  }
  return next()
}
