// ---------------------------------------------------------------------------
// Platform configuration — single source of truth for env / defaults
// ---------------------------------------------------------------------------

import z from "zod"

const Schema = z.object({
  // ── Platform server ────────────────────────────────────────────────
  PORT: z.coerce.number().default(3100),
  HOST: z.string().default("0.0.0.0"),

  // ── OpenCode engine ────────────────────────────────────────────────
  OPENCODE_URL: z.string().url().default("http://127.0.0.1:4096"),
  OPENCODE_BIN: z.string().default("opencode"),
  OPENCODE_DIR: z.string().default(process.cwd()),
  OPENCODE_SERVER_USERNAME: z.string().optional(),
  OPENCODE_SERVER_PASSWORD: z.string().optional(),

  // ── Local LLM (vLLM) ──────────────────────────────────────────────
  VLLM_BASE_URL: z.string().url().default("http://172.30.140.91:8000/v1"),
  VLLM_API_KEY: z.string().default("vllm-qgDSWPGLwcjvq63ApWIiU0sgiKiF5E5nqvGaAcKfh8Q"),
  VLLM_MODEL_ID: z.string().default("plezan/MiniMax-M2.1-REAP-50-W4A16"),
  VLLM_MODEL_NAME: z.string().default("MiniMax M2.1 REAP 50 W4A16"),
  VLLM_CONTEXT_LIMIT: z.coerce.number().default(30000),
  VLLM_OUTPUT_LIMIT: z.coerce.number().default(4096),

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
  return result.data!
}

export const env = load()
