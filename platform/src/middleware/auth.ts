// ---------------------------------------------------------------------------
// Auth middleware — JWT + API key gate
// ---------------------------------------------------------------------------
// Supports three modes (checked in order):
//   1. JWT token:  Authorization: Bearer <jwt>  →  extracts user into c.var.user
//   2. API key:    Authorization: Bearer <key>  OR  x-api-key: <key>
//   3. Open mode:  when PLATFORM_API_KEY is unset, allow everything
// ---------------------------------------------------------------------------

import type { Context, Next } from "hono"
import { env } from "../config/env"
import { timingSafeEqual } from "crypto"
import { verifyJWT } from "../services/user-service"

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export async function authMiddleware(c: Context, next: Next) {
  const bearer = c.req.header("authorization")?.replace(/^Bearer\s+/i, "")
  const apiKeyHeader = c.req.header("x-api-key")

  // 1. Try JWT token (contains dots — JWTs have exactly 2 dots)
  if (bearer && bearer.split(".").length === 3) {
    try {
      const payload = await verifyJWT(bearer)
      c.set("user", payload)
      return next()
    } catch {
      // Not a valid JWT — fall through to API key check
    }
  }

  // 2. Static API key check
  const key = bearer ?? apiKeyHeader
  if (env.PLATFORM_API_KEY && key && safeCompare(key, env.PLATFORM_API_KEY)) {
    return next()
  }

  // 3. Open mode — no key configured, allow everything
  if (!env.PLATFORM_API_KEY) return next()

  return c.json(
    { error: "unauthorized", message: "Invalid or missing API key / JWT token" },
    401,
  )
}
