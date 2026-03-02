#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Start both OpenCode engine + Platform server in one command
// ---------------------------------------------------------------------------

import { opencode } from "../src/services/opencode-process"
import { env } from "../src/config/env"

async function main() {
  console.log("[start-all] Starting OpenCode engine...")
  const url = await opencode.start({
    directory: env.OPENCODE_DIR,
  })

  console.log(`[start-all] OpenCode ready at ${url}`)
  console.log("[start-all] Starting platform server...")

  // Import the server module (which self-starts via Bun.serve)
  await import("../src/server/index")

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[start-all] Shutting down...")
    await opencode.stop()
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

main().catch((err) => {
  console.error("[start-all] Fatal:", err)
  process.exit(1)
})
