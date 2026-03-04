// ---------------------------------------------------------------------------
// Direct chat routes — /api/chat
// Talks directly to vLLM endpoints bypassing OpenCode's heavy system prompt.
// Useful for: fast lightweight queries, models with small context windows,
// and when the user doesn't need tool-use capabilities.
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import { env } from "../../config/env"
import { buildRegistry } from "../../services/provider-registry"

const ChatBody = z.object({
  message: z.string().min(1),
  modelID: z.string().optional(),
  providerID: z.string().optional(),
  system: z.string().optional(),
  maxTokens: z.number().min(1).max(16384).optional(),
  temperature: z.number().min(0).max(2).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .optional(),
})

export function chatRoutes() {
  return new Hono()

    /**
     * POST /api/chat — direct completion (no OpenCode, no tools)
     *
     * Request:
     *   { message, modelID?, providerID?, system?, maxTokens?, temperature?, history? }
     *
     * Response:
     *   { text, reasoning?, model, provider, tokens: { input, output }, latencyMs }
     */
    .post("/", async (c) => {
      const body = ChatBody.parse(await c.req.json())

      // Resolve which endpoint + model to use
      const { endpoint, modelApiId, modelName, providerName } = await resolveModel(
        body.modelID,
        body.providerID,
      )

      // Build messages array
      const messages: Array<{ role: string; content: string }> = []
      if (body.system) {
        messages.push({ role: "system", content: body.system })
      } else {
        messages.push({
          role: "system",
          content:
            "You are Artemis, a helpful AI coding assistant. Be concise and give direct answers. When asked about code, provide clean, working solutions.",
        })
      }
      if (body.history?.length) {
        for (const h of body.history) {
          messages.push({ role: h.role, content: h.content })
        }
      }
      messages.push({ role: "user", content: body.message })

      const maxTokens = body.maxTokens ?? 2048
      const temperature = body.temperature ?? 0.3

      const start = Date.now()

      // Call vLLM directly
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.VLLM_API_KEY}`,
        },
        body: JSON.stringify({
          model: modelApiId,
          messages,
          max_tokens: maxTokens,
          temperature,
        }),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => "")
        return c.json({ error: `vLLM error (${res.status})`, detail: errText.slice(0, 500) }, 502)
      }

      const data = (await res.json()) as any
      const latencyMs = Date.now() - start
      const choice = data.choices?.[0]

      // Extract text — some models put content in `reasoning_content` instead of `content`
      let text = choice?.message?.content ?? ""
      let reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? ""

      // If content is null/empty but reasoning has text, use reasoning as the response
      if (!text && reasoning) {
        text = reasoning
        reasoning = ""
      }

      const usage = data.usage ?? {}

      return c.json({
        text: text || "(no response)",
        reasoning: reasoning || undefined,
        model: modelName,
        provider: providerName,
        tokens: {
          input: usage.prompt_tokens ?? 0,
          output: usage.completion_tokens ?? 0,
        },
        latencyMs,
      })
    })

    /**
     * POST /api/chat/stream — streaming direct completion (SSE)
     */
    .post("/stream", async (c) => {
      const body = ChatBody.parse(await c.req.json())

      const { endpoint, modelApiId } = await resolveModel(body.modelID, body.providerID)

      const messages: Array<{ role: string; content: string }> = []
      if (body.system) {
        messages.push({ role: "system", content: body.system })
      } else {
        messages.push({
          role: "system",
          content: "You are Artemis, a helpful AI coding assistant. Be concise.",
        })
      }
      if (body.history?.length) {
        for (const h of body.history) messages.push({ role: h.role, content: h.content })
      }
      messages.push({ role: "user", content: body.message })

      const res = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.VLLM_API_KEY}`,
        },
        body: JSON.stringify({
          model: modelApiId,
          messages,
          max_tokens: body.maxTokens ?? 2048,
          temperature: body.temperature ?? 0.3,
          stream: true,
        }),
      })

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "")
        return c.json({ error: `vLLM stream error (${res.status})`, detail: errText.slice(0, 500) }, 502)
      }

      return new Response(res.body, {
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        },
      })
    })

    /**
     * GET /api/chat/models — list models available for direct chat
     */
    .get("/models", async (c) => {
      const reg = await buildRegistry()
      const models: Array<{
        id: string
        name: string
        provider: string
        providerName: string
        source: "local" | "cloud"
        contextLimit: number
        outputLimit: number
      }> = []

      for (const p of reg.local) {
        if (p.status !== "online") continue
        for (const m of p.models) {
          models.push({
            id: m.id,
            name: m.name,
            provider: p.id,
            providerName: p.name,
            source: "local",
            contextLimit: m.contextLimit,
            outputLimit: m.outputLimit,
          })
        }
      }

      for (const p of reg.cloud) {
        if (!p.configured) continue
        for (const m of p.models) {
          models.push({
            id: m.id,
            name: m.name,
            provider: p.id,
            providerName: p.name,
            source: "cloud",
            contextLimit: m.contextLimit,
            outputLimit: m.outputLimit,
          })
        }
      }

      return c.json({ models, activeModel: reg.activeModel })
    })
}

// ── Helpers ──────────────────────────────────────────────────────────

async function resolveModel(
  modelID?: string,
  providerID?: string,
): Promise<{ endpoint: string; modelApiId: string; modelName: string; providerName: string }> {
  const reg = await buildRegistry()

  // If no model specified, use the primary local vLLM
  if (!modelID) {
    const primary = reg.local.find((p) => p.isPrimary && p.status === "online")
    if (primary && primary.models.length > 0) {
      const m = primary.models[0]!
      return {
        endpoint: primary.endpoint,
        modelApiId: m.id,
        modelName: m.name,
        providerName: primary.name,
      }
    }
    // Fallback: any online local provider
    for (const p of reg.local) {
      if (p.status === "online" && p.models.length > 0) {
        const m = p.models[0]!
        return {
          endpoint: p.endpoint,
          modelApiId: m.id,
          modelName: m.name,
          providerName: p.name,
        }
      }
    }
    throw new Error("No online vLLM provider found. Check that vLLM is running.")
  }

  // Specific model requested: look up in local providers
  for (const p of reg.local) {
    if (providerID && p.id !== providerID) continue
    for (const m of p.models) {
      if (m.id === modelID || m.name === modelID) {
        return {
          endpoint: p.endpoint,
          modelApiId: m.id,
          modelName: m.name,
          providerName: p.name,
        }
      }
    }
  }

  // Look in cloud providers (would need the provider's API URL)
  for (const p of reg.cloud) {
    if (!p.configured) continue
    if (providerID && p.id !== providerID) continue
    for (const m of p.models) {
      if (m.id === modelID || m.name === modelID) {
        return {
          endpoint: p.apiUrl,
          modelApiId: m.id,
          modelName: m.name,
          providerName: p.name,
        }
      }
    }
  }

  throw new Error(`Model "${modelID}" not found in registry`)
}
