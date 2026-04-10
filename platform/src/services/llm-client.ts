// ---------------------------------------------------------------------------
// LLM Client — shared model resolution + provider-agnostic inference layer.
//
// Extracted from chat.ts so that AgentExecutor, queues, orchestrator, and
// any other service can call LLMs without depending on OpenCode.
//
// Supports: vLLM (local), OpenAI-compatible, Anthropic, Google Gemini.
// ---------------------------------------------------------------------------

import { env } from "../config/env"
import { buildRegistry } from "./provider-registry"

// ── Provider adapters ────────────────────────────────────────────────

const OPENAI_COMPATIBLE = new Set([
  "openai", "groq", "together", "fireworks", "mistral", "deepseek", "openrouter",
])

export interface ResolvedModel {
  endpoint: string
  modelApiId: string
  modelName: string
  providerName: string
  source: "local" | "cloud"
  apiKey: string
  cloudProviderId?: string
  contextLimit?: number
  outputLimit?: number
}

/**
 * Resolve a model by ID/provider, falling back to the primary local model.
 */
export async function resolveModel(
  modelID?: string,
  providerID?: string,
): Promise<ResolvedModel> {
  const reg = await buildRegistry()
  const gwEndpoint = env.VLLM_GATEWAY_URL ?? ""
  const gwKey      = env.VLLM_GATEWAY_KEY ?? ""

  function localEndpoint(_p: (typeof reg.local)[0]) {
    return { endpoint: gwEndpoint || _p.endpoint, apiKey: gwKey || "" }
  }

  // No model specified → primary local
  if (!modelID) {
    const primary = reg.local.find((p) => p.isPrimary && p.status === "online")
    if (primary && primary.models.length > 0) {
      const m = primary.models[0]!
      const { endpoint, apiKey } = localEndpoint(primary)
      return { endpoint, apiKey, modelApiId: m.id, modelName: m.name, providerName: primary.name, source: "local", contextLimit: m.contextLimit, outputLimit: m.outputLimit }
    }
    for (const p of reg.local) {
      if (p.status === "online" && p.models.length > 0) {
        const m = p.models[0]!
        const { endpoint, apiKey } = localEndpoint(p)
        return { endpoint, apiKey, modelApiId: m.id, modelName: m.name, providerName: p.name, source: "local", contextLimit: m.contextLimit, outputLimit: m.outputLimit }
      }
    }
    throw Object.assign(new Error("No online vLLM provider found. Check that vLLM is running."), { status: 503 })
  }

  // Specific model → search local (online only)
  for (const p of reg.local) {
    if (providerID && p.id !== providerID) continue
    if (p.status !== "online") continue
    for (const m of p.models) {
      if (m.id === modelID || m.name === modelID) {
        const { endpoint, apiKey } = localEndpoint(p)
        return { endpoint, apiKey, modelApiId: m.id, modelName: m.name, providerName: p.name, source: "local", contextLimit: m.contextLimit, outputLimit: m.outputLimit }
      }
    }
  }

  // Search cloud providers
  for (const p of reg.cloud) {
    if (!p.configured) continue
    if (providerID && p.id !== providerID) continue
    for (const m of p.models) {
      if (m.id === modelID || m.name === modelID) {
        return { endpoint: p.apiUrl, modelApiId: m.id, modelName: m.name, providerName: p.name, source: "cloud", apiKey: process.env[p.keyEnvVar] ?? "", cloudProviderId: p.id, contextLimit: m.contextLimit, outputLimit: m.outputLimit }
      }
    }
  }

  // Check offline providers for a clear error
  for (const p of reg.local) {
    if (p.status === "offline") {
      for (const m of p.models) {
        if (m.id === modelID || m.name === modelID) {
          throw Object.assign(new Error(`Model "${modelID}" is on gateway "${p.name}" which is currently offline.`), { status: 503 })
        }
      }
    }
  }

  throw Object.assign(new Error(`Model "${modelID}" not found in registry or provider not configured`), { status: 404 })
}

/**
 * Find fallback models when the primary is rate-limited.
 */
const IMAGE_MODEL_RE = /dall-e|stable-diffusion|midjourney|imagen/i
export async function findFallbackModels(
  currentModelId: string,
): Promise<Array<ResolvedModel>> {
  const reg = await buildRegistry()
  const gwEndpoint = env.VLLM_GATEWAY_URL ?? ""
  const gwKey = env.VLLM_GATEWAY_KEY ?? ""

  const candidates: (ResolvedModel & { isCloud: boolean })[] = []
  for (const p of reg.local) {
    if (p.status !== "online") continue
    for (const m of p.models) {
      if (m.id === currentModelId) continue
      if (IMAGE_MODEL_RE.test(m.id) || IMAGE_MODEL_RE.test(m.name)) continue
      candidates.push({
        endpoint: gwEndpoint || p.endpoint, apiKey: gwKey || "",
        modelApiId: m.id, modelName: m.name, providerName: p.name,
        source: "local", contextLimit: m.contextLimit, outputLimit: m.outputLimit,
        isCloud: !!(m as any).isCloud,
      })
    }
  }
  candidates.sort((a, b) => (b.isCloud ? 1 : 0) - (a.isCloud ? 1 : 0))
  return candidates
}

// ── Provider fetch ───────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 300_000

export async function providerFetch(
  endpoint: string,
  apiKey: string,
  cloudProviderId: string | undefined,
  body: Record<string, any>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs)
  if (!cloudProviderId || OPENAI_COMPATIBLE.has(cloudProviderId)) {
    return fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    })
  }
  if (cloudProviderId === "anthropic") return fetchAnthropic(endpoint, apiKey, body, signal)
  if (cloudProviderId === "google") return fetchGoogle(endpoint, apiKey, body, signal)

  // Fallback: try OpenAI format
  return fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  })
}

async function fetchAnthropic(endpoint: string, apiKey: string, body: Record<string, any>, signal?: AbortSignal): Promise<Response> {
  const messages = (body.messages ?? []) as Array<{ role: string; content: string }>
  const systemMsg = messages.find(m => m.role === "system")?.content ?? ""
  const nonSystem = messages.filter(m => m.role !== "system")

  const anthropicBody: Record<string, any> = {
    model: body.model,
    max_tokens: body.max_tokens ?? 4096,
    system: systemMsg,
    messages: nonSystem.map(m => ({ role: m.role === "tool" ? "user" : m.role, content: m.content ?? "" })),
  }
  if (body.temperature != null) anthropicBody.temperature = body.temperature

  const res = await fetch(`${endpoint}/v1/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(anthropicBody),
    signal,
  })
  if (!res.ok) return res

  const data = await res.json() as any
  const text = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
  const openaiData = {
    choices: [{ message: { role: "assistant", content: text }, finish_reason: data.stop_reason ?? "stop" }],
    usage: { prompt_tokens: data.usage?.input_tokens ?? 0, completion_tokens: data.usage?.output_tokens ?? 0 },
  }
  return new Response(JSON.stringify(openaiData), { status: 200, headers: { "Content-Type": "application/json" } })
}

async function fetchGoogle(endpoint: string, apiKey: string, body: Record<string, any>, signal?: AbortSignal): Promise<Response> {
  const messages = (body.messages ?? []) as Array<{ role: string; content: string }>
  const systemMsg = messages.find(m => m.role === "system")?.content
  const nonSystem = messages.filter(m => m.role !== "system")

  const contents = nonSystem.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content ?? "" }],
  }))

  const geminiBody: Record<string, any> = { contents }
  if (systemMsg) geminiBody.systemInstruction = { parts: [{ text: systemMsg }] }
  geminiBody.generationConfig = { maxOutputTokens: body.max_tokens ?? 4096, temperature: body.temperature }

  const model = body.model
  const url = `${endpoint}/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(geminiBody),
    signal,
  })
  if (!res.ok) return res

  const data = await res.json() as any
  const candidate = data.candidates?.[0]
  const text = candidate?.content?.parts?.map((p: any) => p.text).join("") ?? ""
  const openaiData = {
    choices: [{ message: { role: "assistant", content: text }, finish_reason: candidate?.finishReason ?? "stop" }],
    usage: { prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0, completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0 },
  }
  return new Response(JSON.stringify(openaiData), { status: 200, headers: { "Content-Type": "application/json" } })
}
