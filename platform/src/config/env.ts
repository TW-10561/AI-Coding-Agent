// ---------------------------------------------------------------------------
// Platform configuration — single source of truth for env / defaults
// ---------------------------------------------------------------------------
// Multi-user support:
//   Set ARTEMIS_PORT_OFFSET=N to shift both Platform and OpenCode ports.
//   Example: ARTEMIS_PORT_OFFSET=10  →  Platform :3110, OpenCode :4106
//   This lets multiple developers run Artemis on the same host.
//
//   Alternatively set PORT and OPENCODE_URL explicitly per user.
//
//   When AUTO_PORT=true and the default PORT is busy, the platform
//   will probe up to 20 consecutive ports to find a free one.
// ---------------------------------------------------------------------------

import z from "zod"

const Schema = z.object({
  // ── Platform server ────────────────────────────────────────────────
  PORT: z.coerce.number().default(3100),
  HOST: z.string().default("0.0.0.0"),

  // ── Multi-user port offset ─────────────────────────────────────────
  // Add this number to both PORT and the OpenCode port.
  // E.g. ARTEMIS_PORT_OFFSET=10 → Platform=3110, OpenCode=4106
  ARTEMIS_PORT_OFFSET: z.coerce.number().default(0),

  // When true, automatically find a free port if PORT is occupied
  AUTO_PORT: z.coerce.boolean().default(true),

  // ── OpenCode engine ────────────────────────────────────────────────
  OPENCODE_URL: z.string().url().default("http://127.0.0.1:4096"),
  OPENCODE_BIN: z.string().default("opencode"),
  OPENCODE_DIR: z.string().default(process.cwd()),
  OPENCODE_SERVER_USERNAME: z.string().optional(),
  OPENCODE_SERVER_PASSWORD: z.string().optional(),

  // ── Primary local vLLM ─────────────────────────────────────────────
  // This is the "built-in" provider — always shown, works without any API key.
  VLLM_BASE_URL: z.string().url().default("http://172.30.140.91:8000/v1"),
  VLLM_API_KEY: z.string().default("vllm-qgDSWPGLwcjvq63ApWIiU0sgiKiF5E5nqvGaAcKfh8Q"),
  VLLM_MODEL_ID: z.string().default("plezan/MiniMax-M2.1-REAP-50-W4A16"),
  VLLM_MODEL_NAME: z.string().default("MiniMax M2.1 REAP 50 W4A16"),
  VLLM_CONTEXT_LIMIT: z.coerce.number().default(30000),
  VLLM_OUTPUT_LIMIT: z.coerce.number().default(4096),
  // Extra vLLM endpoints — comma-separated, e.g. "http://h2:8001/v1,http://h3:8002/v1"
  VLLM_EXTRA_ENDPOINTS: z.string().optional(),

  // ── Cloud provider API keys (all optional) ─────────────────────────
  // Set any of these to enable the corresponding cloud provider in /api/registry.
  // The platform works fully without them (local vLLM only).
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_AI_API_KEY: z.string().optional(),
  MISTRAL_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  TOGETHER_API_KEY: z.string().optional(),
  FIREWORKS_API_KEY: z.string().optional(),

  // ── Platform auth ──────────────────────────────────────────────────
  PLATFORM_API_KEY: z.string().optional(),
  PLATFORM_JWT_SECRET: z.string().optional(),

  // ── Logging ────────────────────────────────────────────────────────
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // ── Misc ───────────────────────────────────────────────────────────
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
})

export type PlatformEnv = z.infer<typeof Schema>

function load(): PlatformEnv {
  const result = Schema.safeParse(process.env)
  if (!result.success) {
    console.error("Invalid platform configuration:", result.error!.format())
    process.exit(1)
  }

  const cfg = result.data!

  // ── Apply port offset for multi-user ────────────────────────────
  if (cfg.ARTEMIS_PORT_OFFSET > 0) {
    cfg.PORT += cfg.ARTEMIS_PORT_OFFSET

    // Shift OpenCode URL port by the same offset (only if using default)
    const ocUrl = new URL(cfg.OPENCODE_URL)
    const defaultOcPort = 4096
    if (Number(ocUrl.port) === defaultOcPort) {
      ocUrl.port = String(defaultOcPort + cfg.ARTEMIS_PORT_OFFSET)
      cfg.OPENCODE_URL = ocUrl.toString().replace(/\/$/, "")
    }
  }

  return cfg
}

export const env = load()

/**
 * Probe whether a port is available on the given host.
 * Returns true if the port is free.
 */
export function isPortFree(port: number, host = "127.0.0.1"): boolean {
  try {
    const probe = Bun.serve({ port, hostname: host, fetch: () => new Response() })
    probe.stop(true)
    return true
  } catch {
    return false
  }
}

/**
 * Find a free port starting from `start`, scanning up to `maxAttempts` ports.
 * Returns the first available port, or throws if none found.
 */
export function findFreePort(start: number, host = "0.0.0.0", maxAttempts = 20): number {
  for (let i = 0; i < maxAttempts; i++) {
    if (isPortFree(start + i, host)) return start + i
  }
  throw new Error(
    `No free port found in range ${start}–${start + maxAttempts - 1}.\n` +
    `Other Artemis instances may be running. Use ARTEMIS_PORT_OFFSET=N to shift ports.`
  )
}
