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
import type { WorkspaceManager } from "../../services/workspace-manager"
import type { ChatLogStore } from "../../services/chat-log"
import type { ParallelExecutionManager } from "../../services/parallel-executor"

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
  sessionId: z.string().optional(),        // VS Code extension session ID for chat log
})

// Per-round timeout for model inference calls (not total request timeout).
// Reasoning models (MiniMax) can take 60-180s per call.
// First round gets extra time (model must process all context); subsequent
// rounds are shorter since context is already cached.
const DEFAULT_FIRST_ROUND_TIMEOUT_MS = 480_000  // 8 min for first round
const DEFAULT_INFERENCE_TIMEOUT_MS   = 300_000  // 5 min for subsequent rounds

const DEFAULT_SYSTEM = `Your name is Thirdwave AI. You are an expert AI coding assistant created by Thirdwave, with access to tools.
You are NOT ChatGPT, not GPT, not OpenAI, not Anthropic, not Google — you are Thirdwave AI. Always identify yourself as Thirdwave AI when asked.
You solve tasks by reasoning step-by-step, using tools to verify assumptions, and iterating until the task is fully complete.

REASONING PROTOCOL:
1. ANALYZE: Before acting, briefly consider what the request needs and what information is missing.
2. PLAN: For multi-step tasks, outline 2-4 concrete steps. For simple tasks, proceed directly.
3. EXECUTE: Carry out one step at a time using tools. Verify each result before the next step.
4. DIAGNOSE: If something fails, read the error carefully and try a different approach — never repeat the same failing command.
5. VERIFY: After completing the task, verify the result works (run the code, check the file exists, etc.).
6. SUMMARIZE: Provide a concise summary of what was done and the outcome.

TOOL DISCIPLINE:
- ALWAYS use tools to get real information — NEVER guess file contents, command output, or directory structure.
- Prefer acting over explaining. Actually DO things with tools, don't just describe what you would do.
- Read files before editing them. Check directories before creating files. Verify commands exist before running them.
- When multiple independent operations are needed, include multiple <tool_use> blocks in one response for efficiency.

ERROR RECOVERY:
- If a tool fails, READ the full error message. Identify the root cause before retrying.
- Try an alternative approach — different path, different command, install missing deps, fix syntax.
- NEVER repeat the exact same failing command. Always change something.
- Common fixes: check if path exists (list_dir), check permissions, use correct OS syntax, install missing packages.

QUALITY RULES:
- Before suggesting commands, verify the current directory and file paths exist using tools.
- Always use tools (bash, write_file) to actually create files and run commands — do NOT just show code blocks.
- When setting up projects, create ALL necessary files (requirements.txt, package.json, etc.) using write_file, then run install commands.
- Check the OS and environment before suggesting platform-specific packages.
- If a command fails, diagnose and fix it yourself — do not tell the user to fix it.
- Test that your code actually works by running it after creating it.
- NEVER say "I will do X" or "Let me do X" without actually doing it with tools in the same response.
- SECURITY: If a tool returns "SECURITY RESTRICTION" or "Access restricted", tell the user access is restricted. NEVER claim the file does not exist when access is denied.

Remember: You are Thirdwave AI. Never claim to be ChatGPT, GPT, OpenAI, Claude, Gemini, or any other AI.`

const DIRECT_SYSTEM = `Your name is Thirdwave AI. You are a friendly and helpful AI coding assistant created by Thirdwave. You are NOT ChatGPT, not GPT, not OpenAI — always identify yourself as Thirdwave AI.
When greeted, respond warmly and briefly introduce yourself as Thirdwave AI — mention you can help with coding tasks, file management, and development workflows. Keep greetings short and natural. Always provide complete, thorough answers. Never say "I will explain" or "I'll do" — instead, actually explain and do it immediately. When asked about code, provide full working solutions with explanations. When asked to analyze or fix code, show the complete corrected code and explain every change. Do not be lazy or skip details.`

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
Optional: {"timeout": 30000, "workdir": "relative/path"}

### write_file
Create or overwrite a file. Creates parent directories automatically. Use RELATIVE paths from the project root.
Parameters: {"path": "relative/path/to/file.py", "content": "full file content here"}

### read_file
Read file contents. Use RELATIVE paths.
Parameters: {"path": "relative/path/to/file.py"}
Optional: {"startLine": 1, "endLine": 50}

### edit
Edit a specific section of a file by replacing old text with new text. Safer than write_file — preserves the rest of the file.
Parameters: {"path": "file.ts", "oldText": "exact text to find", "newText": "replacement text"}

### multiedit
Apply multiple edits across one or more files atomically. If one edit fails, all are rolled back.
Parameters: {"edits": [{"path": "file.ts", "oldText": "old", "newText": "new"}, ...]}

### apply_patch
Apply a unified diff patch to a file.
Parameters: {"path": "file.ts", "patch": "--- a/file.ts\\n+++ b/file.ts\\n@@ ..."}

### list_dir
List directory contents. Sorted (directories first, then files). Filters out noise dirs (node_modules, .git, etc.).
Parameters: {"path": "."}
Optional: {"recursive": true, "depth": 3}

### file_exists
Check whether a file or directory exists at a given path. Use this BEFORE read_file or list_dir when you are not certain the path exists. Returns "EXISTS" or "NOT_FOUND" with the type (file/directory).
Parameters: {"path": "relative/path/to/check"}

### glob
Find files matching a glob pattern. Returns matching file paths.
Parameters: {"pattern": "**/*.ts"}
Optional: {"path": "src/", "maxResults": 100}

### grep_search
Search files for a pattern (regex supported).
Parameters: {"pattern": "search term", "path": ".", "include": "*.py"}

### codesearch
Semantic code search — find function/class/type definitions and symbol references. More precise than grep for code structure.
Parameters: {"query": "function handleAuth"}
Optional: {"path": "src/", "language": "typescript", "maxResults": 20}

### web_fetch
Fetch content from a URL.
Parameters: {"url": "https://example.com"}

### websearch
Search the web for information. Returns results with titles, URLs, and snippets.
Parameters: {"query": "search terms"}
Optional: {"maxResults": 5}

### git_status
Show git branch and modified files.
Parameters: {}

### git_diff
Show git diff.
Parameters: {"staged": false, "file": "optional/path"}

### git_log
Show recent commits.
Parameters: {"count": 10}

### batch
Execute multiple independent tool calls in parallel. Max 10 calls.
Parameters: {"calls": [{"tool": "read_file", "args": {"path": "a.ts"}}, {"tool": "read_file", "args": {"path": "b.ts"}}]}

### task
Run a long-running command as a background task (builds, test suites).
Parameters: {"title": "Run tests", "command": "npm test"}
Optional: {"timeout": 300000}

### plan
Create a structured execution plan for complex tasks.
Parameters: {"goal": "what to accomplish", "steps": [{"step": 1, "action": "what to do", "tool": "optional tool"}]}

### question
Ask the user a clarifying question when the request is ambiguous.
Parameters: {"question": "Which database?"}
Optional: {"options": ["PostgreSQL", "MySQL"], "context": "reason for asking"}

### skill
Load specialized knowledge into context. Use action="list" to see available skills, action="load" with name to load one.
Parameters: {"action": "list"} or {"action": "load", "name": "skill-name"}

## CRITICAL RULES
1. You MUST use write_file tool to actually create files. Do NOT just show file content as markdown code blocks. Actually create them with write_file.
2. You MUST use bash tool to run commands. Do NOT just describe what commands to run.
3. Use RELATIVE paths (e.g. "src/app.py") not absolute paths for write_file and read_file.
4. You can make multiple tool_use calls in one response. Each will be executed.
5. After your tools execute, you will receive the results and can continue with more tool calls or provide a summary.
6. Always create necessary directories by using write_file (it auto-creates parent dirs) or bash with mkdir.
7. For LARGE files (>200 lines): split the file into logical sections and write them using bash with heredoc (cat << 'EOF' > file.ext) or use write_file with the complete content. Never truncate file content.
8. If one write_file fails, retry with bash: echo 'content' > file or cat << 'EOF' > file.
9. ALWAYS use file_exists before read_file or list_dir when you are not 100% certain the path exists. This avoids wasted tool calls and errors. Example: call file_exists("src/components") before list_dir("src/components").
10. When workspace is loading or you are starting a new task, use list_dir(".") first to understand the project structure before making assumptions about file locations.
11. For surgical edits to existing files, prefer edit over write_file to avoid accidentally overwriting content.
12. Use batch to parallelize independent operations (e.g. reading multiple files at once).
13. Use plan to organize complex multi-step tasks before executing.
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
  // Capture entire <tool_use> blocks (complete)
  const blockRegex = /<tool_use>([\s\S]*?)<\/tool_use>/g
  let blockMatch
  while ((blockMatch = blockRegex.exec(text)) !== null) {
    const parsed = parseToolBlock(blockMatch[1])
    if (parsed) calls.push(parsed)
  }

  // Handle truncated tool call: <tool_use> without closing </tool_use>
  // This happens when model output is cut off mid-file-write by token limit
  const lastOpen = text.lastIndexOf("<tool_use>")
  if (lastOpen >= 0) {
    const afterOpen = text.slice(lastOpen + 10)
    if (!afterOpen.includes("</tool_use>")) {
      const parsed = parseToolBlock(afterOpen)
      if (parsed) {
        // For truncated write_file, attempt to recover the content
        if (parsed.name === "write_file" && parsed.args.content && typeof parsed.args.path === "string") {
          console.log(`[chat] Recovered truncated write_file for ${parsed.args.path} (${parsed.args.content.length} chars)`)
          calls.push(parsed)
        }
      }
    }
  }
  return calls
}

/** Parse a single tool block's inner content */
function parseToolBlock(block: string): { name: string; args: Record<string, any> } | null {
    const nameMatch = block.match(/<name>\s*([\s\S]*?)\s*<\/name>/)
    if (!nameMatch) return null
    const name = nameMatch[1].trim()

    // Extract everything after </name> as the params section
    const afterName = block.slice(block.indexOf("</name>") + 7).trim()
    let args: Record<string, any> = {}
    let resolved = false

    // Strategy 1: <input>{JSON}</input> — canonical format
    const inputMatch = afterName.match(/<input>\s*([\s\S]*?)\s*<\/input>/)
    // Also try truncated <input> without closing </input>
    const inputContent = inputMatch
      ? inputMatch[1].trim()
      : (afterName.match(/<input>\s*([\s\S]+)/) ? afterName.match(/<input>\s*([\s\S]+)/)![1].trim() : null)
    if (inputContent) {
      // Try strict JSON parse first
      try {
        args = JSON.parse(inputContent)
        resolved = true
      } catch {
        // Try fixing trailing commas (common model mistake)
        try {
          args = JSON.parse(inputContent.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']'))
          resolved = true
        } catch {
          // Try recovering truncated JSON for write_file:
          // {"path":"...","content":"...  (truncated mid-string)
          if (name === "write_file") {
            const pathMatch = inputContent.match(/"path"\s*:\s*"([^"]*)"/)
            const contentStart = inputContent.match(/"content"\s*:\s*"/)
            if (pathMatch && contentStart) {
              const contentIdx = inputContent.indexOf(contentStart[0]) + contentStart[0].length
              // Take everything after "content":" as the content, stripping any trailing incomplete escape
              let rawContent = inputContent.slice(contentIdx)
              // Remove trailing incomplete JSON tokens
              rawContent = rawContent.replace(/\\?$/, "").replace(/"?\s*}?\s*$/, "")
              // Unescape JSON string escapes
              try { rawContent = JSON.parse('"' + rawContent + '"') } catch { /* use as-is */ }
              args = { path: pathMatch[1], content: rawContent }
              resolved = true
            }
          }
          if (!resolved) {
            // Strategy 2: <input><key>val</key>...</input> (XML tags inside input)
            const tagRegex2 = /<(\w+)>([\s\S]*?)<\/\1>/g
            let tm
            while ((tm = tagRegex2.exec(inputContent)) !== null) {
              args[tm[1]] = tm[2]
            }
            if (Object.keys(args).length > 0) resolved = true
          }
        }
      }
    }

    // Strategy 3: <parameter name="key">val</parameter> (no input wrapper)
    if (!resolved) {
      const paramRegex = /<parameter\s+name=["'](\w+)["']>([\s\S]*?)<\/parameter>/g
      let pm
      while ((pm = paramRegex.exec(afterName)) !== null) {
        args[pm[1]] = pm[2]
      }
      if (Object.keys(args).length > 0) resolved = true
    }

    // Strategy 4: direct XML tags after </name> (no input wrapper)
    if (!resolved) {
      const tagRegex3 = /<(\w+)>([\s\S]*?)<\/\1>/g
      let tm3
      while ((tm3 = tagRegex3.exec(afterName)) !== null) {
        if (tm3[1] !== "input") args[tm3[1]] = tm3[2]
      }
    }

    return { name, args }
}

/**
 * Strip <tool_use> blocks from text to get the non-tool narrative parts.
 */
function stripToolBlocks(text: string): string {
  return text.replace(/<tool_use>[\s\S]*?<\/tool_use>/g, "").trim()
}

/**
 * Classify task complexity to decide agent planning depth.
 */
function classifyComplexity(message: string): "simple" | "moderate" | "complex" {
  const words = message.split(/\s+/).length
  const multiStep = /\b(and then|after that|also|then|step \d|first.*then|1\.|2\.|3\.|multiple|several|all|every|entire|full|complete)\b/i.test(message)
  const bigTask = /\b(create|build|setup|implement|refactor|migrate|deploy|redesign|rewrite|project|application|app|system|architecture)\b/i.test(message)
  if ((words > 40 && bigTask) || (multiStep && bigTask)) return "complex"
  if (words > 25 || multiStep || bigTask) return "moderate"
  return "simple"
}

/**
 * Compress conversation context when it grows too large.
 * Keeps system prompt + recent messages, summarizes the middle.
 */
function compressMessages(
  msgs: Array<Record<string, any>>,
  maxChars: number,
): Array<Record<string, any>> {
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
      summary += `\u2022 Assistant: ${text}${toolCount > 0 ? ` [${toolCount} tool calls]` : ""}\n`
    } else if (role === "tool") {
      summary += `\u2022 Tool result: ${content.slice(0, 80).replace(/\n/g, " ")}\u2026\n`
    } else if (role === "user") {
      summary += `\u2022 User: ${content.slice(0, 120)}\n`
    }
  }

  return [system, { role: "user", content: summary }, ...recent]
}

/**
 * Build contextual feedback after tool execution — error-aware and progress-aware.
 */
function buildToolFeedback(
  results: Array<{ tool: string; success: boolean; output: string }>,
  round: number,
  maxRounds: number,
): string {
  const succeeded = results.filter(r => r.success)
  const failed = results.filter(r => !r.success)

  let fb = "Tool execution results:\n"
  for (const r of results) {
    fb += `\n<tool_result>\n<name>${r.tool}</name>\n<status>${r.success ? "success" : "error"}</status>\n<output>\n${r.output.slice(0, 3000)}\n</output>\n</tool_result>\n`
  }

  if (failed.length > 0) {
    fb += `\n\u26A0\uFE0F ${failed.length} tool(s) FAILED. Read the error carefully and try a different approach:`
    for (const f of failed) {
      fb += `\n  \u2022 ${f.tool}: ${f.output.slice(0, 200)}`
    }
    fb += `\nDo NOT repeat the same command. Diagnose the root cause and fix it (wrong path? missing dependency? syntax error?).`
  } else {
    fb += `\n\u2713 All ${succeeded.length} tool(s) succeeded.`
  }

  const remaining = maxRounds - round
  if (remaining <= 3 && remaining > 0) {
    fb += `\n\u23F3 ${remaining} tool round(s) remaining \u2014 prioritize the most critical steps.`
  }

  fb += `\nContinue with the next step, or provide a final summary if the task is complete.`
  return fb
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

/**
 * Returns true when the user's message is a task request that likely needs tools,
 * rather than a simple conversational question.
 * Avoids nudging models to use tools for "who are you?" type questions.
 */
function taskNeedsTools(message: string): boolean {
  const trimmed = message.trim()

  // Explicit action keywords common in tool-use tasks
  const ACTION_PATTERN = /\b(create|make|list|show|display|read|write|edit|update|modify|run|execute|check|build|install|delete|remove|fix|find|locate|search|fetch|get|download|git|npm|pip|bun|deno|bash|shell|command|cmd|file|files|directory|folder|dir|code|script|project|deploy|test|debug|analyze|generate|refactor|open|close|start|stop|kill|process|port|log|error|import|require|package|setup|configure|init|mkdir|touch|cat|grep|ls|pwd|cd|mv|cp|curl|wget|docker|what.s in|what is in|contents? of|implement|add|append|insert)\b/i

  // Conversational-only patterns: "who are you", "what can you do", "what is X", etc.
  // These are short single-sentence questions with no file/code/action intent.
  const CONVERSATIONAL_PATTERN = /^(who|what|how|why|when|where|which|can you|could you|are you|is it|do you|would you|tell me about|explain|describe|what('s| is) (a|an|the|your))\b.{0,80}\??\.?\s*$/i

  const hasActions = ACTION_PATTERN.test(trimmed)
  const looksConversational = CONVERSATIONAL_PATTERN.test(trimmed) && !hasActions

  return !looksConversational
}

export function chatRoutes(workspacesMgr?: WorkspaceManager, chatLog?: ChatLogStore, parallelExecutor?: ParallelExecutionManager) {
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

      // Auto-register VS Code workspace when workspaceRoot is provided
      if (body.workspaceRoot && workspacesMgr) {
        // Validate workspaceRoot is a real directory
        try {
          const { statSync } = await import("fs")
          const stat = statSync(body.workspaceRoot)
          if (!stat.isDirectory()) {
            console.warn(`[chat] workspaceRoot is not a directory: ${body.workspaceRoot}`)
            body.workspaceRoot = undefined
          }
        } catch {
          console.warn(`[chat] workspaceRoot does not exist: ${body.workspaceRoot}`)
          body.workspaceRoot = undefined
        }

        if (body.workspaceRoot) {
          try {
            const existing = workspacesMgr.findByDirectory(body.workspaceRoot)
            if (!existing) {
              const name = body.workspaceRoot.split("/").filter(Boolean).pop() ?? "workspace"
              workspacesMgr.create({ name, directory: body.workspaceRoot, tags: ["vscode"] })
            } else {
              // Update last-accessed timestamp by switching (non-destructive)
              workspacesMgr.update(existing.id, {})
            }
          } catch {
            // Directory may not exist on the server — silently skip
          }
        }
      }

      // Build initial messages
      const useTools = body.tools !== false
      const messages: Array<Record<string, any>> = []

      // Build system prompt: identity + base instructions + tool use format
      // Identity MUST come first so models don't fall back to training defaults ("ChatGPT").
      let systemContent = body.system ?? (useTools ? DEFAULT_SYSTEM : DIRECT_SYSTEM)
      if (useTools) {
        // Append tool usage instructions AFTER identity/rules so the model's
        // persona is established before the long tool reference block.
        systemContent = systemContent + "\n\n" + TOOL_USE_INSTRUCTIONS
        // Tell the model which workspace directory tools operate in
        if (body.workspaceRoot) {
          systemContent += `\n\nIMPORTANT: The user's workspace root directory is: ${body.workspaceRoot}\nAll relative file paths in tool calls resolve relative to this directory. Use "." to refer to the workspace root.`
        }
      }
      messages.push({ role: "system", content: systemContent })
      if (body.history?.length) {
        for (const h of body.history) messages.push({ role: h.role, content: h.content })
      }
      messages.push({ role: "user", content: body.message })

      // For complex tasks, inject a planning nudge to encourage structured execution
      const complexity = classifyComplexity(body.message)
      if (useTools && complexity === "complex" && taskNeedsTools(body.message)) {
        messages[messages.length - 1].content += "\n\n[Think step-by-step: plan your approach in 2-3 concrete steps, then begin executing immediately with tools. Verify each step before moving to the next.]"
      }

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
      const userTimeout = body.timeoutMs

      const start = Date.now()
      let totalInput = 0
      let totalOutput = 0
      const toolLog: Array<{ tool: string; args: Record<string, any>; result: string; success: boolean }> = []

      // ── Agentic loop: call model → execute tools → feed back ──
      for (let round = 0; round <= maxRounds; round++) {
        // Progressive timeout: first round gets more time (fresh context processing)
        const inferenceTimeout = userTimeout ?? (round === 0 ? DEFAULT_FIRST_ROUND_TIMEOUT_MS : DEFAULT_INFERENCE_TIMEOUT_MS)

        // Compress context when it grows too large (~80K chars ≈ 20K tokens)
        if (round > 2) {
          const beforeLen = messages.length
          const compressed = compressMessages(messages, 80_000)
          if (compressed.length < beforeLen) {
            messages.length = 0
            messages.push(...compressed)
            console.log(`[chat] Round ${round}: Compressed context ${beforeLen} → ${compressed.length} messages`)
          }
        }

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
            const timeoutSecs = Math.round(inferenceTimeout / 1000)
            const elapsed = Date.now() - start
            console.log(`[chat] Round ${round}: Timeout after ${timeoutSecs}s (total elapsed: ${Math.round(elapsed / 1000)}s)`)
            return c.json({
              error: "Model inference timed out",
              detail: `The model took longer than ${timeoutSecs}s to respond. Try a simpler prompt or disable tool-calling.`,
              hint: round === 0
                ? "The first round takes longer because the model must process the full context. Try shortening your prompt or conversation history."
                : `Timed out on round ${round + 1} of the agent loop. The model may be overloaded.`,
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
        // Some models occasionally return empty content.
        // Nudge them once more, then give a meaningful fallback.
        if (useTools && !msg.content && (!msg.tool_calls || msg.tool_calls.length === 0)) {
          if (round < 2) {
            console.log(`[chat] Round ${round}: Empty response from ${modelApiId}, nudging model to respond`)
            messages.push({
              role: "user",
              content: "Your response was empty. Please respond to the user's question directly. If you need to use tools, include <tool_use> XML blocks. If no tools are needed, just answer the question in plain text.",
            })
            continue // retry round
          }
          console.log(`[chat] Round ${round}: Model ${modelApiId} keeps returning empty — returning fallback`)
          // Synthesize a response so the user isn't left with nothing
          const fallbackData = {
            choices: [{ message: { role: "assistant", content: `I wasn't able to generate a response for this request. The model (${modelName}) returned empty content after ${round + 1} attempts.\n\nThis can happen when:\n- The model is overloaded or the request is too complex\n- The prompt exceeded the model's context window\n- A security policy restricted the action\n\nTry rephrasing your request, simplifying it, or switching to a different model.` }, finish_reason: "stop" }],
            usage: { prompt_tokens: totalInput, completion_tokens: 0 },
          }
          return logAndReturn(c, fallbackData, Date.now() - start, originalModelName, providerName, totalInput, totalOutput, toolLog, chatLog, body.sessionId, body.message)
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

            // Execute text-based tool calls in parallel for speed
            const parallelStart = Date.now()
            const toolPromises = textToolCalls.map(tc => {
              const t0 = Date.now()
              return executeTool(tc.name, tc.args, body.workspaceRoot).then(result => ({ tc, result, durationMs: Date.now() - t0 }))
            })
            const toolOutcomes = await Promise.all(toolPromises)

            const roundResults: Array<{ tool: string; success: boolean; output: string }> = []
            for (const { tc, result } of toolOutcomes) {
              toolLog.push({
                tool: tc.name,
                args: tc.args,
                result: result.output.slice(0, 2000),
                success: result.success,
              })
              roundResults.push({ tool: tc.name, success: result.success, output: result.output })
            }

            // Track parallel tool execution for the dashboard
            if (parallelExecutor && toolOutcomes.length > 1) {
              parallelExecutor.recordToolExecution({
                sessionId: body.sessionId,
                round,
                prompt: body.message,
                tools: toolOutcomes.map(({ tc, result, durationMs }) => ({
                  name: tc.name, args: tc.args, success: result.success, durationMs,
                })),
              })
            }

            // Feed results back with context-aware feedback
            const toolResultsText = buildToolFeedback(roundResults, round, maxRounds)
            messages.push({ role: "user", content: toolResultsText })
            continue  // next round — model gets tool results
          }
        }

        // ── Self-correction: detect responses that promise action without tools ─
        // Catches both round-0 no-tool replies AND later rounds where the model
        // says "I'll do X" without actually invoking anything.
        if (useTools && msg.content && round < maxRounds - 1 && taskNeedsTools(body.message)) {
          const noToolsYet = toolLog.length === 0
          const lazyPattern = /\b(i('ll| will| would| can| shall) (now |then )?(create|set up|run|execute|write|implement|build|make|add|install|fix|read|check|deploy|configure))/i
          const isLazy = lazyPattern.test(msg.content) && noToolsYet
          const isNoToolRound0 = round === 0 && noToolsYet

          if (isLazy || isNoToolRound0) {
            console.log(`[chat] Round ${round}: ${isLazy ? "Lazy response" : "No-tool reply"} detected — nudging to use tools`)
            messages.push({ role: "assistant", content: msg.content })
            messages.push({
              role: "user",
              content: round === 0
                ? "IMPORTANT: You MUST actually use tools to complete this task. Include <tool_use><name>TOOL</name><input>{JSON}</input></tool_use> blocks in your response. Do NOT fabricate file contents or command output — use tools to get real results."
                : "You described what you would do but did not use any tools. Use <tool_use> blocks to ACTUALLY execute the steps NOW. Do not describe — act.",
            })
            continue
          }
        }

        // ── No tool calls — final response ──────────────────────
        return logAndReturn(c, data, Date.now() - start, originalModelName, providerName, totalInput, totalOutput, toolLog, chatLog, body.sessionId, body.message)
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

    /**
     * GET /api/chat/sessions — list VS Code extension chat sessions from platform log
     */
    .get("/sessions", (c) => {
      if (!chatLog) return c.json([])
      const limit = c.req.query("limit") ? Number(c.req.query("limit")) : 50
      return c.json(chatLog.listSessions(limit))
    })

    /**
     * GET /api/chat/sessions/:id — get all messages in a session
     */
    .get("/sessions/:id", (c) => {
      if (!chatLog) return c.json({ error: "not_found" }, 404)
      const entries = chatLog.getEntries(c.req.param("id"))
      if (entries.length === 0) return c.json({ error: "not_found" }, 404)
      return c.json(entries)
    })
}

// ── Response formatter ───────────────────────────────────────────────

/** Log exchange to chat history and return response. */
function logAndReturn(
  c: any, data: any, latencyMs: number,
  modelName: string, providerName: string,
  extraInput: number, extraOutput: number,
  toolLog: Array<{ tool: string; args: Record<string, any>; result: string; success: boolean }>,
  chatLog: ChatLogStore | undefined,
  sessionId: string | undefined,
  userMessage: string,
) {
  if (chatLog && sessionId) {
    const text = stripToolBlocks(data.choices?.[0]?.message?.content ?? "")
    try {
      chatLog.store({
        sessionId,
        userMessage,
        assistantReply: text || "(no response)",
        model: modelName,
        toolCallCount: toolLog.length,
        latencyMs,
      })
    } catch {}
  }
  return formatFinalResponse(c, data, latencyMs, modelName, providerName, extraInput, extraOutput, toolLog)
}

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
