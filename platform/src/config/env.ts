// ---------------------------------------------------------------------------
// Platform configuration — single source of truth for env / defaults
// ---------------------------------------------------------------------------
// Multi-user support:
//   Set THIRDWAVE_PORT_OFFSET=N to shift both Platform and OpenCode ports.
//   Example: THIRDWAVE_PORT_OFFSET=10  →  Platform :3110, OpenCode :4106
//   This lets multiple developers run Thirdwave on the same host.
//
//   Alternatively set PORT and OPENCODE_URL explicitly per user.
//
//   When AUTO_PORT=true and the default PORT is busy, the platform
//   will probe up to 20 consecutive ports to find a free one.
// ---------------------------------------------------------------------------

import z from "zod"
import { readFileSync } from "fs"
import { resolve, dirname } from "path"

// ── Load .env from platform/ directory regardless of CWD ──────────────
// Bun auto-loads .env from CWD, but when the server is started from the
// repo root (e.g. `bun run platform/src/server/index.ts`), the .env in
// platform/ is missed.  We manually load it here.
const platformDir = resolve(dirname(new URL(import.meta.url).pathname), "../..")
const envPaths = [
  resolve(platformDir, ".env"),
  resolve(platformDir, ".env.local"),
]
for (const p of envPaths) {
  try {
    const content = readFileSync(p, "utf-8")
    for (const line of content.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eqIdx = trimmed.indexOf("=")
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim()
      // Only set if not already in environment (env vars take precedence)
      if (!(key in process.env)) {
        process.env[key] = val
      }
    }
  } catch {}
}

const Schema = z.object({
  // ── Platform server ────────────────────────────────────────────────
  PORT: z.coerce.number().default(3100),
  HOST: z.string().default("0.0.0.0"),

  // ── Multi-user port offset ─────────────────────────────────────────
  // Add this number to both PORT and the OpenCode port.
  // E.g. THIRDWAVE_PORT_OFFSET=10 → Platform=3110, OpenCode=4106
  THIRDWAVE_PORT_OFFSET: z.coerce.number().default(0),

  // When true, automatically find a free port if PORT is occupied
  AUTO_PORT: z.coerce.boolean().default(true),

  // ── OpenCode engine ────────────────────────────────────────────────
  OPENCODE_URL: z.string().url().default("http://127.0.0.1:4096"),
  OPENCODE_BIN: z.string().default("opencode"),
  OPENCODE_DIR: z.string().default(process.cwd()),
  // Dedicated directory where the AI agent writes files (server-side).
  // Defaults to .agent-workspace under OPENCODE_DIR.
  AGENT_WORKSPACE_DIR: z.string().optional(),
  OPENCODE_SERVER_USERNAME: z.string().optional(),
  OPENCODE_SERVER_PASSWORD: z.string().optional(),

  // ── Inference Gateway ───────────────────────────────────────────────
  // All local vLLM calls route through this gateway.
  // When set, chat requests use VLLM_GATEWAY_URL + VLLM_GATEWAY_KEY instead
  // of hitting individual vLLM endpoints directly.
  VLLM_GATEWAY_URL: z.string().url().optional(),
  VLLM_GATEWAY_KEY: z.string().optional(),

  // ── Primary local vLLM ─────────────────────────────────────────────
  // Optional — set to enable direct vLLM access (bypassing gateway).
  // When gateway is configured, these are used as fallback only.
  VLLM_BASE_URL: z.string().url().optional(),
  VLLM_API_KEY: z.string().optional(),
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
  OPENROUTER_API_KEY: z.string().optional(),

  // ── Platform auth ──────────────────────────────────────────────────
  PLATFORM_API_KEY: z.string().optional(),
  PLATFORM_JWT_SECRET: z.string().optional(),

  // ── PostgreSQL ─────────────────────────────────────────────────────
  // Required for Phase 1+.  Falls back to SQLite-only mode when unset.
  POSTGRES_URL: z.string().url().optional(),
  PGBOUNCER_URL: z.string().url().optional(),

  // ── JWT auth (Phase 3+) ────────────────────────────────────────────
  JWT_SECRET: z.string().optional(),
  JWT_EXPIRY: z.string().default("8h"),
  ONBOARDING_TOKEN_EXPIRY: z.string().default("24h"),

  // ── Slack (Phase 5+) ──────────────────────────────────────────────
  SLACK_WEBHOOK_URL: z.string().url().optional(),
  APPROVAL_EXPIRY_MINUTES: z.coerce.number().default(30),

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
  if (cfg.THIRDWAVE_PORT_OFFSET > 0) {
    cfg.PORT += cfg.THIRDWAVE_PORT_OFFSET

    // Shift OpenCode URL port by the same offset (only if using default)
    const ocUrl = new URL(cfg.OPENCODE_URL)
    const defaultOcPort = 4096
    if (Number(ocUrl.port) === defaultOcPort) {
      ocUrl.port = String(defaultOcPort + cfg.THIRDWAVE_PORT_OFFSET)
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
    `Other Thirdwave instances may be running. Use THIRDWAVE_PORT_OFFSET=N to shift ports.`
  )
}
