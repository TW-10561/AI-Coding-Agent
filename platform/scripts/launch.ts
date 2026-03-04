#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Artemis — Single-command launcher
// Starts: OpenCode engine → Platform backend → TUI (interactive)
// ---------------------------------------------------------------------------

import { env } from "../src/config/env"
import { opencode } from "../src/services/opencode-process"

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

function die(msg: string): never {
  console.error(`\n  \x1b[31m✗\x1b[0m ${msg}\n`)
  process.exit(1)
}

// ── Pre-flight checks ───────────────────────────────────────────────

async function preflight() {
  // Check that bun is available
  const bunProc = Bun.spawnSync(["bun", "--version"])
  if (bunProc.exitCode !== 0) die("bun is not installed or not in PATH. Install: curl -fsSL https://bun.sh/install | bash")

  // Check that opencode binary is available
  const ocProc = Bun.spawnSync([env.OPENCODE_BIN, "--version"])
  if (ocProc.exitCode !== 0) {
    // Try common locations
    const locations = [
      `${process.env.HOME}/.local/bin/opencode`,
      "/usr/local/bin/opencode",
      new URL("../../packages/opencode/dist/opencode-linux-arm64/bin/opencode", import.meta.url).pathname,
    ]
    let found = false
    for (const loc of locations) {
      try {
        const check = Bun.spawnSync([loc, "--version"])
        if (check.exitCode === 0) {
          process.env.OPENCODE_BIN = loc
          found = true
          log("preflight", `Found opencode at ${loc}`)
          break
        }
      } catch {}
    }
    if (!found) die(`opencode binary not found. Build it: cd packages/opencode && bun run build -- --single`)
  }

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

  // 1) Start OpenCode engine
  log("launch", "Starting OpenCode engine...")
  const ocUrl = await opencode.start({ directory: env.OPENCODE_DIR })
  log("launch", `OpenCode ready → ${ocUrl}`)

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
    await opencode.stop()
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

main().catch((err) => {
  console.error("\n  \x1b[31mFatal error:\x1b[0m", err)
  process.exit(1)
})
