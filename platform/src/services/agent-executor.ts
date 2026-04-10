// ---------------------------------------------------------------------------
// Agent Executor — standalone agentic loop: prompt → LLM → tools → loop.
//
// This replaces the OpenCode dependency for all execution paths (queues,
// orchestrator, parallel executor). The same loop already powers /api/chat;
// this module packages it as a reusable service.
//
// Usage:
//   const executor = new AgentExecutor()
//   const result = await executor.run({ prompt: "Fix the bug in app.ts" })
//   // result.text, result.toolCalls, result.tokens, ...
// ---------------------------------------------------------------------------

import { executeTool } from "./tool-executor"
import {
  resolveModel,
  providerFetch,
  findFallbackModels,
  type ResolvedModel,
} from "./llm-client"

// ── Types ────────────────────────────────────────────────────────────

export interface AgentRunOptions {
  prompt: string
  modelID?: string
  providerID?: string
  system?: string              // override system prompt
  workspaceRoot?: string       // working directory for tools
  maxTokens?: number
  temperature?: number
  maxToolRounds?: number
  timeoutMs?: number           // per-round inference timeout
  agentID?: string             // logical agent role (for logging)
  context?: string             // prepended context (from dependencies)
}

export interface AgentResult {
  text: string
  reasoning?: string
  model: string
  provider: string
  tokens: { input: number; output: number }
  toolCalls: Array<{ tool: string; args: Record<string, any>; result: string; success: boolean }>
  latencyMs: number
  rounds: number
  error?: string
}

// ── System prompts ───────────────────────────────────────────────────

const DEFAULT_AGENT_SYSTEM = `You are Thirdwave AI, an expert AI coding assistant with access to tools.
You solve tasks by reasoning step-by-step, using tools to verify assumptions, and iterating until the task is fully complete.

REASONING PROTOCOL:
1. ANALYZE: Before acting, briefly consider what the request needs and what information is missing.
2. PLAN: For multi-step tasks, outline 2-4 concrete steps. For simple tasks, proceed directly.
3. EXECUTE: Carry out one step at a time using tools. Verify each result before the next step.
4. DIAGNOSE: If something fails, read the error carefully and try a different approach.
5. VERIFY: After completing the task, verify the result works.
6. SUMMARIZE: Provide a concise summary of what was done and the outcome.

TOOL DISCIPLINE:
- ALWAYS use tools to get real information — NEVER guess file contents or command output.
- Read files before editing. Check directories before creating files.
- When multiple independent operations are needed, include multiple <tool_use> blocks.

ERROR RECOVERY:
- If a tool fails, READ the full error. Identify the root cause before retrying.
- NEVER repeat the exact same failing command. Always change something.
- SECURITY: If a tool returns "SECURITY RESTRICTION", tell the user access is restricted.`

const TOOL_USE_INSTRUCTIONS = `
# Tool Usage

To use a tool, include the following XML block in your response:

<tool_use>
<name>TOOL_NAME</name>
<input>
{"param1": "value1", "param2": "value2"}
</input>
</tool_use>

## Available Tools

### bash
Execute a shell command. Parameters: {"command": "cmd"}
Optional: {"timeout": 30000, "workdir": "relative/path"}

### write_file
Create or overwrite a file. Parameters: {"path": "relative/path", "content": "full content"}

### read_file
Read file contents. Parameters: {"path": "relative/path"}
Optional: {"startLine": 1, "endLine": 50}

### edit
Surgical find-and-replace edit. Parameters: {"path": "file.ts", "oldText": "exact text", "newText": "replacement"}

### multiedit
Multiple edits atomically. Parameters: {"edits": [{"path": "f.ts", "oldText": "old", "newText": "new"}]}

### apply_patch
Apply a unified diff patch. Parameters: {"path": "file.ts", "patch": "unified diff content"}

### list_dir
List directory contents. Parameters: {"path": "."}
Optional: {"recursive": true, "depth": 3}

### file_exists
Check if a path exists. Parameters: {"path": "relative/path"}

### glob
Find files by glob pattern. Parameters: {"pattern": "**/*.ts"}
Optional: {"path": "src/", "maxResults": 100}

### grep_search
Search files for a pattern. Parameters: {"pattern": "search term"}
Optional: {"path": ".", "include": "*.py", "maxResults": 50}

### codesearch
Semantic code search. Parameters: {"query": "function handleAuth"}
Optional: {"path": "src/", "language": "typescript", "maxResults": 20}

### web_fetch
Fetch URL content. Parameters: {"url": "https://..."}

### websearch
Search the web. Parameters: {"query": "search terms"}

### git_status
Show git branch and changes. Parameters: {}

### git_diff
Show git diff. Parameters: {"staged": false, "file": "optional/path"}

### git_log
Show recent commits. Parameters: {"count": 10}

### batch
Execute multiple tools in parallel (max 10). Parameters: {"calls": [{"tool": "name", "args": {...}}]}

### task
Run a long-running command. Parameters: {"title": "Build", "command": "npm run build"}

## Rules
1. Use write_file to create files — don't just show code blocks.
2. Use bash to run commands — don't just describe them.
3. Use RELATIVE paths.
4. Multiple <tool_use> blocks per response are allowed.
`

// ── Text-based tool call parsing ─────────────────────────────────────

function parseTextToolCalls(text: string): Array<{ name: string; args: Record<string, any> }> {
  const calls: Array<{ name: string; args: Record<string, any> }> = []
  const blockRegex = /<tool_use>([\s\S]*?)<\/tool_use>/g
  let blockMatch
  while ((blockMatch = blockRegex.exec(text)) !== null) {
    const parsed = parseToolBlock(blockMatch[1])
    if (parsed) calls.push(parsed)
  }

  // Handle truncated tool call
  const lastOpen = text.lastIndexOf("<tool_use>")
  if (lastOpen >= 0) {
    const afterOpen = text.slice(lastOpen + 10)
    if (!afterOpen.includes("</tool_use>")) {
      const parsed = parseToolBlock(afterOpen)
      if (parsed && parsed.name === "write_file" && parsed.args.content && typeof parsed.args.path === "string") {
        calls.push(parsed)
      }
    }
  }
  return calls
}

function parseToolBlock(block: string): { name: string; args: Record<string, any> } | null {
  const nameMatch = block.match(/<name>\s*([\s\S]*?)\s*<\/name>/)
  if (!nameMatch) return null
  const name = nameMatch[1].trim()
  const afterName = block.slice(block.indexOf("</name>") + 7).trim()
  let args: Record<string, any> = {}
  let resolved = false

  // Strategy 1: <input>{JSON}</input>
  const inputMatch = afterName.match(/<input>\s*([\s\S]*?)\s*<\/input>/)
  const inputContent = inputMatch
    ? inputMatch[1].trim()
    : (afterName.match(/<input>\s*([\s\S]+)/) ? afterName.match(/<input>\s*([\s\S]+)/)![1].trim() : null)

  if (inputContent) {
    try { args = JSON.parse(inputContent); resolved = true } catch {
      try { args = JSON.parse(inputContent.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']')); resolved = true } catch {
        if (name === "write_file") {
          const pathMatch = inputContent.match(/"path"\s*:\s*"([^"]*)"/)
          const contentStart = inputContent.match(/"content"\s*:\s*"/)
          if (pathMatch && contentStart) {
            const contentIdx = inputContent.indexOf(contentStart[0]) + contentStart[0].length
            let rawContent = inputContent.slice(contentIdx).replace(/\\?$/, "").replace(/"?\s*}?\s*$/, "")
            try { rawContent = JSON.parse('"' + rawContent + '"') } catch {}
            args = { path: pathMatch[1], content: rawContent }
            resolved = true
          }
        }
        if (!resolved) {
          const tagRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
          let tm
          while ((tm = tagRegex.exec(inputContent)) !== null) { args[tm[1]] = tm[2] }
          if (Object.keys(args).length > 0) resolved = true
        }
      }
    }
  }

  // Strategy 2: <parameter name="key">val</parameter>
  if (!resolved) {
    const paramRegex = /<parameter\s+name=["'](\w+)["']>([\s\S]*?)<\/parameter>/g
    let pm
    while ((pm = paramRegex.exec(afterName)) !== null) { args[pm[1]] = pm[2] }
    if (Object.keys(args).length > 0) resolved = true
  }

  // Strategy 3: direct XML tags
  if (!resolved) {
    const tagRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
    let tm
    while ((tm = tagRegex.exec(afterName)) !== null) { if (tm[1] !== "input") args[tm[1]] = tm[2] }
  }

  return { name, args }
}

function stripToolBlocks(text: string): string {
  return text.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, "").trim()
}

// ── Context management ───────────────────────────────────────────────

function compressMessages(msgs: Array<Record<string, any>>, maxChars: number): Array<Record<string, any>> {
  const total = msgs.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m).length), 0)
  if (total <= maxChars) return msgs

  const system = msgs[0]
  const keepLast = 6
  if (msgs.length <= keepLast + 1) return msgs
  const recent = msgs.slice(-keepLast)
  const middle = msgs.slice(1, -keepLast)
  if (middle.length === 0) return msgs

  let summary = "[Earlier conversation compressed for context]\n"
  for (const m of middle) {
    const role = m.role ?? "?"
    const content = typeof m.content === "string" ? m.content : ""
    if (role === "assistant") {
      const toolCount = (content.match(/<tool_use>/g) || []).length
      const text = stripToolBlocks(content).slice(0, 120)
      summary += `• Assistant: ${text}${toolCount > 0 ? ` [${toolCount} tool calls]` : ""}\n`
    } else if (role === "tool") {
      summary += `• Tool result: ${content.slice(0, 80).replace(/\n/g, " ")}…\n`
    } else if (role === "user") {
      summary += `• User: ${content.slice(0, 120)}\n`
    }
  }
  return [system, { role: "user", content: summary }, ...recent]
}

function buildToolFeedback(
  results: Array<{ tool: string; success: boolean; output: string }>,
  round: number,
  maxRounds: number,
): string {
  const failed = results.filter(r => !r.success)
  const succeeded = results.filter(r => r.success)

  let fb = "Tool execution results:\n"
  for (const r of results) {
    fb += `\n<tool_result>\n<name>${r.tool}</name>\n<status>${r.success ? "success" : "error"}</status>\n<output>\n${r.output.slice(0, 3000)}\n</output>\n</tool_result>\n`
  }

  if (failed.length > 0) {
    fb += `\n⚠️ ${failed.length} tool(s) FAILED. Read the error carefully and try a different approach:`
    for (const f of failed) fb += `\n  • ${f.tool}: ${f.output.slice(0, 200)}`
    fb += `\nDo NOT repeat the same command. Diagnose the root cause and fix it.`
  } else {
    fb += `\n✓ All ${succeeded.length} tool(s) succeeded.`
  }

  const remaining = maxRounds - round
  if (remaining <= 3 && remaining > 0) fb += `\n⏳ ${remaining} tool round(s) remaining.`
  fb += `\nContinue with the next step, or provide a final summary if the task is complete.`
  return fb
}

// ── Agent Executor ───────────────────────────────────────────────────

const DEFAULT_MAX_ROUNDS = 15
const FIRST_ROUND_TIMEOUT = 480_000
const SUBSEQUENT_TIMEOUT = 300_000

export class AgentExecutor {
  /**
   * Run a full agentic loop: send prompt to LLM, execute tools, iterate.
   * Returns the final text result and all tool call logs.
   */
  async run(opts: AgentRunOptions): Promise<AgentResult> {
    const start = Date.now()
    const maxRounds = opts.maxToolRounds ?? DEFAULT_MAX_ROUNDS

    // Resolve model
    let resolved: ResolvedModel
    try {
      resolved = await resolveModel(opts.modelID, opts.providerID)
    } catch (e: any) {
      return {
        text: "", model: opts.modelID ?? "unknown", provider: opts.providerID ?? "unknown",
        tokens: { input: 0, output: 0 }, toolCalls: [], latencyMs: Date.now() - start,
        rounds: 0, error: e.message ?? String(e),
      }
    }

    let { endpoint, modelApiId, modelName, providerName, apiKey, cloudProviderId } = resolved
    const maxTokens = Math.min(
      opts.maxTokens ?? 8192,
      resolved.outputLimit ?? 4096,
      Math.max(512, (resolved.contextLimit ?? 32768) - 8192),
    )
    const temperature = opts.temperature ?? 0.3

    // Build messages
    const systemContent = (opts.system ?? DEFAULT_AGENT_SYSTEM) + "\n\n" + TOOL_USE_INSTRUCTIONS
      + (opts.workspaceRoot ? `\n\nWorkspace root: ${opts.workspaceRoot}\nAll relative paths resolve relative to this directory.` : "")

    const messages: Array<Record<string, any>> = [{ role: "system", content: systemContent }]

    // Prepend context from dependencies if provided
    const userContent = opts.context
      ? `${opts.context}\n\n${opts.prompt}`
      : opts.prompt
    messages.push({ role: "user", content: userContent })

    let totalInput = 0
    let totalOutput = 0
    const toolLog: AgentResult["toolCalls"] = []
    let finalText = ""
    let finalReasoning = ""
    let round = 0

    for (; round <= maxRounds; round++) {
      const inferenceTimeout = opts.timeoutMs ?? (round === 0 ? FIRST_ROUND_TIMEOUT : SUBSEQUENT_TIMEOUT)

      // Compress context when large
      if (round > 2) {
        const compressed = compressMessages(messages, 80_000)
        if (compressed.length < messages.length) {
          messages.length = 0
          messages.push(...compressed)
        }
      }

      const reqBody: Record<string, any> = {
        model: modelApiId,
        messages,
        max_tokens: maxTokens,
        temperature,
      }

      let res: Response
      try {
        res = await providerFetch(endpoint, apiKey, cloudProviderId, reqBody, inferenceTimeout)
      } catch (fetchErr: any) {
        if (fetchErr?.name === "TimeoutError" || fetchErr?.name === "AbortError") {
          return {
            text: finalText || "(timed out)", model: modelName, provider: providerName,
            tokens: { input: totalInput, output: totalOutput }, toolCalls: toolLog,
            latencyMs: Date.now() - start, rounds: round, error: `Inference timed out on round ${round}`,
          }
        }
        throw fetchErr
      }

      // Handle errors with fallback
      if (!res.ok) {
        if (res.status === 429) {
          const fallbacks = await findFallbackModels(modelApiId)
          let fallbackOk = false
          for (const fb of fallbacks) {
            try {
              const fbRes = await providerFetch(fb.endpoint, fb.apiKey, fb.cloudProviderId, { ...reqBody, model: fb.modelApiId }, inferenceTimeout)
              if (fbRes.ok) {
                endpoint = fb.endpoint; modelApiId = fb.modelApiId; modelName = fb.modelName
                providerName = fb.providerName; apiKey = fb.apiKey; cloudProviderId = fb.cloudProviderId
                res = fbRes; fallbackOk = true; break
              }
              await fbRes.text().catch(() => {})
            } catch {}
          }
          if (!fallbackOk) {
            return {
              text: finalText || "(rate limited)", model: modelName, provider: providerName,
              tokens: { input: totalInput, output: totalOutput }, toolCalls: toolLog,
              latencyMs: Date.now() - start, rounds: round, error: "Rate limited, no fallback available",
            }
          }
        } else {
          const errText = await res.text().catch(() => "")
          return {
            text: finalText || "", model: modelName, provider: providerName,
            tokens: { input: totalInput, output: totalOutput }, toolCalls: toolLog,
            latencyMs: Date.now() - start, rounds: round, error: `Provider error (${res.status}): ${errText.slice(0, 300)}`,
          }
        }
      }

      const data = (await res.json()) as any
      const usage = data.usage ?? {}
      totalInput += usage.prompt_tokens ?? 0
      totalOutput += usage.completion_tokens ?? 0

      const choice = data.choices?.[0]
      if (!choice) {
        return {
          text: finalText || "(no response)", model: modelName, provider: providerName,
          tokens: { input: totalInput, output: totalOutput }, toolCalls: toolLog,
          latencyMs: Date.now() - start, rounds: round, error: "No response from model",
        }
      }

      const msg = choice.message
      const content = msg.content ?? ""

      // Handle empty response — nudge once
      if (!content && (!msg.tool_calls || msg.tool_calls.length === 0)) {
        if (round < 2) {
          messages.push({
            role: "user",
            content: "Your response was empty. Please respond using <tool_use> blocks or plain text.",
          })
          continue
        }
        return {
          text: "(model returned empty response)", model: modelName, provider: providerName,
          tokens: { input: totalInput, output: totalOutput }, toolCalls: toolLog,
          latencyMs: Date.now() - start, rounds: round,
        }
      }

      // Native function calling
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push(msg)
        for (const tc of msg.tool_calls) {
          const toolName = tc.function?.name ?? "unknown"
          let toolArgs: Record<string, any> = {}
          try {
            toolArgs = typeof tc.function?.arguments === "string"
              ? JSON.parse(tc.function.arguments)
              : tc.function?.arguments ?? {}
          } catch { toolArgs = { _raw: tc.function?.arguments } }

          const result = await executeTool(toolName, toolArgs, opts.workspaceRoot)
          toolLog.push({ tool: toolName, args: toolArgs, result: result.output.slice(0, 2000), success: result.success })
          messages.push({ role: "tool", tool_call_id: tc.id, content: result.output })
        }
        continue
      }

      // Text-based tool calls (XML blocks)
      const textToolCalls = parseTextToolCalls(content)
      if (textToolCalls.length > 0) {
        messages.push({ role: "assistant", content })
        const toolPromises = textToolCalls.map(tc =>
          executeTool(tc.name, tc.args, opts.workspaceRoot).then(result => ({ tc, result }))
        )
        const toolOutcomes = await Promise.all(toolPromises)

        const roundResults: Array<{ tool: string; success: boolean; output: string }> = []
        for (const { tc, result } of toolOutcomes) {
          toolLog.push({ tool: tc.name, args: tc.args, result: result.output.slice(0, 2000), success: result.success })
          roundResults.push({ tool: tc.name, success: result.success, output: result.output })
        }

        messages.push({ role: "user", content: buildToolFeedback(roundResults, round, maxRounds) })
        continue
      }

      // No tool calls — this is the final response
      finalText = stripToolBlocks(content)
      finalReasoning = msg.reasoning_content ?? msg.reasoning ?? ""

      // Self-correction: if round 0 and no tools used yet but task likely needs them
      if (round === 0 && toolLog.length === 0) {
        const lazyPattern = /\b(i('ll| will| would| can) (now |then )?(create|run|execute|write|implement|build|fix|read|check))/i
        if (lazyPattern.test(content)) {
          messages.push({ role: "assistant", content })
          messages.push({
            role: "user",
            content: "You described what you would do but did not use any tools. Use <tool_use> blocks to ACTUALLY execute the steps NOW.",
          })
          continue
        }
      }

      break // Done
    }

    return {
      text: finalText || "(max rounds reached)",
      reasoning: finalReasoning || undefined,
      model: modelName,
      provider: providerName,
      tokens: { input: totalInput, output: totalOutput },
      toolCalls: toolLog,
      latencyMs: Date.now() - start,
      rounds: round,
    }
  }
}
