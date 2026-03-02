// ---------------------------------------------------------------------------
// Rate-limiting middleware — simple sliding-window per IP
// ---------------------------------------------------------------------------

import type { Context, Next } from "hono"

interface Window {
  count: number
  resetAt: number
}

const windows = new Map<string, Window>()
const WINDOW_MS = 60_000
const MAX_REQUESTS = 120

export async function rateLimitMiddleware(c: Context, next: Next) {
  const ip = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown"
  const now = Date.now()

  let win = windows.get(ip)
  if (!win || now > win.resetAt) {
    win = { count: 0, resetAt: now + WINDOW_MS }
    windows.set(ip, win)
  }

  win.count++

  c.header("X-RateLimit-Limit", MAX_REQUESTS.toString())
  c.header("X-RateLimit-Remaining", Math.max(0, MAX_REQUESTS - win.count).toString())
  c.header("X-RateLimit-Reset", Math.ceil(win.resetAt / 1000).toString())

  if (win.count > MAX_REQUESTS) {
    return c.json({ error: "rate_limited", message: "Too many requests" }, 429)
  }

  return next()
}

// Periodic cleanup (every 5 min)
setInterval(() => {
  const now = Date.now()
  for (const [ip, win] of windows) {
    if (now > win.resetAt) windows.delete(ip)
  }
}, 300_000)
