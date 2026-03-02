#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Start just the OpenCode server (useful when platform runs separately)
// ---------------------------------------------------------------------------

import { opencode } from "../src/services/opencode-process"
import { env } from "../src/config/env"

async function main() {
  const url = await opencode.start({ directory: env.OPENCODE_DIR })
  console.log(`OpenCode server ready at ${url}`)

  const shutdown = async () => {
    await opencode.stop()
    process.exit(0)
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
