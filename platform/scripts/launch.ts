#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Thirdwave — Single-command launcher
// Starts: Platform backend → TUI (interactive)
// OpenCode engine is optional — if available, enables agent tools & sessions.
// Without OpenCode, direct vLLM chat still works.
// ---------------------------------------------------------------------------

import { env } from "../src/config/env"

const LOGO = `
  ╔══════════════════════════════════════════╗
  ║   ◆  T H I R D W A V E                   ║
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
  if (env.VLLM_BASE_URL) {
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
  } else {
    log("preflight", "No direct VLLM_BASE_URL configured — using gateway or auto-discovery")
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

// ── Systemd service detection ────────────────────────────────────────
// Returns true if the 'thirdwave' systemd service is currently running.
// When it is, we reuse it instead of starting a second backend instance.
// This prevents the SIGKILL cascade: launch.ts killing the service →
// systemd restarting → pre-start script killing launch.ts.
function isThirdwaveServiceRunning(): boolean {
  try {
    const r = Bun.spawnSync(["systemctl", "is-active", "thirdwave"], { stderr: "ignore" })
    return new TextDecoder().decode(r.stdout).trim() === "active"
  } catch {
    return false  // systemctl not available — assume not running
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(LOGO)
  log("launch", "Running pre-flight checks...")
  const { opencodeAvailable } = await preflight()

  const serviceActive = isThirdwaveServiceRunning()

  if (serviceActive) {
    // ── Reuse running systemd service ──────────────────────────────
    // Do NOT evict or restart it — we just attach the TUI to it.
    // The TUI will not shut down the backend on /quit.
    log("launch", `System service running — connecting TUI to http://127.0.0.1:${env.PORT}`)
    process.env.THIRDWAVE_URL = `http://127.0.0.1:${env.PORT}`
    // THIRDWAVE_BACKEND_MANAGED stays unset → TUI won't stop the service on exit
  } else {
    // ── Start our own stack (no systemd service running) ───────────
    // Safe to start here — AUTO_PORT=true finds a free port without killing anyone.

    // 1) OpenCode engine (optional)
    if (opencodeAvailable) {
      try {
        log("launch", "Starting OpenCode engine...")
        const { opencode } = await import("../src/services/opencode-process")
        const ocUrl = await opencode.start({ directory: env.OPENCODE_DIR })
        log("launch", `OpenCode ready → ${ocUrl}`)
        process.env.THIRDWAVE_OPENCODE_MANAGED = "1"  // we own it → stop on exit
      } catch (e) {
        log("launch", `\x1b[33m⚠ OpenCode failed to start: ${e}\x1b[0m`)
        log("launch", "Continuing without OpenCode — direct vLLM chat still works")
      }
    }

    // 2) Platform backend — AUTO_PORT finds the next free port automatically
    log("launch", "Starting Platform backend...")
    const { server } = await import("../src/server/index")
    const actualPort = server.port
    process.env.THIRDWAVE_URL = `http://127.0.0.1:${actualPort}`
    process.env.THIRDWAVE_BACKEND_MANAGED = "1"  // we own it → stop on exit
    log("launch", `Platform ready → http://127.0.0.1:${actualPort}`)
    if (actualPort !== env.PORT) {
      log("launch", `\x1b[33mNote: default port ${env.PORT} was busy — using ${actualPort} for this session\x1b[0m`)
      log("launch", `\x1b[33mTip: set THIRDWAVE_PORT_OFFSET=N to fix your personal port range\x1b[0m`)
    }
    await new Promise((r) => setTimeout(r, 200))
  }

  // 3) Launch TUI — it reads THIRDWAVE_URL and THIRDWAVE_*_MANAGED flags above
  log("launch", "Starting TUI...\n")
  await import("../tui/src/main")

  // Fallback shutdown handler (TUI registers its own — this is belt-and-suspenders)
  const shutdown = async () => {
    if (process.env.THIRDWAVE_BACKEND_MANAGED === "1") {
      try {
        const { shutdownPlatform } = await import("../src/server/index")
        await shutdownPlatform()
      } catch {}
    }
    if (process.env.THIRDWAVE_OPENCODE_MANAGED === "1") {
      try {
        const { opencode } = await import("../src/services/opencode-process")
        await opencode.stop()
      } catch {}
    }
    setTimeout(() => process.exit(0), 150)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

main().catch((err) => {
  console.error("\n  \x1b[31mFatal error:\x1b[0m", err)
  process.exit(1)
})
