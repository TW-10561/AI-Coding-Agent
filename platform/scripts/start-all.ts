#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Start both OpenCode engine + Platform server in one command (headless).
// Used by: systemd service, Docker CMD, and `bun run start:all`.
// ---------------------------------------------------------------------------

import { opencode } from "../src/services/opencode-process"
import { env } from "../src/config/env"

// Port eviction is intentionally NOT done here:
//  - Under systemd: ExecStartPre=/usr/local/bin/thirdwave-pre-start.sh handles eviction
//    before this script runs. Double-eviction would risk killing legitimate processes.
//  - Direct developer runs: AUTO_PORT=true in env.ts automatically finds the next
//    free port without killing others' processes.
// Killing processes here would create a SIGKILL cascade when developers and the
// systemd service try to coexist on the same machine.

async function main() {
  console.log("[start-all] Starting OpenCode engine...")
  try {
    const url = await opencode.start({
      directory: env.OPENCODE_DIR,
    })
    console.log(`[start-all] OpenCode ready at ${url}`)
  } catch (e) {
    console.warn(`[start-all] OpenCode failed: ${e} — continuing without it`)
  }

  console.log("[start-all] Starting platform server...")

  // Import the server module (which self-starts via Bun.serve)
  const { shutdownPlatform } = await import("../src/server/index")

  // Graceful shutdown — uses the platform's own shutdown function
  const shutdown = async () => {
    console.log("\n[start-all] Shutting down...")
    try { await shutdownPlatform() } catch {}
    try { await opencode.stop() } catch {}
    setTimeout(() => process.exit(0), 150)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

main().catch((err) => {
  console.error("[start-all] Fatal:", err)
  process.exit(1)
})
