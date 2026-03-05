// ---------------------------------------------------------------------------
// Chat routes — /api/chat
// Full AI coding agent with tool-calling.
// Talks to vLLM endpoints with tools enabled. When the model makes tool
// calls, we execute them and loop results back. Falls back to direct
// (no-tool) mode for models that don't support function calling.
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import { env } from "../../config/env"
import { buildRegistry } from "../../services/provider-registry"
import { defaultPolicyEngine } from "../../services/policy-engine"
import { executeTool, getToolDefinitions } from "../../services/tool-executor"

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
  tools: z.boolean().optional(),           // enable tool calling (default: true)
  maxToolRounds: z.number().min(0).max(20).optional(),
})

const DEFAULT_SYSTEM = `You are Artemis, an expert AI coding assistant with access to tools.
Use tools to help the user: execute commands, read/write files, search code, and fetch URLs.
Be concise and give direct answers. Prefer using tools over guessing.
When making file edits, always read the file first to understand its content.
After running commands, report results clearly.`

const DIRECT_SYSTEM = `You are Artemis, a helpful AI coding assistant. Be concise and give direct answers. When asked about code, provide clean, working solutions.`

const MAX_TOOL_ROUNDS = 15

export function chatRoutes() {
  return new Hono()

    /**
     * POST /api/chat — AI coding agent with tool support
     *
     * Request:
     *   { message, modelID?, providerID?, system?, maxTokens?, temperature?,
     *     history?, tools?(=true), maxToolRounds?(=15) }
     *
     * Response:
     *   { text, reasoning?, model, provider, tokens, latencyMs, toolCalls? }
     */
    .post("/", async (c) => {
      const body = ChatBody.parse(await c.req.json())

      // ── Policy pre-flight check ──────────────────────────────────
      try {
        const policyResult = defaultPolicyEngine.evaluate({
          command: body.message,
          filePath: undefined,
        })
        if (policyResult.decision === "deny") {
          return c.json({
            error: "Policy violation",
            reasons: policyResult.reasons,
            riskScore: policyResult.riskAssessment?.score,
          }, 403)
        }
        if (policyResult.decision === "ask" && policyResult.reasons.length > 0) {
          c.header("X-Policy-Warnings", policyResult.reasons.join("; "))
        }
      } catch {
        // Policy engine error — allow through (fail-open for chat)
      }

      const resolved = await resolveModel(body.modelID, body.providerID)
      const { endpoint, modelApiId, modelName, providerName, apiKey } = resolved

      // Build initial messages
      const useTools = body.tools !== false
      const messages: Array<Record<string, any>> = []
      messages.push({
        role: "system",
        content: body.system ?? (useTools ? DEFAULT_SYSTEM : DIRECT_SYSTEM),
      })
      if (body.history?.length) {
        for (const h of body.history) messages.push({ role: h.role, content: h.content })
      }
      messages.push({ role: "user", content: body.message })

      const maxTokens = body.maxTokens ?? 4096
      const temperature = body.temperature ?? 0.3
      const maxRounds = body.maxToolRounds ?? MAX_TOOL_ROUNDS

      const start = Date.now()
      let totalInput = 0
      let totalOutput = 0
      const toolLog: Array<{ tool: string; args: Record<string, any>; result: string; success: boolean }> = []

      // ── Agentic loop: call model → execute tools → feed back ──
      for (let round = 0; round <= maxRounds; round++) {
        const reqBody: Record<string, any> = {
          model: modelApiId,
          messages,
          max_tokens: maxTokens,
          temperature,
        }

        // Include tools unless disabled or final round
        if (useTools && round < maxRounds) {
          reqBody.tools = getToolDefinitions()
          reqBody.tool_choice = "auto"
        }

        const res = await fetch(`${endpoint}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(reqBody),
        })

        if (!res.ok) {
          // If tool calling fails (model doesn't support it), retry without tools
          if (useTools && round === 0 && res.status === 400) {
            const errText = await res.text().catch(() => "")
            if (errText.includes("tool") || errText.includes("function") || errText.includes("not supported")) {
              delete reqBody.tools
              delete reqBody.tool_choice
              const retryRes = await fetch(`${endpoint}/chat/completions`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify(reqBody),
              })
              if (retryRes.ok) {
                const data = (await retryRes.json()) as any
                return formatFinalResponse(c, data, Date.now() - start, modelName, providerName, totalInput, totalOutput, toolLog)
              }
            }
          }
          const errText = await res.text().catch(() => "")
          return c.json({ error: `${providerName} error (${res.status})`, detail: errText.slice(0, 500) }, 502)
        }

        const data = (await res.json()) as any
        const usage = data.usage ?? {}
        totalInput += usage.prompt_tokens ?? 0
        totalOutput += usage.completion_tokens ?? 0

        const choice = data.choices?.[0]
        if (!choice) return c.json({ error: "No response from model" }, 502)

        const msg = choice.message

        // ── Check for tool calls ────────────────────────────────
        if (msg.tool_calls && msg.tool_calls.length > 0 && useTools) {
          messages.push(msg)

          for (const tc of msg.tool_calls) {
            const toolName = tc.function?.name ?? "unknown"
            let toolArgs: Record<string, any> = {}
            try {
              toolArgs = typeof tc.function?.arguments === "string"
                ? JSON.parse(tc.function.arguments)
                : tc.function?.arguments ?? {}
            } catch { toolArgs = { _raw: tc.function?.arguments } }

            const result = await executeTool(toolName, toolArgs)
            toolLog.push({
              tool: toolName,
              args: toolArgs,
              result: result.output.slice(0, 2000),
              success: result.success,
            })

            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: result.output,
            })
          }
          continue  // next round — model gets tool results
        }

        // ── No tool calls — final response ──────────────────────
        return formatFinalResponse(c, data, Date.now() - start, modelName, providerName, totalInput, totalOutput, toolLog)
      }

      // ── Max rounds exceeded ───────────────────────────────────
      return c.json({
        text: "(Reached maximum tool-call rounds. The model may need more iterations.)",
        model: modelName,
        provider: providerName,
        tokens: { input: totalInput, output: totalOutput },
        latencyMs: Date.now() - start,
        toolCalls: toolLog,
        warning: `Reached ${maxRounds} tool rounds limit`,
      })
    })

    /**
     * POST /api/chat/stream — streaming chat (no tool calling)
     */
    .post("/stream", async (c) => {
      const body = ChatBody.parse(await c.req.json())
      const { endpoint, modelApiId, apiKey } = await resolveModel(body.modelID, body.providerID)

      const messages: Array<{ role: string; content: string }> = []
      messages.push({ role: "system", content: body.system ?? DIRECT_SYSTEM })
      if (body.history?.length) {
        for (const h of body.history) messages.push({ role: h.role, content: h.content })
      }
      messages.push({ role: "user", content: body.message })

      const res = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
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
        return c.json({ error: `Stream error (${res.status})`, detail: errText.slice(0, 500) }, 502)
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
     * POST /api/chat/direct — simple completion WITHOUT tools (fast path)
     * For quick questions that don't need file/shell access.
     */
    .post("/direct", async (c) => {
      const body = ChatBody.parse(await c.req.json())
      const resolved = await resolveModel(body.modelID, body.providerID)
      const { endpoint, modelApiId, modelName, providerName, apiKey } = resolved

      const messages: Array<{ role: string; content: string }> = []
      messages.push({ role: "system", content: body.system ?? DIRECT_SYSTEM })
      if (body.history?.length) {
        for (const h of body.history) messages.push({ role: h.role, content: h.content })
      }
      messages.push({ role: "user", content: body.message })

      const start = Date.now()
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: modelApiId,
          messages,
          max_tokens: body.maxTokens ?? 2048,
          temperature: body.temperature ?? 0.3,
        }),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => "")
        return c.json({ error: `${providerName} error (${res.status})`, detail: errText.slice(0, 500) }, 502)
      }
      const data = (await res.json()) as any
      return formatFinalResponse(c, data, Date.now() - start, modelName, providerName, 0, 0, [])
    })

    /**
     * GET /api/chat/models — list models available for chat
     */
    .get("/models", async (c) => {
      const reg = await buildRegistry()
      const models: Array<{
        id: string; name: string; provider: string; providerName: string
        source: "local" | "cloud"; contextLimit: number; outputLimit: number
      }> = []

      for (const p of reg.local) {
        if (p.status !== "online") continue
        for (const m of p.models) {
          models.push({
            id: m.id, name: m.name, provider: p.id, providerName: p.name,
            source: "local", contextLimit: m.contextLimit, outputLimit: m.outputLimit,
          })
        }
      }
      for (const p of reg.cloud) {
        if (!p.configured) continue
        for (const m of p.models) {
          models.push({
            id: m.id, name: m.name, provider: p.id, providerName: p.name,
            source: "cloud", contextLimit: m.contextLimit, outputLimit: m.outputLimit,
          })
        }
      }
      return c.json({ models, activeModel: reg.activeModel })
    })

    /**
     * GET /api/chat/tools — list available tools
     */
    .get("/tools", async (c) => {
      return c.json({
        tools: getToolDefinitions().map((t) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      })
    })
}

// ── Response formatter ───────────────────────────────────────────────

function formatFinalResponse(
  c: any,
  data: any,
  latencyMs: number,
  modelName: string,
  providerName: string,
  extraInput: number,
  extraOutput: number,
  toolLog: Array<{ tool: string; args: Record<string, any>; result: string; success: boolean }>,
) {
  const choice = data.choices?.[0]
  let text = choice?.message?.content ?? ""
  let reasoning = choice?.message?.reasoning_content ?? choice?.message?.reasoning ?? ""

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
      input: (usage.prompt_tokens ?? 0) + extraInput,
      output: (usage.completion_tokens ?? 0) + extraOutput,
    },
    latencyMs,
    toolCalls: toolLog.length > 0 ? toolLog : undefined,
  })
}

// ── Helpers ──────────────────────────────────────────────────────────

async function resolveModel(
  modelID?: string,
  providerID?: string,
): Promise<{
  endpoint: string
  modelApiId: string
  modelName: string
  providerName: string
  source: "local" | "cloud"
  apiKey: string
  cloudProviderId?: string
}> {
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
        source: "local",
        apiKey: env.VLLM_API_KEY ?? "",
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
          source: "local",
          apiKey: env.VLLM_API_KEY ?? "",
        }
      }
    }
    throw Object.assign(new Error("No online vLLM provider found. Check that vLLM is running."), { status: 503 })
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
          source: "local",
          apiKey: env.VLLM_API_KEY ?? "",
        }
      }
    }
  }

  // Look in cloud providers — only OpenAI-compatible ones (OpenAI, Groq, Together, Fireworks, Mistral, DeepSeek)
  const OPENAI_COMPATIBLE = new Set(["openai", "groq", "together", "fireworks", "mistral", "deepseek"])
  for (const p of reg.cloud) {
    if (!p.configured) continue
    if (providerID && p.id !== providerID) continue
    if (!OPENAI_COMPATIBLE.has(p.id)) continue   // Anthropic/Google use different APIs
    for (const m of p.models) {
      if (m.id === modelID || m.name === modelID) {
        return {
          endpoint: p.apiUrl,
          modelApiId: m.id,
          modelName: m.name,
          providerName: p.name,
          source: "cloud",
          apiKey: process.env[p.keyEnvVar] ?? "",
          cloudProviderId: p.id,
        }
      }
    }
  }

  throw Object.assign(new Error(`Model "${modelID}" not found in registry (note: Anthropic & Google require their native SDKs)`), { status: 404 })
}
