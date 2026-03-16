// ---------------------------------------------------------------------------
// Auth middleware — simple API key gate
// ---------------------------------------------------------------------------
// If PLATFORM_API_KEY is set, all /api/* requests must carry it as:
//   Authorization: Bearer <key>   OR   x-api-key: <key>
// When the env var is unset the middleware is a no-op (open mode).
// ---------------------------------------------------------------------------

import type { Context, Next } from "hono"
import { env } from "../config/env"
import { timingSafeEqual } from "crypto"

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export async function authMiddleware(c: Context, next: Next) {
  // Open mode — no key configured, allow everything
  if (!env.PLATFORM_API_KEY) return next()

  const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "")
  const header = c.req.header("x-api-key")
  const key = bearer ?? header

  if (!key || !safeCompare(key, env.PLATFORM_API_KEY)) {
    return c.json(
      { error: "unauthorized", message: "Invalid or missing API key" },
      401,
    )
  }

  return next()
}
