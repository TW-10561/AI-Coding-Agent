// ---------------------------------------------------------------------------
// Provider Registry — Thirdwave's "Zen-like" unified model catalogue.
//
// Combines two sources:
//   • LOCAL  — vLLM endpoints discovered from env/config.  Always shown;
//              marked "online" or "offline" per live /v1/models probe.
//   • CLOUD  — static catalogue of known cloud providers.  Shown with
//              "configured" = true only when the matching API key env var
//              is present.  Users swap the key in .env and restart.
//
// Design goals
//   • Never requires a cloud key to start — platform works offline.
//   • Can be pulled live from /api/registry at any time.
//   • Easy to extend: add an entry to CLOUD_CATALOG or a vllm endpoint.
//   • Future-proof: the activeModel concept lets other services read the
//     currently selected model without hardcoding env vars everywhere.
// ---------------------------------------------------------------------------

import { env } from "../config/env"

// ── Types ─────────────────────────────────────────────────────────────

export interface LocalModel {
  id: string          // raw model id from vLLM (e.g. "plezan/MiniMax-M2.1-REAP-50-W4A16")
  name: string        // display name (id or overridden by VLLM_MODEL_NAME for primary)
  contextLimit: number
  outputLimit: number
}

export interface LocalProvider {
  id: string          // e.g. "vllm-0"
  name: string        // e.g. "Local vLLM (172.30.140.91:8000)"
  endpoint: string    // full base URL including /v1
  status: "online" | "offline" | "unknown"
  latencyMs?: number
  models: LocalModel[]
  isPrimary: boolean  // the env.VLLM_BASE_URL one is "primary" (default for new sessions)
}

export interface CloudModel {
  id: string          // e.g. "gpt-4o"
  name: string        // e.g. "GPT-4o"
  contextLimit: number
  outputLimit: number
  costIn: number      // USD per million input tokens
  costOut: number     // USD per million output tokens
}

export interface CloudProvider {
  id: string          // e.g. "openai"
  name: string        // e.g. "OpenAI"
  apiUrl: string
  docUrl: string
  keyEnvVar: string   // name of the env var that holds the API key
  configured: boolean // true when that env var is set at runtime
  models: CloudModel[]
}

export interface RegistrySnapshot {
  local: LocalProvider[]
  cloud: CloudProvider[]
  /** Canonical ID of the currently selected model, in the form "providerID/modelID" */
  activeModel: string
  generatedAt: string
}

// ── Cloud provider catalogue ──────────────────────────────────────────
// Keep models concise — a few flagship ones per provider is enough.
// Users can always look up more via /providers (which queries OpenCode directly).

const CLOUD_CATALOG: Omit<CloudProvider, "configured">[] = [
  {
    id: "openai",
    name: "OpenAI",
    apiUrl: "https://api.openai.com/v1",
    docUrl: "https://platform.openai.com/api-keys",
    keyEnvVar: "OPENAI_API_KEY",
    models: [
      { id: "gpt-4.1",            name: "GPT-4.1",             contextLimit: 1000000, outputLimit: 32768,  costIn: 2,    costOut: 8    },
      { id: "gpt-4.1-mini",       name: "GPT-4.1 Mini",        contextLimit: 1000000, outputLimit: 32768,  costIn: 0.4,  costOut: 1.6  },
      { id: "gpt-4o",             name: "GPT-4o",              contextLimit: 128000,  outputLimit: 16384,  costIn: 2.5,  costOut: 10   },
      { id: "o4-mini",            name: "o4-mini (reasoning)",  contextLimit: 200000,  outputLimit: 100000, costIn: 1.1,  costOut: 4.4  },
      { id: "o3",                 name: "o3 (reasoning)",       contextLimit: 200000,  outputLimit: 100000, costIn: 10,   costOut: 40   },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    apiUrl: "https://api.anthropic.com",
    docUrl: "https://console.anthropic.com/settings/keys",
    keyEnvVar: "ANTHROPIC_API_KEY",
    models: [
      { id: "claude-opus-4-5",    name: "Claude Opus 4.5",      contextLimit: 200000,  outputLimit: 32000,  costIn: 15,   costOut: 75   },
      { id: "claude-sonnet-4-5",  name: "Claude Sonnet 4.5",    contextLimit: 200000,  outputLimit: 64000,  costIn: 3,    costOut: 15   },
      { id: "claude-haiku-3-5",   name: "Claude Haiku 3.5",     contextLimit: 200000,  outputLimit: 8096,   costIn: 0.8,  costOut: 4    },
    ],
  },
  {
    id: "google",
    name: "Google AI",
    apiUrl: "https://generativelanguage.googleapis.com/v1beta",
    docUrl: "https://aistudio.google.com/app/apikey",
    keyEnvVar: "GOOGLE_AI_API_KEY",
    models: [
      { id: "gemini-2.5-pro",            name: "Gemini 2.5 Pro",     contextLimit: 1048576, outputLimit: 65536,  costIn: 1.25, costOut: 10   },
      { id: "gemini-2.5-flash",          name: "Gemini 2.5 Flash",   contextLimit: 1048576, outputLimit: 65536,  costIn: 0.15, costOut: 0.6  },
      { id: "gemini-2.0-flash",          name: "Gemini 2.0 Flash",   contextLimit: 1048576, outputLimit: 8192,   costIn: 0.1,  costOut: 0.4  },
    ],
  },
  {
    id: "mistral",
    name: "Mistral",
    apiUrl: "https://api.mistral.ai/v1",
    docUrl: "https://console.mistral.ai/api-keys",
    keyEnvVar: "MISTRAL_API_KEY",
    models: [
      { id: "mistral-large-latest",  name: "Mistral Large",     contextLimit: 131072, outputLimit: 4096, costIn: 2,    costOut: 6    },
      { id: "codestral-latest",      name: "Codestral",         contextLimit: 262144, outputLimit: 4096, costIn: 0.3,  costOut: 0.9  },
      { id: "mistral-small-latest",  name: "Mistral Small",     contextLimit: 131072, outputLimit: 4096, costIn: 0.1,  costOut: 0.3  },
    ],
  },
  {
    id: "groq",
    name: "Groq",
    apiUrl: "https://api.groq.com/openai/v1",
    docUrl: "https://console.groq.com/keys",
    keyEnvVar: "GROQ_API_KEY",
    models: [
      { id: "llama-3.3-70b-versatile",  name: "Llama 3.3 70B",  contextLimit: 128000, outputLimit: 32768, costIn: 0.59, costOut: 0.79 },
      { id: "moonshotai/kimi-k2-instruct", name: "Kimi K2",      contextLimit: 131072, outputLimit: 16384, costIn: 0.15, costOut: 0.15 },
      { id: "deepseek-r1-distill-llama-70b", name: "DeepSeek R1 (Llama 70B)", contextLimit: 128000, outputLimit: 16000, costIn: 0.75, costOut: 0.99 },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    apiUrl: "https://api.deepseek.com/v1",
    docUrl: "https://platform.deepseek.com/api_keys",
    keyEnvVar: "DEEPSEEK_API_KEY",
    models: [
      { id: "deepseek-chat",      name: "DeepSeek V3",           contextLimit: 64000,  outputLimit: 8192, costIn: 0.27, costOut: 1.1  },
      { id: "deepseek-reasoner",  name: "DeepSeek R1 (Reasoner)", contextLimit: 64000,  outputLimit: 8192, costIn: 0.55, costOut: 2.19 },
    ],
  },
  {
    id: "together",
    name: "Together AI",
    apiUrl: "https://api.together.xyz/v1",
    docUrl: "https://api.together.ai/settings/api-keys",
    keyEnvVar: "TOGETHER_API_KEY",
    models: [
      { id: "meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo", name: "Llama 3.1 405B", contextLimit: 130815, outputLimit: 4096, costIn: 3.5, costOut: 3.5 },
      { id: "Qwen/Qwen2.5-Coder-32B-Instruct", name: "Qwen 2.5 Coder 32B", contextLimit: 32768, outputLimit: 4096, costIn: 0.8, costOut: 0.8 },
    ],
  },
  {
    id: "fireworks",
    name: "Fireworks AI",
    apiUrl: "https://api.fireworks.ai/inference/v1",
    docUrl: "https://fireworks.ai/account/api-keys",
    keyEnvVar: "FIREWORKS_API_KEY",
    models: [
      { id: "accounts/fireworks/models/llama-v3p3-70b-instruct", name: "Llama 3.3 70B", contextLimit: 131072, outputLimit: 16384, costIn: 0.9, costOut: 0.9 },
      { id: "accounts/fireworks/models/qwen2p5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B", contextLimit: 32768, outputLimit: 8192, costIn: 0.9, costOut: 0.9 },
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    apiUrl: "https://openrouter.ai/api/v1",
    docUrl: "https://openrouter.ai/settings/keys",
    keyEnvVar: "OPENROUTER_API_KEY",
    models: [
      { id: "anthropic/claude-sonnet-4",       name: "Claude Sonnet 4",        contextLimit: 200000, outputLimit: 64000,  costIn: 3,    costOut: 15   },
      { id: "openai/gpt-4.1",                  name: "GPT-4.1",                contextLimit: 1000000, outputLimit: 32768, costIn: 2,    costOut: 8    },
      { id: "google/gemini-2.5-pro",            name: "Gemini 2.5 Pro",         contextLimit: 1048576, outputLimit: 65536, costIn: 1.25, costOut: 10   },
      { id: "deepseek/deepseek-r1",             name: "DeepSeek R1",            contextLimit: 163840, outputLimit: 8192,  costIn: 0.55, costOut: 2.19 },
      { id: "qwen/qwen3-235b-a22b",             name: "Qwen3 235B",             contextLimit: 40960,  outputLimit: 8192,  costIn: 0.14, costOut: 0.6  },
      { id: "meta-llama/llama-4-maverick",       name: "Llama 4 Maverick",       contextLimit: 1048576, outputLimit: 32768, costIn: 0.2,  costOut: 0.6  },
    ],
  },
]

// ── NOTE: Direct vLLM access removed — all traffic routes through gateway ──

// ── Gateway discovery — query APISIX for all models behind the LB ────

async function probeGateway(): Promise<LocalProvider | null> {
  const gwUrl = env.VLLM_GATEWAY_URL
  if (!gwUrl) return null

  const base = gwUrl.replace(/\/?$/, "").replace(/\/v1$/, "") + "/v1"
  const before = Date.now()
  try {
    const res = await fetch(`${base}/models`, {
      signal: AbortSignal.timeout(5_000),
      headers: env.VLLM_GATEWAY_KEY ? { Authorization: `Bearer ${env.VLLM_GATEWAY_KEY}` } : {},
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const json = await res.json() as { data?: Array<{ id: string; max_model_len?: number; owned_by?: string }> }
    const latencyMs = Date.now() - before

    const models: LocalModel[] = (json.data ?? []).map(m => ({
      id: m.id,
      name: m.id,
      contextLimit: m.max_model_len ?? 32768,
      outputLimit: 4096,
    }))

    const host = (() => { try { return new URL(base).host } catch { return base } })()
    return {
      id: "gateway",
      name: `Gateway — ${host}`,
      endpoint: base,
      status: "online",
      latencyMs,
      models,
      isPrimary: true,
    }
  } catch {
    return {
      id: "gateway",
      name: "Gateway (offline)",
      endpoint: base,
      status: "offline",
      models: [],
      isPrimary: true,
    }
  }
}

// ── Registry build ────────────────────────────────────────────────────

const CACHE_TTL_MS = 15_000     // 15 s — cheap to probe vLLM that often

let _cache: RegistrySnapshot | null = null
let _cacheTs = 0

export async function buildRegistry(force = false): Promise<RegistrySnapshot> {
  const now = Date.now()
  if (!force && _cache && now - _cacheTs < CACHE_TTL_MS) return _cache

  const localProviders: LocalProvider[] = []

  // Gateway discovery — the ONLY source for local models
  const gw = await probeGateway()
  if (gw) localProviders.push(gw)

  // Build cloud providers — only mark "configured" if their env key is set
  const cloudProviders: CloudProvider[] = CLOUD_CATALOG.map(p => ({
    ...p,
    configured: Boolean(process.env[p.keyEnvVar]),
  }))

  // Active model: gateway first model
  const primary = localProviders.find(p => p.isPrimary && p.status === "online")
  const firstModel = primary?.models[0]
  const activeModel = firstModel
    ? `${primary!.id}/${firstModel.id}`
    : "none"

  _cache = { local: localProviders, cloud: cloudProviders, activeModel, generatedAt: new Date().toISOString() }
  _cacheTs = now
  return _cache
}

// ── Background gateway polling ────────────────────────────────────────
// Polls the gateway periodically and broadcasts status-change events so
// the TUI and other consumers can react without explicit polling.

type StatusChangeListener = (status: "online" | "offline", modelCount: number, latencyMs?: number) => void
const _statusListeners: StatusChangeListener[] = []
let _lastKnownStatus: "online" | "offline" | null = null
let _pollingTimer: ReturnType<typeof setInterval> | null = null

export function onGatewayStatusChange(fn: StatusChangeListener): () => void {
  _statusListeners.push(fn)
  return () => {
    const idx = _statusListeners.indexOf(fn)
    if (idx !== -1) _statusListeners.splice(idx, 1)
  }
}

export function getLastGatewayStatus(): { status: "online" | "offline" | null; modelCount: number } {
  if (!_cache) return { status: null, modelCount: 0 }
  const gw = _cache.local.find(p => p.isPrimary)
  const s = gw?.status
  return { status: (s === "online" || s === "offline") ? s : null, modelCount: gw?.models.length ?? 0 }
}

export function startRegistryPolling(intervalMs = 30_000): () => void {
  if (_pollingTimer) return () => {}  // already polling

  async function poll() {
    try {
      const snapshot = await buildRegistry(true)  // force refresh
      const gw = snapshot.local.find(p => p.isPrimary)
      const rawStatus = gw?.status ?? "offline"
      const newStatus: "online" | "offline" = rawStatus === "online" ? "online" : "offline"
      if (newStatus !== _lastKnownStatus) {
        _lastKnownStatus = newStatus
        for (const fn of _statusListeners) {
          try { fn(newStatus, gw?.models.length ?? 0, gw?.latencyMs) } catch {}
        }
      }
    } catch {}
  }

  _pollingTimer = setInterval(poll, intervalMs)
  // Run immediately on start
  poll()

  return () => {
    if (_pollingTimer) { clearInterval(_pollingTimer); _pollingTimer = null }
  }
}
