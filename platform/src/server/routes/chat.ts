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
  maxTokens: z.number().min(1).max(32768).optional(),
  temperature: z.number().min(0).max(2).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .optional(),
  tools: z.boolean().optional(),           // enable tool calling (default: true)
  maxToolRounds: z.number().min(0).max(20).optional(),
  timeoutMs: z.number().min(5000).max(600000).optional(), // per-round fetch timeout
  workspaceRoot: z.string().optional(),    // VS Code workspace folder path
})

// Per-round timeout for model inference calls (not total request timeout).
// Reasoning models (MiniMax) can take 60-180s per call; allow 5 min to be safe.
const DEFAULT_INFERENCE_TIMEOUT_MS = 300_000  // 5 min per inference call

const DEFAULT_SYSTEM = `You are Thirdwave AI, an expert AI coding assistant with access to tools.
Use tools to help the user: execute commands, read/write files, search code, and fetch URLs.
Be concise and give direct answers. Prefer using tools over guessing.
When making file edits, always read the file first to understand its content.
After running commands, report results clearly.

QUALITY RULES — follow these strictly:
- Before suggesting commands, verify the current directory and file paths exist using tools.
- Always use tools (bash, write_file) to actually create files and run commands — do NOT just show code blocks and tell the user to run them manually.
- When setting up projects, create ALL necessary files (requirements.txt, package.json, etc.) using write_file, then run install commands using bash.
- Check the OS and environment before suggesting platform-specific packages (e.g. windows-curses is Windows-only).
- If a command fails, diagnose the error and fix it yourself instead of telling the user to fix it.
- When creating Python projects, always create a proper package structure with __init__.py files.
- Test that your code actually works by running it after creating it.
- SECURITY: If a tool returns "SECURITY RESTRICTION" or "Access restricted", you MUST tell the user that access to the file/resource is restricted for security purposes. NEVER claim the file does not exist when access is denied.`

const DIRECT_SYSTEM = `You are Thirdwave AI, a friendly and helpful AI coding assistant. When greeted, respond warmly and briefly introduce yourself — mention you can help with coding tasks, file management, and development workflows. Keep greetings short and natural. Always provide complete, thorough answers. Never say "I will explain" or "I'll do" — instead, actually explain and do it immediately. When asked about code, provide full working solutions with explanations. When asked to analyze or fix code, show the complete corrected code and explain every change. Do not be lazy or skip details.`

// ── Text-based tool calling ──────────────────────────────────────────
// Many local models (MiniMax, LLaMA, Qwen, etc.) don't support native
// OpenAI function calling. This fallback embeds tool instructions in the
// system prompt and parses XML <tool_use> blocks from the model's text.
// This is the same pattern used by Cline, Continue, Aider, and other
// coding agents to achieve reliable tool use with any model.

const TOOL_USE_INSTRUCTIONS = `
# Tool Usage

You have access to tools for executing code, reading/writing files, searching, and more.
To use a tool, you MUST include the following XML block in your response:

<tool_use>
<name>TOOL_NAME</name>
<input>
{"param1": "value1", "param2": "value2"}
</input>
</tool_use>

## Available Tools

### bash
Execute a shell command. Commands run in the project workspace directory.
Parameters: {"command": "the shell command to run"}

### write_file
Create or overwrite a file. Creates parent directories automatically. Use RELATIVE paths from the project root.
Parameters: {"path": "relative/path/to/file.py", "content": "full file content here"}

### read_file
Read file contents. Use RELATIVE paths.
Parameters: {"path": "relative/path/to/file.py"}
Optional: {"startLine": 1, "endLine": 50}

### list_dir
List directory contents. Sorted (directories first, then files). Filters out noise dirs (node_modules, .git, etc.).
Parameters: {"path": "."}
Optional: {"recursive": true, "depth": 3}

### grep_search
Search files for a pattern (regex supported).
Parameters: {"pattern": "search term", "path": ".", "include": "*.py"}

### web_fetch
Fetch content from a URL.
Parameters: {"url": "https://example.com"}

### git_status
Show git branch and modified files.
Parameters: {}

### git_diff
Show git diff.
Parameters: {"staged": false, "file": "optional/path"}

### git_log
Show recent commits.
Parameters: {"count": 10}

## CRITICAL RULES
1. You MUST use write_file tool to actually create files. Do NOT just show file content as markdown code blocks. Actually create them with write_file.
2. You MUST use bash tool to run commands. Do NOT just describe what commands to run.
3. Use RELATIVE paths (e.g. "src/app.py") not absolute paths for write_file and read_file.
4. You can make multiple tool_use calls in one response. Each will be executed.
5. After your tools execute, you will receive the results and can continue with more tool calls or provide a summary.
6. Always create necessary directories by using write_file (it auto-creates parent dirs) or bash with mkdir.
`

/**
 * Parse text-based tool calls from model output.
 * Handles multiple formats models may produce:
 *   1. <tool_use><name>X</name><input>{"key":"val"}</input></tool_use>
 *   2. <tool_use><name>X</name><input><key>val</key></input></tool_use>
 *   3. <tool_use><name>X</name><parameter name="key">val</parameter></tool_use>
 *   4. <tool_use><name>X</name><key>val</key></tool_use>
 */
function parseTextToolCalls(text: string): Array<{ name: string; args: Record<string, any> }> {
  const calls: Array<{ name: string; args: Record<string, any> }> = []
  // Capture entire <tool_use> blocks
  const blockRegex = /<tool_use>([\s\S]*?)<\/tool_use>/g
  let blockMatch
  while ((blockMatch = blockRegex.exec(text)) !== null) {
    const block = blockMatch[1]
    // Extract tool name
    const nameMatch = block.match(/<name>\s*([\s\S]*?)\s*<\/name>/)
    if (!nameMatch) continue
    const name = nameMatch[1].trim()

    // Extract everything after </name> as the params section
    const afterName = block.slice(block.indexOf("</name>") + 7).trim()
    let args: Record<string, any> = {}

    // Strategy 1: <input>{JSON}</input>
    const inputMatch = afterName.match(/<input>\s*([\s\S]*?)\s*<\/input>/)
    if (inputMatch) {
      const inputContent = inputMatch[1].trim()
      try {
        args = JSON.parse(inputContent)
      } catch {
        // Strategy 2: <input><key>val</key>...</input> (XML tags inside input)
        const tagRegex2 = /<(\w+)>([\s\S]*?)<\/\1>/g
        let tm
        while ((tm = tagRegex2.exec(inputContent)) !== null) {
          args[tm[1]] = tm[2]
        }
      }
    }

    // Strategy 3: <parameter name="key">val</parameter> (no input wrapper)
    if (Object.keys(args).length === 0) {
      const paramRegex = /<parameter\s+name=["'](\w+)["']>([\s\S]*?)<\/parameter>/g
      let pm
      while ((pm = paramRegex.exec(afterName)) !== null) {
        args[pm[1]] = pm[2]
      }
    }

    // Strategy 4: direct XML tags after </name> (no input wrapper)
    if (Object.keys(args).length === 0) {
      const tagRegex3 = /<(\w+)>([\s\S]*?)<\/\1>/g
      let tm3
      while ((tm3 = tagRegex3.exec(afterName)) !== null) {
        if (tm3[1] !== "input") args[tm3[1]] = tm3[2]
      }
    }

    if (Object.keys(args).length > 0) {
      calls.push({ name, args })
    } else {
      // Last resort: pass entire afterName as raw
      calls.push({ name, args: { _raw: afterName } })
    }
  }
  return calls
}

/**
 * Strip <tool_use> blocks from text to get the non-tool narrative parts.
 */
function stripToolBlocks(text: string): string {
  return text.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, "").trim()
}

const MAX_TOOL_ROUNDS = 15

// ── Provider adapters ────────────────────────────────────────────────
// Providers that aren't OpenAI-compatible need request/response translation.

const OPENAI_COMPATIBLE = new Set(["openai", "groq", "together", "fireworks", "mistral", "deepseek", "openrouter"])

/**
 * Send a chat completion request, adapting to the provider's native API
 * format for Anthropic and Google. OpenAI-compatible providers use the
 * standard /chat/completions path as-is.
 */
async function providerFetch(
  endpoint: string,
  apiKey: string,
  cloudProviderId: string | undefined,
  body: Record<string, any>,
  timeoutMs: number = DEFAULT_INFERENCE_TIMEOUT_MS,
): Promise<Response> {
  const signal = AbortSignal.timeout(timeoutMs)

  // Default: OpenAI-compatible (local vLLM + 7 cloud providers)
  if (!cloudProviderId || OPENAI_COMPATIBLE.has(cloudProviderId)) {
    return fetch(`${endpoint}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    })
  }

  if (cloudProviderId === "anthropic") {
    return fetchAnthropic(endpoint, apiKey, body, signal)
  }

  if (cloudProviderId === "google") {
    return fetchGoogle(endpoint, apiKey, body, signal)
  }

  // Unknown provider — try OpenAI format as fallback
  return fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal,
  })
}

/** Anthropic Messages API adapter → returns an OpenAI-shaped Response */
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
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(anthropicBody),
    signal,
  })

  if (!res.ok) return res

  const data = await res.json() as any
  // Translate Anthropic response → OpenAI format
  const text = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
  const openaiData = {
    choices: [{ message: { role: "assistant", content: text }, finish_reason: data.stop_reason ?? "stop" }],
    usage: {
      prompt_tokens: data.usage?.input_tokens ?? 0,
      completion_tokens: data.usage?.output_tokens ?? 0,
    },
  }
  return new Response(JSON.stringify(openaiData), { status: 200, headers: { "Content-Type": "application/json" } })
}

/** Google Gemini API adapter → returns an OpenAI-shaped Response */
async function fetchGoogle(endpoint: string, apiKey: string, body: Record<string, any>, signal?: AbortSignal): Promise<Response> {
  const messages = (body.messages ?? []) as Array<{ role: string; content: string }>
  const systemMsg = messages.find(m => m.role === "system")?.content
  const nonSystem = messages.filter(m => m.role !== "system")

  const contents = nonSystem.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content ?? "" }],
  }))

  const geminiBody: Record<string, any> = { contents }
  if (systemMsg) {
    geminiBody.systemInstruction = { parts: [{ text: systemMsg }] }
  }
  geminiBody.generationConfig = {
    maxOutputTokens: body.max_tokens ?? 4096,
    temperature: body.temperature,
  }

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
    usage: {
      prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    },
  }
  return new Response(JSON.stringify(openaiData), { status: 200, headers: { "Content-Type": "application/json" } })
}

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
      } catch (policyErr) {
        // Policy engine error — allow through (fail-open for chat) but log it
        console.warn("[chat] Policy engine error:", policyErr)
      }

      const resolved = await resolveModel(body.modelID, body.providerID)
      let { endpoint, modelApiId, modelName, providerName, apiKey, cloudProviderId } = resolved
      // Preserve the original model the user selected — even after 429 fallback
      const originalModelName = modelName

      // Build initial messages
      const useTools = body.tools !== false
      const messages: Array<Record<string, any>> = []

      // Build system prompt: base instructions + tool use format (for text-based fallback)
      let systemContent = body.system ?? (useTools ? DEFAULT_SYSTEM : DIRECT_SYSTEM)
      if (useTools) {
        // Always prepend tool usage instructions so models that can't use native
        // function calling know how to invoke tools via XML text blocks.
        systemContent = TOOL_USE_INSTRUCTIONS + "\n\n" + systemContent
      }
      messages.push({ role: "system", content: systemContent })
      if (body.history?.length) {
        for (const h of body.history) messages.push({ role: h.role, content: h.content })
      }
      messages.push({ role: "user", content: body.message })

      // Clamp max_tokens to respect model limits and prevent OOM
      const modelOutputLimit = resolved.outputLimit ?? 4096
      const modelContextLimit = resolved.contextLimit ?? 32768
      const requestedMaxTokens = body.maxTokens ?? 8192
      // Leave headroom for input tokens (rough estimate: 4 chars ≈ 1 token)
      const estimatedInputTokens = Math.ceil(
        messages.reduce((acc, m) => acc + (typeof m.content === "string" ? m.content.length : 0), 0) / 4
      )
      const safeOutputLimit = Math.min(
        requestedMaxTokens,
        modelOutputLimit,
        Math.max(512, modelContextLimit - estimatedInputTokens - 256), // leave 256 buffer
      )
      const maxTokens = safeOutputLimit
      const temperature = body.temperature ?? 0.3
      const maxRounds = body.maxToolRounds ?? MAX_TOOL_ROUNDS
      const inferenceTimeout = body.timeoutMs ?? DEFAULT_INFERENCE_TIMEOUT_MS

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

        // Do NOT send native JSON tool definitions — many local/gateway
        // models (MiniMax, etc.) choke on them and return empty content.
        // Tool calling is handled entirely via text-based XML <tool_use>
        // blocks in TOOL_USE_INSTRUCTIONS (embedded in the system prompt).

        let res: Response
        try {
          res = await providerFetch(endpoint, apiKey, cloudProviderId, reqBody, inferenceTimeout)
        } catch (fetchErr: any) {
          // AbortSignal.timeout throws TimeoutError
          if (fetchErr?.name === "TimeoutError" || fetchErr?.name === "AbortError") {
            return c.json({
              error: "Model inference timed out",
              detail: `The model took longer than ${Math.round(inferenceTimeout / 1000)}s to respond. Try a simpler prompt or disable tool-calling.`,
              model: modelName,
              provider: providerName,
              latencyMs: Date.now() - start,
            }, 504)
          }
          throw fetchErr
        }

        if (!res.ok) {
          // Rate-limited — try falling back to another gateway model before failing
          if (res.status === 429) {
            const errText = await res.text().catch(() => "")
            const retryAfter = res.headers.get("retry-after")
            let detail = errText.slice(0, 300)
            try { const j = JSON.parse(errText); if (j.detail) detail = j.detail } catch {}

            // Attempt fallback: try all online gateway models until one succeeds
            const fallbacks = await findFallbackModels(modelApiId)
            let fallbackSucceeded = false
            for (const fb of fallbacks) {
              console.log(`[chat] 429 on ${modelApiId} — trying fallback ${fb.modelApiId}`)
              const fbOutputLimit = fb.outputLimit ?? 4096
              const fbContextLimit = fb.contextLimit ?? 32768
              const fbReqBody = {
                ...reqBody,
                model: fb.modelApiId,
                max_tokens: Math.min(
                  requestedMaxTokens,
                  fbOutputLimit,
                  Math.max(512, fbContextLimit - estimatedInputTokens - 256),
                ),
              }
              try {
                const fbRes = await providerFetch(fb.endpoint, fb.apiKey, cloudProviderId, fbReqBody, inferenceTimeout)
                if (fbRes.ok) {
                  // Fallback succeeded — update references and continue
                  endpoint = fb.endpoint
                  modelApiId = fb.modelApiId
                  modelName = fb.modelName
                  providerName = fb.providerName
                  apiKey = fb.apiKey
                  res = fbRes
                  fallbackSucceeded = true
                  console.log(`[chat] Fallback to ${fb.modelApiId} succeeded`)
                  break
                }
                // This fallback failed (403/429/etc.) — try next
                console.log(`[chat] Fallback ${fb.modelApiId} failed (${fbRes.status}), trying next...`)
                await fbRes.text().catch(() => {}) // drain body
              } catch (fbErr) {
                console.log(`[chat] Fallback ${fb.modelApiId} threw error, trying next...`)
              }
            }
            if (!fallbackSucceeded) {
              return c.json({ error: "Rate limited by model provider", detail, retryAfterSeconds: retryAfter ? Number(retryAfter) : 30, triedFallbacks: fallbacks.map(f => f.modelApiId) }, 429)
            }
          }
          // Forbidden — model restricted for this API key (gateway ACL)
          if (res.status === 403) {
            const errText = await res.text().catch(() => "")
            let detail = errText.slice(0, 300)
            try { const j = JSON.parse(errText); if (j.detail) detail = j.detail } catch {}
            return c.json({ error: `Model access denied: ${detail}`, detail, model: modelName, provider: providerName }, 403)
          }
          // Gateway/provider temporarily unavailable — retry once after 2s
          if ((res.status === 502 || res.status === 503) && round === 0) {
            await new Promise(r => setTimeout(r, 2000))
            try {
              const retryRes = await providerFetch(endpoint, apiKey, cloudProviderId, reqBody, inferenceTimeout)
              if (retryRes.ok) {
                const data = (await retryRes.json()) as any
                return formatFinalResponse(c, data, Date.now() - start, originalModelName, providerName, totalInput, totalOutput, toolLog)
              }
              const retryErrText = await retryRes.text().catch(() => "")
              let retryDetail = retryErrText.slice(0, 500)
              try { const j = JSON.parse(retryErrText); if (j.detail) retryDetail = j.detail } catch {}
              return c.json({ error: `${providerName} unavailable (${retryRes.status}) after retry`, detail: retryDetail }, 503)
            } catch {}
          }
          if (!res.ok) {
            const errText = await res.text().catch(() => "")
            let detail = errText.slice(0, 500)
            try { const j = JSON.parse(errText); if (j.detail) detail = j.detail } catch {}
            return c.json({ error: `${providerName} error (${res.status})`, detail }, 502)
          }
        }

        const data = (await res.json()) as any
        const usage = data.usage ?? {}
        totalInput += usage.prompt_tokens ?? 0
        totalOutput += usage.completion_tokens ?? 0

        const choice = data.choices?.[0]
        if (!choice) return c.json({ error: "No response from model" }, 502)

        const msg = choice.message

        // Log round info for debugging
        console.log(`[chat] Round ${round}: ${(msg.content ?? "").length} chars, ${msg.tool_calls?.length ?? 0} native calls, finish=${choice.finish_reason}`)

        // ── Handle empty response from model ────────────────────
        // Some models (e.g. gpt-oss-120b) occasionally return empty content.
        // Nudge them to use tools instead of returning "(no response)".
        if (useTools && !msg.content && (!msg.tool_calls || msg.tool_calls.length === 0)) {
          if (round < 2) {
            console.log(`[chat] Round ${round}: Empty response from ${modelApiId}, nudging model to use tools`)
            messages.push({
              role: "user",
              content: "Your response was empty. You MUST respond by using the available tools. Include <tool_use> XML blocks in your reply. For example, to run a command: <tool_use><name>bash</name><input>{\"command\": \"echo hello\"}</input></tool_use>",
            })
            continue // retry round
          }
          console.log(`[chat] Round ${round}: Model ${modelApiId} keeps returning empty — giving up`)
        }

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

            const result = await executeTool(toolName, toolArgs, body.workspaceRoot)
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

        // ── Text-based tool call fallback ───────────────────────
        // If the model didn't use native function calling but included
        // <tool_use> XML blocks in its text, parse and execute them.
        if (useTools && msg.content) {
          const textToolCalls = parseTextToolCalls(msg.content)
          if (textToolCalls.length > 0) {
            // Add assistant message to history
            messages.push({ role: "assistant", content: msg.content })

            // Execute each text-based tool call
            let toolResultsText = "Tool execution results:\n"
            for (const tc of textToolCalls) {
              const result = await executeTool(tc.name, tc.args, body.workspaceRoot)
              toolLog.push({
                tool: tc.name,
                args: tc.args,
                result: result.output.slice(0, 2000),
                success: result.success,
              })
              toolResultsText += `\n<tool_result>\n<name>${tc.name}</name>\n<status>${result.success ? "success" : "error"}</status>\n<output>\n${result.output.slice(0, 3000)}\n</output>\n</tool_result>\n`
            }

            // Feed results back as a user message (since text-based tools
            // don't have tool_call_id, we use user role for the results)
            toolResultsText += "\nContinue with any remaining steps, or provide a summary of what was done."
            messages.push({ role: "user", content: toolResultsText })
            continue  // next round — model gets tool results
          }
        }

        // ── Nudge: model replied with text but no tools on early rounds ─
        // Some models (gpt-oss-120b, etc.) occasionally hallucinate answers
        // instead of using <tool_use> XML blocks. Give them one retry.
        if (useTools && round === 0 && msg.content && toolLog.length === 0) {
          console.log(`[chat] Round 0: Model responded without tools, nudging to use <tool_use>`)
          messages.push({ role: "assistant", content: msg.content })
          messages.push({
            role: "user",
            content: "IMPORTANT: You MUST actually use tools to complete this task. Include <tool_use><name>TOOL</name><input>{JSON}</input></tool_use> blocks in your response. Do NOT fabricate file contents or command output. Use the appropriate tool to get real results.",
          })
          continue
        }

        // ── No tool calls — final response ──────────────────────
        return formatFinalResponse(c, data, Date.now() - start, originalModelName, providerName, totalInput, totalOutput, toolLog)
      }

      // ── Max rounds exceeded ───────────────────────────────────
      return c.json({
        text: "(Reached maximum tool-call rounds. The model may need more iterations.)",
        model: originalModelName,
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

      // Policy pre-flight (same as main /api/chat)
      try {
        const policyResult = defaultPolicyEngine.evaluate({ command: body.message, filePath: undefined })
        if (policyResult.decision === "deny") {
          return c.json({ error: "Policy violation", reasons: policyResult.reasons }, 403)
        }
      } catch {}

      const resolved = await resolveModel(body.modelID, body.providerID)
      const { endpoint, modelApiId, apiKey, cloudProviderId } = resolved

      const messages: Array<{ role: string; content: string }> = []
      messages.push({ role: "system", content: body.system ?? DIRECT_SYSTEM })
      if (body.history?.length) {
        for (const h of body.history) messages.push({ role: h.role, content: h.content })
      }
      messages.push({ role: "user", content: body.message })

      // Streaming uses direct fetch (only for OpenAI-compatible providers)
      const streamTimeout = body.timeoutMs ?? DEFAULT_INFERENCE_TIMEOUT_MS
      let res: Response
      try {
        res = await providerFetch(endpoint, apiKey, cloudProviderId, {
          model: modelApiId,
          messages,
          max_tokens: body.maxTokens ?? 4096,
          temperature: body.temperature ?? 0.3,
          stream: !cloudProviderId || OPENAI_COMPATIBLE.has(cloudProviderId),
        }, streamTimeout)
      } catch (err: any) {
        if (err?.name === "TimeoutError" || err?.name === "AbortError") {
          return c.json({ error: "Stream timed out", detail: `Model did not start responding within ${Math.round(streamTimeout / 1000)}s` }, 504)
        }
        throw err
      }

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "")
        let detail = errText.slice(0, 500)
        try { const j = JSON.parse(errText); if (j.detail) detail = j.detail } catch {}
        if (res.status === 429) {
          const retryAfter = res.headers.get("retry-after")
          return c.json({ error: "Rate limited by model provider", detail, retryAfterSeconds: retryAfter ? Number(retryAfter) : 30 }, 429)
        }
        if (res.status === 403) {
          return c.json({ error: `Model access denied: ${detail}`, detail }, 403)
        }
        return c.json({ error: `Stream error (${res.status})`, detail }, 502)
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

      // Policy pre-flight (same as main /api/chat)
      try {
        const policyResult = defaultPolicyEngine.evaluate({ command: body.message, filePath: undefined })
        if (policyResult.decision === "deny") {
          return c.json({ error: "Policy violation", reasons: policyResult.reasons }, 403)
        }
      } catch {}

      const resolved = await resolveModel(body.modelID, body.providerID)
      const { endpoint, modelApiId, modelName, providerName, apiKey, cloudProviderId } = resolved

      const messages: Array<{ role: string; content: string }> = []
      messages.push({ role: "system", content: body.system ?? DIRECT_SYSTEM })
      if (body.history?.length) {
        for (const h of body.history) messages.push({ role: h.role, content: h.content })
      }
      messages.push({ role: "user", content: body.message })

      const start = Date.now()
      const directTimeout = body.timeoutMs ?? DEFAULT_INFERENCE_TIMEOUT_MS
      let res: Response
      try {
        res = await providerFetch(endpoint, apiKey, cloudProviderId, {
          model: modelApiId,
          messages,
          max_tokens: body.maxTokens ?? 8192,
          temperature: body.temperature ?? 0.3,
        }, directTimeout)
      } catch (err: any) {
        if (err?.name === "TimeoutError" || err?.name === "AbortError") {
          return c.json({ error: "Model inference timed out", detail: `Took longer than ${Math.round(directTimeout / 1000)}s`, model: modelName, provider: providerName, latencyMs: Date.now() - start }, 504)
        }
        throw err
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => "")
        let detail = errText.slice(0, 500)
        try { const j = JSON.parse(errText); if (j.detail) detail = j.detail } catch {}
        if (res.status === 429) {
          const retryAfter = res.headers.get("retry-after")
          return c.json({ error: "Rate limited by model provider", detail, retryAfterSeconds: retryAfter ? Number(retryAfter) : 30 }, 429)
        }
        if (res.status === 403) {
          return c.json({ error: `Model access denied: ${detail}`, detail, model: modelName, provider: providerName }, 403)
        }
        // Retry once on 502/503
        if (res.status === 502 || res.status === 503) {
          await new Promise(r => setTimeout(r, 2000))
          try {
            const retryRes = await providerFetch(endpoint, apiKey, cloudProviderId, {
              model: modelApiId,
              messages,
              max_tokens: body.maxTokens ?? 8192,
              temperature: body.temperature ?? 0.3,
            }, directTimeout)
            if (retryRes.ok) {
              const retryData = (await retryRes.json()) as any
              return formatFinalResponse(c, retryData, Date.now() - start, modelName, providerName, 0, 0, [])
            }
            const retryErr = await retryRes.text().catch(() => "")
            let retryDetail = retryErr.slice(0, 500)
            try { const j = JSON.parse(retryErr); if (j.detail) retryDetail = j.detail } catch {}
            return c.json({ error: `${providerName} unavailable (${retryRes.status}) after retry`, detail: retryDetail }, 503)
          } catch {}
        }
        return c.json({ error: `${providerName} error (${res.status})`, detail }, 502)
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
        isCloud?: boolean; originLabel?: string; cloudProviderName?: string
      }> = []

      for (const p of reg.local) {
        if (p.status !== "online") continue
        for (const m of p.models) {
          models.push({
            id: m.id, name: m.name, provider: p.id, providerName: p.name,
            source: m.isCloud ? "cloud" : "local", contextLimit: m.contextLimit, outputLimit: m.outputLimit,
            isCloud: m.isCloud, originLabel: m.originLabel, cloudProviderName: m.cloudProviderName,
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

  // Strip any leftover <tool_use> blocks from the final response text
  text = stripToolBlocks(text)

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

/**
 * Find fallback gateway models when the current one is rate-limited (429).
 * Returns ALL candidates sorted by preference (cloud proxies first).
 * Skips image-generation models that can't do chat.
 */
const IMAGE_MODEL_RE = /dall-e|stable-diffusion|midjourney|imagen/i
async function findFallbackModels(
  currentModelId: string,
  skipIds: Set<string> = new Set(),
): Promise<Array<{
  endpoint: string; modelApiId: string; modelName: string; providerName: string
  apiKey: string; contextLimit?: number; outputLimit?: number
}>> {
  const reg = await buildRegistry()
  const gwEndpoint = env.VLLM_GATEWAY_URL ?? ""
  const gwKey = env.VLLM_GATEWAY_KEY ?? ""

  type Candidate = {
    endpoint: string; apiKey: string; modelApiId: string; modelName: string
    providerName: string; contextLimit?: number; outputLimit?: number; isCloud: boolean
  }
  const candidates: Candidate[] = []

  for (const p of reg.local) {
    if (p.status !== "online") continue
    for (const m of p.models) {
      if (m.id === currentModelId || skipIds.has(m.id)) continue
      if (IMAGE_MODEL_RE.test(m.id) || IMAGE_MODEL_RE.test(m.name)) continue
      candidates.push({
        endpoint: gwEndpoint || p.endpoint,
        apiKey: gwKey || "",
        modelApiId: m.id,
        modelName: m.name,
        providerName: p.name,
        contextLimit: m.contextLimit,
        outputLimit: m.outputLimit,
        isCloud: !!(m as any).isCloud,
      })
    }
  }

  // Prefer cloud-proxy models (gpt-3.5-turbo, gpt-4, etc.) — they're more reliable
  candidates.sort((a, b) => (b.isCloud ? 1 : 0) - (a.isCloud ? 1 : 0))

  return candidates
}

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
  contextLimit?: number
  outputLimit?: number
}> {
  const reg = await buildRegistry()

  // All local traffic routes through the gateway
  const gwEndpoint = env.VLLM_GATEWAY_URL ?? ""
  const gwKey      = env.VLLM_GATEWAY_KEY ?? ""

  // Helper: resolve endpoint/apiKey for a local provider — always gateway
  function localEndpoint(_p: typeof reg.local[0]) {
    return {
      endpoint: gwEndpoint || _p.endpoint,
      apiKey: gwKey || "",
    }
  }

  // If no model specified, use the primary local vLLM
  if (!modelID) {
    const primary = reg.local.find((p) => p.isPrimary && p.status === "online")
    if (primary && primary.models.length > 0) {
      const m = primary.models[0]!
      const { endpoint, apiKey } = localEndpoint(primary)
      return {
        endpoint, apiKey,
        modelApiId: m.id,
        modelName: m.name,
        providerName: primary.name,
        source: "local",
        contextLimit: m.contextLimit,
        outputLimit: m.outputLimit,
      }
    }
    // Fallback: any online local provider
    for (const p of reg.local) {
      if (p.status === "online" && p.models.length > 0) {
        const m = p.models[0]!
        const { endpoint, apiKey } = localEndpoint(p)
        return {
          endpoint, apiKey,
          modelApiId: m.id,
          modelName: m.name,
          providerName: p.name,
          source: "local",
          contextLimit: m.contextLimit,
          outputLimit: m.outputLimit,
        }
      }
    }
    throw Object.assign(new Error("No online vLLM provider found. Check that vLLM is running."), { status: 503 })
  }

  // Specific model requested: look up in local providers (online only)
  for (const p of reg.local) {
    if (providerID && p.id !== providerID) continue
    if (p.status !== "online") continue
    for (const m of p.models) {
      if (m.id === modelID || m.name === modelID) {
        const { endpoint, apiKey } = localEndpoint(p)
        return {
          endpoint, apiKey,
          modelApiId: m.id,
          modelName: m.name,
          providerName: p.name,
          source: "local",
          contextLimit: m.contextLimit,
          outputLimit: m.outputLimit,
        }
      }
    }
  }

  // Look in cloud providers — all providers supported when API key is configured.
  // OpenAI-compatible providers use /chat/completions directly.
  // Anthropic and Google require adapter logic in the chat handler.
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
          source: "cloud",
          apiKey: process.env[p.keyEnvVar] ?? "",
          cloudProviderId: p.id,
          contextLimit: m.contextLimit,
          outputLimit: m.outputLimit,
        }
      }
    }
  }

  // Check if the model exists in an offline provider — give a clear error
  for (const p of reg.local) {
    if (p.status === "offline") {
      for (const m of p.models) {
        if (m.id === modelID || m.name === modelID) {
          throw Object.assign(new Error(`Model "${modelID}" is on gateway "${p.name}" which is currently offline. Please select a different model or wait for the gateway to come back online.`), { status: 503 })
        }
      }
    }
  }

  throw Object.assign(new Error(`Model "${modelID}" not found in registry or provider not configured`), { status: 404 })
}
