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
  const forwarded = c.req.header("x-forwarded-for")
  const ip = (forwarded ? forwarded.split(",")[0]?.trim() : undefined)
    ?? c.req.header("x-real-ip")
    ?? "unknown"
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

// Periodic cleanup (every 5 min) — cap map size to prevent memory leak under DDoS
const MAX_TRACKED_IPS = 10_000
export const rateLimitCleanupInterval = setInterval(() => {
  const now = Date.now()
  for (const [ip, win] of windows) {
    if (now > win.resetAt) windows.delete(ip)
  }
  // Hard cap: if still over limit, drop oldest entries
  if (windows.size > MAX_TRACKED_IPS) {
    const excess = windows.size - MAX_TRACKED_IPS
    let deleted = 0
    for (const key of windows.keys()) {
      if (deleted >= excess) break
      windows.delete(key)
      deleted++
    }
  }
}, 300_000)
