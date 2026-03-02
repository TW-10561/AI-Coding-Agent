// ---------------------------------------------------------------------------
// Request logging middleware
// ---------------------------------------------------------------------------

import type { Context, Next } from "hono"
import { env } from "../config/env"

export async function loggerMiddleware(c: Context, next: Next) {
  const start = performance.now()
  const method = c.req.method
  const path = c.req.path

  await next()

  const ms = (performance.now() - start).toFixed(1)
  const status = c.res.status

  if (env.LOG_LEVEL === "debug" || (status >= 400)) {
    console.log(`${method} ${path} ${status} ${ms}ms`)
  }
}
