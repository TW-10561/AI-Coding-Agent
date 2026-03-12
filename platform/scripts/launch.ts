#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Kadavuley — Single-command launcher
// Starts: OpenCode engine → Platform backend → TUI (interactive)
// ---------------------------------------------------------------------------

import { env } from "../src/config/env"
import { opencode } from "../src/services/opencode-process"

declare global {
  var opencodeAvailable: boolean | undefined
}

const LOGO = `
  ╔══════════════════════════════════════════╗
  ║   ◆  K A D A V U L E Y                  ║
  ║   AI Coding Platform — Local & Private   ║
  ╚══════════════════════════════════════════╝
`

// ── Helpers ──────────────────────────────────────────────────────────

function log(tag: string, msg: string) {
  const ts = new Date().toLocaleTimeString()
  console.log(`  \x1b[90m${ts}\x1b[0m  \x1b[35m[${tag}]\x1b[0m  ${msg}`)
}

function die(msg: string): never {
  console.error(`\n  \x1b[31m✗\x1b[0m ${msg}\n`)
  process.exit(1)
}

// ── Pre-flight checks ───────────────────────────────────────────────

async function preflight() {
  // Check that bun is available
  const bunProc = Bun.spawnSync(["bun", "--version"])
  if (bunProc.exitCode !== 0) die("bun is not installed or not in PATH. Install: curl -fsSL https://bun.sh/install | bash")

  // Auto-cleanup: Aggressively kill any stale opencode/bun processes on ports 4096 and 3100
  try {
    log("preflight", "Cleaning up stale processes on ports 4096 and 3100...")
    const cleanup = `
      pkill -9 -f "opencode serve" 2>/dev/null
      pkill -9 -f "opencode" 2>/dev/null
      pkill -9 -f "bun run" 2>/dev/null
      pkill -9 -f "bun run scripts/launch" 2>/dev/null
      pkill -9 -f "platform" 2>/dev/null
      sleep 2
      lsof -i :4096,:3100 2>/dev/null | awk 'NR>1 {print $2}' | xargs -r kill -9 2>/dev/null
      sleep 1
    `
    Bun.spawnSync(["sh", "-c", cleanup], { 
      stdio: ["ignore", "ignore", "ignore"]
    })
  } catch {}

  // Check that opencode binary is available (non-blocking)
  let opencodeFound = false
  try {
    const ocProc = Bun.spawnSync([env.OPENCODE_BIN, "--version"])
    if (ocProc.exitCode === 0) {
      opencodeFound = true
      log("preflight", `opencode found at ${env.OPENCODE_BIN}`)
    }
  } catch {}
  
  if (!opencodeFound) {
    // Try common locations
    const locations = [
      `${process.env.HOME}/.local/bin/opencode`,
      "/usr/local/bin/opencode",
      new URL("../../packages/opencode/dist/opencode-linux-arm64/bin/opencode", import.meta.url).pathname,
    ]
    for (const loc of locations) {
      try {
        const check = Bun.spawnSync([loc, "--version"])
        if (check.exitCode === 0) {
          process.env.OPENCODE_BIN = loc
          opencodeFound = true
          log("preflight", `Found opencode at ${loc}`)
          break
        }
      } catch {}
    }
    if (!opencodeFound) {
      log("preflight", "\x1b[33m⚠ opencode binary not found. Skipping OpenCode engine. Build: cd packages/opencode && bun run build -- --single\x1b[0m")
    }
  }
  
  // Store whether opencode was found for later
  globalThis.opencodeAvailable = opencodeFound

  // Check vLLM is reachable (non-blocking warning)
  try {
    const resp = await fetch(`${env.VLLM_BASE_URL}/models`, {
      signal: AbortSignal.timeout(5000),
      headers: env.VLLM_API_KEY ? { Authorization: `Bearer ${env.VLLM_API_KEY}` } : {},
    })
    if (!resp.ok) log("preflight", `\x1b[33m⚠ vLLM returned ${resp.status} — prompts may fail\x1b[0m`)
    else log("preflight", `vLLM reachable (${env.VLLM_MODEL_ID})`)
  } catch {
    log("preflight", "\x1b[33m⚠ vLLM not reachable at " + env.VLLM_BASE_URL + " — prompts will fail\x1b[0m")
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log(LOGO)
  log("launch", "Running pre-flight checks...")
  await preflight()

  // 1) Start OpenCode engine (optional)
  let ocUrl = null
  if (globalThis.opencodeAvailable) {
    log("launch", "Starting OpenCode engine...")
    ocUrl = await opencode.start({ directory: env.OPENCODE_DIR })
    log("launch", `OpenCode ready → ${ocUrl}`)
  } else {
    log("launch", "Skipping OpenCode engine (not available)")
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
  const shutdown = async () => {
    console.log("\n  Shutting down...")
    if (globalThis.opencodeAvailable) {
      await opencode.stop()
    }
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

main().catch((err) => {
  console.error("\n  \x1b[31mFatal error:\x1b[0m", err)
  process.exit(1)
})
