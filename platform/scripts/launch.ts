#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Artemis — Single-command launcher
// Starts: Platform backend → TUI (interactive)
// OpenCode engine is optional — if available, enables agent tools & sessions.
// Without OpenCode, direct vLLM chat still works.
// ---------------------------------------------------------------------------

import { env } from "../src/config/env"

const LOGO = `
  ╔══════════════════════════════════════════╗
  ║   ◆  A R T E M I S                       ║
  ║   AI Coding Platform — Local & Private   ║
  ╚══════════════════════════════════════════╝
`

// ── Helpers ──────────────────────────────────────────────────────────

function log(tag: string, msg: string) {
  const ts = new Date().toLocaleTimeString()
  console.log(`  \x1b[90m${ts}\x1b[0m  \x1b[35m[${tag}]\x1b[0m  ${msg}`)
}

// ── Pre-flight checks ───────────────────────────────────────────────

async function preflight() {
  // Already running inside Bun — no need to check bun availability

  // Check vLLM availability (non-blocking warning)
  try {
    const resp = await fetch(`${env.VLLM_BASE_URL}/models`, {
      signal: AbortSignal.timeout(5000),
      headers: env.VLLM_API_KEY ? { Authorization: `Bearer ${env.VLLM_API_KEY}` } : {},
    })
    if (!resp.ok) log("preflight", `\x1b[33m⚠ vLLM returned ${resp.status} — some models may be offline\x1b[0m`)
    else log("preflight", `vLLM reachable (${env.VLLM_MODEL_ID})`)
  } catch {
    log("preflight", "\x1b[33m⚠ vLLM not reachable at " + env.VLLM_BASE_URL + " — using fallback endpoints\x1b[0m")
  }

  // Check if OpenCode is available (optional)
  let opencodeAvailable = false
  try {
    const ocProc = Bun.spawnSync([env.OPENCODE_BIN, "--version"])
    if (ocProc.exitCode === 0) {
      opencodeAvailable = true
      log("preflight", "OpenCode binary found")
    }
  } catch {}
  if (!opencodeAvailable) {
    // Check common locations
    const locations = [
      `${process.env.HOME}/.opencode/bin/opencode`,
      `${process.env.HOME}/.local/bin/opencode`,
      "/usr/local/bin/opencode",
    ]
    for (const loc of locations) {
      try {
        const check = Bun.spawnSync([loc, "--version"])
        if (check.exitCode === 0) {
          process.env.OPENCODE_BIN = loc
          opencodeAvailable = true
          log("preflight", `Found opencode at ${loc}`)
          break
        }
      } catch {}
    }
  }
  if (!opencodeAvailable) {
    log("preflight", "\x1b[33m⚠ OpenCode not found — running in direct chat mode (vLLM only)\x1b[0m")
  }
  return { opencodeAvailable }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(LOGO)
  log("launch", "Running pre-flight checks...")
  const { opencodeAvailable } = await preflight()

  // 1) Optionally start OpenCode engine
  if (opencodeAvailable) {
    try {
      log("launch", "Starting OpenCode engine...")
      const { opencode } = await import("../src/services/opencode-process")
      const ocUrl = await opencode.start({ directory: env.OPENCODE_DIR })
      log("launch", `OpenCode ready → ${ocUrl}`)
    } catch (e) {
      log("launch", `\x1b[33m⚠ OpenCode failed to start: ${e}\x1b[0m`)
      log("launch", "Continuing without OpenCode — direct chat still works")
    }
  }

  // 2) Start Platform backend
  log("launch", "Starting Platform backend...")
  await import("../src/server/index")
  log("launch", `Platform ready → http://${env.HOST}:${env.PORT}`)

  // 3) Small delay to ensure server is listening
  await new Promise((r) => setTimeout(r, 300))

  // 4) Launch TUI in-process
  log("launch", "Starting TUI...\n")
  await import("../tui/src/main")

  // ── Graceful shutdown ───────────────────────────────────────────
  // TUI's gracefulExit() handles shutdown (stops platform server,
  // OpenCode, and flushes audit log).  We only need a fallback in
  // case the TUI didn't register its handlers yet.
  const shutdown = async () => {
    // Import the TUI's shutdown — if it's already shutting down the
    // isShuttingDown guard inside gracefulExit prevents double-fire.
    try {
      const { shutdownPlatform } = await import("../src/server/index")
      await shutdownPlatform()
    } catch {}
    try {
      const { opencode } = await import("../src/services/opencode-process")
      await opencode.stop()
    } catch {}
    setTimeout(() => process.exit(0), 150)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

main().catch((err) => {
  console.error("\n  \x1b[31mFatal error:\x1b[0m", err)
  process.exit(1)
})
