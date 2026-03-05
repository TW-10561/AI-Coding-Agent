// ---------------------------------------------------------------------------
// Provider Registry — Artemis's "Zen-like" unified model catalogue.
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
]

// ── Static vLLM servers — known deployments that may not always be online ──
// Models are pre-configured so they appear in the registry even when offline,
// giving users visibility into the full fleet of available models.
// When the server comes online, live-probed models replace these.

const STATIC_VLLM_SERVERS: Record<string, LocalModel[]> = {
  "http://172.30.140.143:11435/v1": [
    { id: "lukealonso/MiniMax-M2.5-REAP-139B-A10B-NVFP4", name: "MiniMax M2.5 REAP 139B",  contextLimit: 32768, outputLimit: 4096 },
    { id: "Qwen/Qwen2.5-Coder-32B-Instruct-AWQ",          name: "Qwen 2.5 Coder 32B AWQ", contextLimit: 32768, outputLimit: 4096 },
    { id: "Qwen/Qwen3-8B",                                 name: "Qwen3 8B",               contextLimit: 32768, outputLimit: 4096 },
    { id: "openai/gpt-oss-20b",                             name: "GPT-OSS 20B",            contextLimit: 32768, outputLimit: 4096 },
    { id: "QuixiAI/Qwen3-30B-A3B-AWQ",                     name: "Qwen3 30B A3B AWQ",      contextLimit: 32768, outputLimit: 4096 },
  ],
}

// ── vLLM endpoint resolution ──────────────────────────────────────────
// Endpoints come from two env var sources:
//   1. VLLM_BASE_URL (single primary, always present)
//   2. VLLM_EXTRA_ENDPOINTS — comma-separated additional endpoints, e.g.:
//        VLLM_EXTRA_ENDPOINTS=http://host1:8001/v1,http://host2:8002/v1

function resolveVllmEndpoints(): Array<{ endpoint: string; apiKey: string; isPrimary: boolean }> {
  const endpoints: Array<{ endpoint: string; apiKey: string; isPrimary: boolean }> = []

  // Primary endpoint from existing env vars
  if (env.VLLM_BASE_URL) {
    const base = env.VLLM_BASE_URL.replace(/\/?$/, "").replace(/\/v1$/, "") + "/v1"
    endpoints.push({ endpoint: base, apiKey: env.VLLM_API_KEY ?? "", isPrimary: true })
  }

  // Extra endpoints
  const extra = (process.env["VLLM_EXTRA_ENDPOINTS"] ?? "").split(",").map(s => s.trim()).filter(Boolean)
  for (const ep of extra) {
    const base = ep.replace(/\/?$/, "").replace(/\/v1$/, "") + "/v1"
    if (base !== endpoints[0]?.endpoint) {
      endpoints.push({ endpoint: base, apiKey: env.VLLM_API_KEY ?? "", isPrimary: false })
    }
  }

  return endpoints
}

// ── Auto-discovery: scan for vLLM servers on known hosts/ports ────────
// Scans hosts from VLLM_SCAN_HOSTS (default: primary host + localhost)
// on ports VLLM_SCAN_PORTS (default: 8000-8010).  Each scan is a quick
// HEAD /v1/models with a 1.5s timeout.  Found endpoints get merged.

async function discoverVllmEndpoints(): Promise<string[]> {
  const discovered: string[] = []

  // Resolve which hosts to scan
  const primaryHost = (() => {
    try { return new URL(env.VLLM_BASE_URL ?? "").hostname }
    catch { return "" }
  })()
  const scanHostsStr = process.env["VLLM_SCAN_HOSTS"] ?? ""
  const defaultHosts = [primaryHost, "localhost", "127.0.0.1"].filter(Boolean)
  const hosts = scanHostsStr
    ? scanHostsStr.split(",").map(s => s.trim()).filter(Boolean)
    : [...new Set(defaultHosts)]

  // Resolve ports
  const scanPortsStr = process.env["VLLM_SCAN_PORTS"] ?? ""
  let ports: number[]
  if (scanPortsStr) {
    ports = scanPortsStr.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n))
  } else {
    ports = Array.from({ length: 11 }, (_, i) => 8000 + i) // 8000–8010
  }

  // Probe all host:port combos in parallel (HEAD with tight timeout)
  const probes = hosts.flatMap(host =>
    ports.map(async (port) => {
      const url = `http://${host}:${port}/v1/models`
      try {
        const res = await fetch(url, {
          method: "HEAD",
          signal: AbortSignal.timeout(1500),
        })
        if (res.ok) return `http://${host}:${port}/v1`
      } catch {
        // not reachable — ignore
      }
      return null
    })
  )

  const results = await Promise.all(probes)
  for (const r of results) {
    if (r) discovered.push(r)
  }
  return discovered
}

// ── Live vLLM probe ───────────────────────────────────────────────────

async function probeVllmEndpoint(
  idx: number,
  { endpoint, apiKey, isPrimary }: ReturnType<typeof resolveVllmEndpoints>[number],
): Promise<LocalProvider> {
  const host = (() => { try { return new URL(endpoint).host } catch { return endpoint } })()
  const name = isPrimary
    ? `Local vLLM — ${host}`
    : `Local vLLM #${idx + 1} — ${host}`
  const id = isPrimary ? "vllm" : `vllm-${idx}`

  const before = Date.now()
  try {
    const res = await fetch(`${endpoint}/models`, {
      signal: AbortSignal.timeout(5_000),
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const json = await res.json() as { data?: Array<{ id: string; max_model_len?: number }> }
    const latencyMs = Date.now() - before
    const models: LocalModel[] = (json.data ?? []).map(m => ({
      id: m.id,
      name: (isPrimary && m.id === env.VLLM_MODEL_ID)
        ? (env.VLLM_MODEL_NAME || m.id)     // use friendly name for the primary model
        : m.id,
      contextLimit: isPrimary && m.id === env.VLLM_MODEL_ID
        ? env.VLLM_CONTEXT_LIMIT
        : (m.max_model_len ?? 32768),
      outputLimit:  isPrimary && m.id === env.VLLM_MODEL_ID ? env.VLLM_OUTPUT_LIMIT  : 4096,
    }))

    return { id, name, endpoint, status: "online", latencyMs, models, isPrimary }
  } catch {
    // Offline — use static model list if available, otherwise env fallback
    const staticModels = STATIC_VLLM_SERVERS[endpoint]
    const fallbackModels: LocalModel[] = staticModels
      ? staticModels
      : isPrimary
        ? [{ id: env.VLLM_MODEL_ID, name: env.VLLM_MODEL_NAME, contextLimit: env.VLLM_CONTEXT_LIMIT, outputLimit: env.VLLM_OUTPUT_LIMIT }]
        : []
    return { id, name, endpoint, status: "offline", models: fallbackModels, isPrimary }
  }
}

// ── Registry build ────────────────────────────────────────────────────

const CACHE_TTL_MS = 15_000     // 15 s — cheap to probe vLLM that often

let _cache: RegistrySnapshot | null = null
let _cacheTs = 0

export async function buildRegistry(force = false): Promise<RegistrySnapshot> {
  const now = Date.now()
  if (!force && _cache && now - _cacheTs < CACHE_TTL_MS) return _cache

  const endpoints = resolveVllmEndpoints()
  const knownUrls = new Set(endpoints.map(e => e.endpoint))

  // Auto-discover additional vLLM servers on the subnet
  try {
    const discovered = await discoverVllmEndpoints()
    for (const url of discovered) {
      if (!knownUrls.has(url)) {
        knownUrls.add(url)
        endpoints.push({ endpoint: url, apiKey: env.VLLM_API_KEY ?? "", isPrimary: false })
      }
    }
  } catch {
    // Discovery failed — proceed with configured endpoints only
  }

  // Merge static vLLM servers (known deployments that may be offline)
  for (const staticEp of Object.keys(STATIC_VLLM_SERVERS)) {
    if (!knownUrls.has(staticEp)) {
      knownUrls.add(staticEp)
      endpoints.push({ endpoint: staticEp, apiKey: env.VLLM_API_KEY ?? "", isPrimary: false })
    }
  }

  // Probe all vLLM endpoints in parallel
  const localProviders = await Promise.all(endpoints.map((ep, i) => probeVllmEndpoint(i, ep)))

  // Build cloud providers — only mark "configured" if their env key is set
  const cloudProviders: CloudProvider[] = CLOUD_CATALOG.map(p => ({
    ...p,
    configured: Boolean(process.env[p.keyEnvVar]),
  }))

  // Active model: primary vLLM's first (or only) model
  const primaryVllm = localProviders.find(p => p.isPrimary)
  const firstModel = primaryVllm?.models[0]
  const activeModel = firstModel
    ? `${primaryVllm!.id}/${firstModel.id}`
    : "none"

  _cache = { local: localProviders, cloud: cloudProviders, activeModel, generatedAt: new Date().toISOString() }
  _cacheTs = now
  return _cache
}
