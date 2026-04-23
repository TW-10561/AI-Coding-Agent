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
import { defaultPolicyEngine, defaultRBACEngineV2 } from "../../services/policy-engine"
import { executeTool, getToolDefinitions } from "../../services/tool-executor"
import type { WorkspaceManager } from "../../services/workspace-manager"
import type { ChatLogStore } from "../../services/chat-log"
import type { ParallelExecutionManager } from "../../services/parallel-executor"
import type { BudgetManager } from "../../services/budget-manager"
import { apiKeyService } from "../../services/api-key-service"

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
  maxToolRounds: z.number().min(0).max(40).optional(),
  timeoutMs: z.number().min(5000).max(600000).optional(), // per-round fetch timeout
  workspaceRoot: z.string().optional(),    // VS Code workspace folder path
  sessionId: z.string().optional(),        // VS Code extension session ID for chat log
  /**
   * Agent execution mode:
   *   "quick"       — single-shot, no tools, fastest (same as /direct but via main endpoint)
   *   "investigate" — read-only tools only (bash reads, grep, list_dir, file_exists, read_file)
   *   "edit"        — read + write tools; lower round limit; verify after each edit
   *   "agent"       — full agent; all tools; max rounds (default)
   */
  mode: z.enum(["quick", "investigate", "edit", "agent"]).optional(),
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

### file_exists
Check whether a file or directory exists at a given path. Use this BEFORE read_file or list_dir when you are not certain the path exists. Returns "EXISTS" or "NOT_FOUND" with the type (file/directory).
Parameters: {"path": "relative/path/to/check"}

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
7. For LARGE files (>200 lines): split the file into logical sections and write them using bash with heredoc (cat << 'EOF' > file.ext) or use write_file with the complete content. Never truncate file content.
8. If one write_file fails, retry with bash: echo 'content' > file or cat << 'EOF' > file.
9. ALWAYS use file_exists before read_file or list_dir when you are not 100% certain the path exists. This avoids wasted tool calls and errors. Example: call file_exists("src/components") before list_dir("src/components").
10. When workspace is loading or you are starting a new task, use list_dir(".") first to understand the project structure before making assumptions about file locations.
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

// ── Agent state machine ──────────────────────────────────────────────
/**
 * Explicit phases for the agentic loop. Each round transitions through these.
 * Tracking state makes it easy to enforce per-phase policies and debug stalls.
 */
type AgentPhase = "analyze" | "plan" | "act" | "observe" | "reflect" | "respond" | "halt"

/** Per-session loop context — tracks state that affects halt conditions */
interface LoopContext {
  phase: AgentPhase
  /** Hash of the last tool output set — to detect stalled loops */
  lastToolOutputHash: string
  /** Full normalized text of the last assistant turn — to detect repeated reasoning */
  lastAssistantReasoning: string
  /** Number of consecutive rounds with identical tool outputs */
  stalledRounds: number
  /** Number of consecutive rounds with identical assistant reasoning */
  repeatedReasoningRounds: number
  /** Whether the planning step has been injected */
  planningInjected: boolean
  /** Per-tool call count within this session — for deduplication */
  toolCallCounts: Map<string, number>
  /** Per-tool last-arg fingerprints — to detect identical repeated calls */
  toolCallFingerprints: Map<string, string>
}

/** Mode configuration — each mode gets different policies */
interface ModeConfig {
  allowedTools: "all" | "readonly" | "none"
  maxRounds: number
  requirePlanning: boolean
  requireReflection: boolean
  /**
   * Max times the same tool+args combo can run in one session.
   * Prevents infinite read loops.
   */
  maxSameToolCallsPerSession: number
}

const MODE_CONFIGS: Record<string, ModeConfig> = {
  quick: {
    allowedTools: "none",
    maxRounds: 0,
    requirePlanning: false,
    requireReflection: false,
    maxSameToolCallsPerSession: 0,
  },
  investigate: {
    allowedTools: "readonly",
    maxRounds: 8,
    requirePlanning: true,
    requireReflection: true,
    maxSameToolCallsPerSession: 3,
  },
  edit: {
    allowedTools: "all",
    maxRounds: 10,
    requirePlanning: true,
    requireReflection: true,
    maxSameToolCallsPerSession: 4,
  },
  agent: {
    allowedTools: "all",
    maxRounds: 25,
    requirePlanning: true,
    requireReflection: true,
    maxSameToolCallsPerSession: 6,
  },
}

/** Read-only tool names — safe to run in parallel and allowed in "investigate" mode */
const READONLY_TOOLS = new Set(["read_file", "list_dir", "grep_search", "file_exists", "git_status", "git_log", "git_diff", "bash_readonly"])

/** Error taxonomy for retry / halt decisions */
type AgentErrorType = "access_restricted" | "model_down" | "rate_limited" | "tool_error" | "policy_blocked" | "workspace_denied" | "invalid_args" | "timeout" | "unknown"

function classifyHttpError(status: number, body: string): AgentErrorType {
  if (status === 403) return body.includes("workspace") ? "workspace_denied" : "access_restricted"
  if (status === 401) return "access_restricted"
  if (status === 429) return "rate_limited"
  if (status === 502 || status === 503) return "model_down"
  if (status === 504) return "timeout"
  if (status === 400) return "invalid_args"
  return "unknown"
}

/** Whether the error type should be retried automatically */
function shouldRetry(errType: AgentErrorType): boolean {
  return errType === "model_down" || errType === "rate_limited"
}

/** Simple fast hash for change detection — not cryptographic */
function simpleHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0
  }
  return h.toString(36)
}

/**
 * Summarize raw tool outputs into compact structured observations.
 * Reduces context token usage while preserving critical info for the model.
 */
function summarizeToolOutput(toolName: string, rawOutput: string, success: boolean): string {
  if (!success) {
    return `[ERROR: ${rawOutput.slice(0, 300)}]`
  }
  const lines = rawOutput.split("\n")
  const lineCount = lines.length
  const charCount = rawOutput.length

  // Short outputs — return as-is
  if (charCount <= 800) return rawOutput

  // For large outputs, extract key lines and append a summary note
  switch (toolName) {
    case "bash": {
      // Keep first 20 and last 10 lines
      const head = lines.slice(0, 20).join("\n")
      const tail = lines.slice(-10).join("\n")
      return `${head}\n... [${lineCount - 30} lines omitted] ...\n${tail}\n[Total: ${lineCount} lines, ${charCount} chars]`
    }
    case "read_file": {
      const head = lines.slice(0, 30).join("\n")
      const tail = lines.slice(-5).join("\n")
      return `${head}\n... [${lineCount - 35} lines omitted] ...\n${tail}\n[File: ${lineCount} total lines]`
    }
    case "grep_search": {
      const matches = lines.filter(l => l.trim()).slice(0, 40)
      return `${matches.join("\n")}${lineCount > 40 ? `\n... [${lineCount - 40} more matches]` : ""}`
    }
    case "list_dir": {
      return lines.slice(0, 60).join("\n") + (lineCount > 60 ? `\n... [${lineCount - 60} more entries]` : "")
    }
    default: {
      return rawOutput.slice(0, 1200) + (charCount > 1200 ? `\n... [truncated, ${charCount} total chars]` : "")
    }
  }
}

/**
 * Build the post-tool reflection prompt.
 * Forces the model to assess progress before the next tool round.
 */
function buildReflectionPrompt(
  results: Array<{ tool: string; success: boolean; output: string }>,
  round: number,
  maxRounds: number,
  mode: string,
): string {
  const succeeded = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length
  const remaining = maxRounds - round

  let fb = "Tool execution results:\n"
  for (const r of results) {
    const summary = summarizeToolOutput(r.tool, r.output, r.success)
    fb += `\n<tool_result>\n<name>${r.tool}</name>\n<status>${r.success ? "success" : "error"}</status>\n<output>\n${summary}\n</output>\n</tool_result>\n`
  }

  if (failed > 0) {
    fb += `\n⚠️ ${failed} tool(s) FAILED. Read the error carefully and try a DIFFERENT approach — do NOT repeat the same failing command.`
    for (const f of results.filter(r => !r.success)) {
      fb += `\n  • ${f.tool}: ${f.output.slice(0, 200)}`
    }
  } else {
    fb += `\n✓ All ${succeeded} tool(s) succeeded.`
  }

  // Reflection prompt — always injected in agent/edit/investigate modes
  if (mode !== "quick") {
    fb += `\n\n[REFLECTION — answer briefly before continuing]\n1. What did I just learn from these results?\n2. Do I have enough information to answer the user now?\n3. What is the single next minimal action needed (if any)?\n\nRemaining rounds: ${remaining}. If you have enough to answer, respond directly now. If not, use the minimum tools needed — no broad scans, no repeated calls.`
  }

  if (remaining <= 2 && remaining > 0) {
    fb += `\n\n⏳ CRITICAL: Only ${remaining} round(s) left. Wrap up — give the user the best answer possible with what you have.`
  }

  return fb
}

/**
 * Build the planning-phase injection for the first tool round.
 * Instructs the model to produce a structured plan before acting.
 */
function buildPlanningPrompt(message: string, complexity: "simple" | "moderate" | "complex", mode: string): string {
  if (mode === "quick" || mode === "investigate") {
    return `\n\n[PLAN before acting]\nBefore using any tools, briefly state:\n1. Goal: what exactly is being asked\n2. Files/paths likely needed (if any)\n3. Whether tools are actually required\n\nThen execute immediately. Keep the plan to 3 lines max.`
  }
  if (complexity === "complex") {
    return `\n\n[PLAN before acting]\nThis is a multi-step task. Before using any tools:\n1. State the overall goal in one sentence\n2. List 3-5 concrete steps in order\n3. Identify any constraints (paths, permissions, existing files to preserve)\n4. State which step you are starting with\n\nThen immediately begin step 1 with tools.`
  }
  return `\n\n[PLAN before acting]\nBriefly state: goal, files/paths involved, first tool call needed. Then act.`
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
 * Build contextual feedback after tool execution.
 * Delegates to buildReflectionPrompt (new state-machine loop).
 */
function buildToolFeedback(
  results: Array<{ tool: string; success: boolean; output: string }>,
  round: number,
  maxRounds: number,
  mode = "agent",
): string {
  return buildReflectionPrompt(results, round, maxRounds, mode)
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

export function chatRoutes(
  workspacesMgr?: WorkspaceManager,
  chatLog?: ChatLogStore,
  parallelExecutor?: ParallelExecutionManager,
  budget?: BudgetManager,
) {
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
      // ── Stage timing — measures overhead before model inference ────
      const _reqStart = Date.now()
      const body = ChatBody.parse(await c.req.json())
      const _tParse = Date.now()

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
      const _tPolicy = Date.now()

      const currentUser = (c.get("user") as any) || {}
      let resolved
      try {
        resolved = await resolveModel(body.modelID, body.providerID, currentUser.sub)
      } catch (resolveErr: any) {
        const status = resolveErr.status || 500
        return c.json({ error: resolveErr.message || "Failed to resolve model", model: body.modelID }, status)
      }
      const _tModelResolve = Date.now()
      // Store stage timings in context so formatFinalResponse can include them
      c.set("_stageTimingMs", {
        parse:        _tParse        - _reqStart,
        policy:       _tPolicy       - _tParse,
        modelResolve: _tModelResolve - _tPolicy,
        preModel:     _tModelResolve - _reqStart,
      })
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
            // First look for this user's own workspace for the directory
            let existing = await workspacesMgr.findByDirectory(body.workspaceRoot, currentUser.sub)
            if (!existing) {
              // Not found for this user — try to create their own entry (allows multi-user same dir)
              try {
                const name = body.workspaceRoot.split("/").filter(Boolean).pop() ?? "workspace"
                const ws = await workspacesMgr.create({ name, directory: body.workspaceRoot, tags: ["vscode"], ownerId: currentUser.sub })
                if (ws?.id) await workspacesMgr.switchTo(ws.id, currentUser.sub).catch(() => {})
              } catch (createErr: any) {
                // If creation failed (e.g. dir doesn't exist on server), silently skip
                console.warn(`[chat] Workspace create skipped: ${createErr.message}`)
              }
            } else {
              // Update last-accessed timestamp and ensure it's active for this user
              await workspacesMgr.switchTo(existing.id, currentUser.sub).catch(() => {})
            }
          } catch {
            // Silently skip workspace auto-registration failures
          }
        }
      }

      // ── Resolve agent mode ───────────────────────────────────
      const agentMode = body.mode ?? "agent"
      const modeConfig = MODE_CONFIGS[agentMode] ?? MODE_CONFIGS.agent

      // Build initial messages
      // Auto-detect conversational messages: even if the client sends tools=true,
      // simple greetings/questions should NOT include tool instructions. This
      // prevents models from trying to run tools when the user just says "hi".
      const clientWantsTools = body.tools !== false && modeConfig.allowedTools !== "none"
      const useTools = clientWantsTools && taskNeedsTools(body.message)
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
        // Inject mode-specific constraints
        if (agentMode === "investigate") {
          systemContent += `\n\nMODE: read-only investigation. You may ONLY use these tools: read_file, list_dir, grep_search, file_exists, git_status, git_log, git_diff. Do NOT write files, run bash commands, or modify anything.`
        } else if (agentMode === "edit") {
          systemContent += `\n\nMODE: edit-and-verify. After each file write, verify the result with read_file. Minimize scope — only change what is asked.`
        }
      }
      messages.push({ role: "system", content: systemContent })
      if (body.history?.length) {
        for (const h of body.history) messages.push({ role: h.role, content: h.content })
      }
      messages.push({ role: "user", content: body.message })

      // Classify complexity and inject planning prompt
      const complexity = classifyComplexity(body.message)
      if (useTools && modeConfig.requirePlanning && taskNeedsTools(body.message)) {
        messages[messages.length - 1].content += buildPlanningPrompt(body.message, complexity, agentMode)
      } else if (useTools && complexity === "complex" && taskNeedsTools(body.message)) {
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
      const maxRounds = body.maxToolRounds ?? modeConfig.maxRounds
      const userTimeout = body.timeoutMs

      const start = Date.now()
      const _tLoopStart = Date.now()
      let totalInput = 0
      let totalOutput = 0
      const toolLog: Array<{ tool: string; args: Record<string, any>; result: string; success: boolean }> = []

      // ── Loop context — state machine tracking ─────────────────
      const loopCtx: LoopContext = {
        phase: "analyze",
        lastToolOutputHash: "",
        lastAssistantReasoning: "",
        stalledRounds: 0,
        repeatedReasoningRounds: 0,
        planningInjected: false,
        toolCallCounts: new Map(),
        toolCallFingerprints: new Map(),
      }

      // ── Agentic loop: analyze → plan → act → observe → reflect → respond/halt ──
      for (let round = 0; round <= maxRounds; round++) {
        // Progressive timeout: first round gets more time (fresh context processing)
        const inferenceTimeout = userTimeout ?? (round === 0 ? DEFAULT_FIRST_ROUND_TIMEOUT_MS : DEFAULT_INFERENCE_TIMEOUT_MS)

        // ── Phase: analyze / plan (rounds 0-1) ───────────────────
        loopCtx.phase = round === 0 ? "analyze" : (round === 1 && loopCtx.toolCallCounts.size === 0 ? "plan" : "act")

        // ── Context compaction ────────────────────────────────────
        if (round > 2) {
          const beforeLen = messages.length
          const compressed = compressMessages(messages, 80_000)
          if (compressed.length < beforeLen) {
            messages.length = 0
            messages.push(...compressed)
            console.log(`[chat] Round ${round}: Context compressed ${beforeLen} → ${compressed.length} messages`)
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
            const errType: AgentErrorType = "timeout"
            console.log(`[chat] Round ${round}: ${errType} after ${timeoutSecs}s (total elapsed: ${Math.round(elapsed / 1000)}s)`)
            logErrorToChat(chatLog, body.sessionId, body.message, `Model inference timed out after ${timeoutSecs}s`, modelName, Date.now() - start)
            return c.json({
              error: "Model inference timed out",
              errorType: errType,
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
          const errText = await res.text().catch(() => "")
          const errType = classifyHttpError(res.status, errText)
          let detail = errText.slice(0, 300)
          try { const j = JSON.parse(errText); if (j.detail) detail = j.detail } catch {}

          // Rate-limited — try falling back to another gateway model before failing
          if (res.status === 429) {
            const retryAfter = res.headers.get("retry-after")

            // Attempt fallback: try all online gateway models until one succeeds
            const fallbacks = await findFallbackModels(modelApiId, new Set(), apiKey)
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
              logErrorToChat(chatLog, body.sessionId, body.message, `Rate limited by ${providerName}`, modelName, Date.now() - start)
              return c.json({ error: "Rate limited by model provider", errorType: errType, detail, retryAfterSeconds: retryAfter ? Number(retryAfter) : 30, triedFallbacks: fallbacks.map(f => f.modelApiId) }, 429)
            }
          }
          // Forbidden — model restricted for this API key (gateway ACL)
          else if (res.status === 403) {
            logErrorToChat(chatLog, body.sessionId, body.message, `Model access restricted: ${detail}`, modelName, Date.now() - start)
            return c.json({ error: "Model access restricted", errorType: errType, detail: `The model "${modelName}" is not accessible with your API key. This is a gateway policy restriction — select a different model.`, model: modelName, provider: providerName }, 403)
          }
          // Gateway/provider temporarily unavailable — retry once after 2s (model_down is retryable)
          else if ((res.status === 502 || res.status === 503) && round === 0) {
            await new Promise(r => setTimeout(r, 2000))
            try {
              const retryRes = await providerFetch(endpoint, apiKey, cloudProviderId, reqBody, inferenceTimeout)
              if (retryRes.ok) {
                const data = (await retryRes.json()) as any
                return formatFinalResponse(c, data, Date.now() - start, originalModelName, providerName, totalInput, totalOutput, toolLog, budget, body.sessionId)
              }
              const retryErrText = await retryRes.text().catch(() => "")
              let retryDetail = retryErrText.slice(0, 500)
              try { const j = JSON.parse(retryErrText); if (j.detail) retryDetail = j.detail } catch {}
              logErrorToChat(chatLog, body.sessionId, body.message, `${providerName} unavailable (${retryRes.status}) after retry`, modelName, Date.now() - start)
              return c.json({ error: `${providerName} unavailable (${retryRes.status}) after retry`, errorType: "model_down", detail: retryDetail }, 503)
            } catch {}
          }

          if (!res.ok) {
            logErrorToChat(chatLog, body.sessionId, body.message, `${providerName} error (${res.status}): ${detail}`, modelName, Date.now() - start)
            return c.json({ error: `${providerName} error (${res.status})`, errorType: errType, detail }, 502)
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
        console.log(`[chat] Round ${round} [${loopCtx.phase}]: ${(msg.content ?? "").length} chars, ${msg.tool_calls?.length ?? 0} native calls, finish=${choice.finish_reason}`)

        // ── Handle empty response from model ────────────────────
        if (useTools && !msg.content && (!msg.tool_calls || msg.tool_calls.length === 0)) {
          if (round < 3) {
            console.log(`[chat] Round ${round}: Empty response from ${modelApiId}, nudging model to respond`)
            messages.push({
              role: "user",
              content: round === 0
                ? "Your response was empty. Please respond to the user's question directly. If you need to use tools, include <tool_use> XML blocks. If no tools are needed, just answer the question in plain text."
                : "Your response was empty again. You MUST respond now. Either use a <tool_use> block or answer the question in plain text. Do not send an empty message.",
            })
            continue // retry round
          }
          console.log(`[chat] Round ${round}: Model ${modelApiId} keeps returning empty — returning 503`)
          logErrorToChat(chatLog, body.sessionId, body.message, `Model ${modelName} returned empty response after ${round + 1} attempts — may be overloaded or down`, modelName, Date.now() - start, currentUser.sub)
          return c.json({
            error: "Model returned empty response",
            errorType: "model_unavailable",
            detail: `The model "${modelName}" returned empty content after ${round + 1} attempts. This usually means the model is overloaded, down, or cannot handle this request. Try switching to a different model.`,
            model: modelName,
            provider: providerName,
            latencyMs: Date.now() - start,
            hint: "Switch to a different model in the model selector, then retry your request.",
          }, 503)
        }

        // ── Halt: detect repeated reasoning ──────────────────────
        if (msg.content && loopCtx.lastAssistantReasoning) {
          const normCurrent = (msg.content as string).replace(/\s+/g, " ").toLowerCase().slice(0, 500)
          const normLast = loopCtx.lastAssistantReasoning
          if (normCurrent === normLast) {
            loopCtx.repeatedReasoningRounds++
            if (loopCtx.repeatedReasoningRounds >= 2) {
              console.log(`[chat] Round ${round}: Repeated reasoning detected — halting loop`)
              loopCtx.phase = "halt"
              return logAndReturn(c, data, Date.now() - start, originalModelName, providerName, totalInput, totalOutput, toolLog, chatLog, body.sessionId, body.message, budget)
            }
          } else {
            loopCtx.repeatedReasoningRounds = 0
          }
        }
        if (msg.content) {
          loopCtx.lastAssistantReasoning = (msg.content as string).replace(/\s+/g, " ").toLowerCase().slice(0, 500)
        }

        // ── Check for native tool calls ───────────────────────────
        if (msg.tool_calls && msg.tool_calls.length > 0 && useTools) {
          messages.push(msg)
          loopCtx.phase = "act"

          for (const tc of msg.tool_calls) {
            const toolName = tc.function?.name ?? "unknown"
            let toolArgs: Record<string, any> = {}
            try {
              toolArgs = typeof tc.function?.arguments === "string"
                ? JSON.parse(tc.function.arguments)
                : tc.function?.arguments ?? {}
            } catch { toolArgs = { _raw: tc.function?.arguments } }

            // ── Tool-call policy: deduplication ──────────────────
            const fingerprint = `${toolName}::${JSON.stringify(toolArgs)}`
            const prevFp = loopCtx.toolCallFingerprints.get(toolName)
            const callCount = (loopCtx.toolCallCounts.get(toolName) ?? 0) + 1
            loopCtx.toolCallCounts.set(toolName, callCount)
            if (prevFp === fingerprint && callCount > 1) {
              console.log(`[chat] Skipping duplicate tool call: ${toolName} (round ${round})`)
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: "[SKIPPED: identical tool call already executed this session. Do not repeat the same call — use the previous result or take a different approach.]",
              })
              continue
            }
            // Enforce per-tool max calls
            if (callCount > modeConfig.maxSameToolCallsPerSession) {
              console.log(`[chat] Tool call limit reached for ${toolName} (${callCount} calls)`)
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: `[BLOCKED: "${toolName}" has been called ${callCount} times. Max ${modeConfig.maxSameToolCallsPerSession} per session. Switch approach.]`,
              })
              continue
            }
            // Block write tools in investigate mode
            if (agentMode === "investigate" && !READONLY_TOOLS.has(toolName)) {
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: `[BLOCKED: "${toolName}" is not allowed in investigate (read-only) mode.]`,
              })
              continue
            }
            loopCtx.toolCallFingerprints.set(toolName, fingerprint)

            // RBACEngineV2: check tool access before execution
            const userRole = (currentUser as any).role || "developer"
            const rbacDecision = await defaultRBACEngineV2.checkToolAccess(toolName, userRole)
            if (rbacDecision === "deny") {
              messages.push({
                role: "tool",
                tool_call_id: tc.id,
                content: `[RBAC DENIED: Your role "${userRole}" does not have permission to use "${toolName}". Contact your admin to adjust tool access policies.]`,
              })
              toolLog.push({ tool: toolName, args: toolArgs, result: `RBAC denied for role ${userRole}`, success: false })
              continue
            }

            const result = await executeTool(toolName, toolArgs, body.workspaceRoot)
            toolLog.push({ tool: toolName, args: toolArgs, result: result.output.slice(0, 2000), success: result.success })
            messages.push({ role: "tool", tool_call_id: tc.id, content: summarizeToolOutput(toolName, result.output, result.success) })
          }

          // ── Phase: observe → reflect ──────────────────────────
          loopCtx.phase = "observe"
          continue  // next round — model gets tool results
        }

        // ── Text-based tool call fallback ─────────────────────────
        if (useTools && msg.content) {
          const textToolCalls = parseTextToolCalls(msg.content)
          if (textToolCalls.length > 0) {
            messages.push({ role: "assistant", content: msg.content })
            loopCtx.phase = "act"

            // ── Parallel execution: batch independent read-only calls ──
            // All read-only tools (and any single call) can run in parallel.
            // Write tools must run sequentially to prevent races.
            const readonlyCalls = textToolCalls.filter(tc => READONLY_TOOLS.has(tc.name))
            const writeCalls = textToolCalls.filter(tc => !READONLY_TOOLS.has(tc.name))

            const allCalls = agentMode === "investigate"
              ? readonlyCalls  // block write tools entirely in investigate mode
              : textToolCalls

            // Filter out duplicates and enforce call limits before executing
            const filteredCalls: typeof allCalls = []
            const blockedResults: Array<{ tool: string; success: boolean; output: string }> = []
            for (const tc of allCalls) {
              const fingerprint = `${tc.name}::${JSON.stringify(tc.args)}`
              const prevFp = loopCtx.toolCallFingerprints.get(tc.name)
              const callCount = (loopCtx.toolCallCounts.get(tc.name) ?? 0)
              if (prevFp === fingerprint && callCount >= 1) {
                console.log(`[chat] Skipping duplicate text tool call: ${tc.name} (round ${round})`)
                blockedResults.push({ tool: tc.name, success: false, output: "[SKIPPED: identical call already executed. Use the previous result or change approach.]" })
                continue
              }
              if (callCount >= modeConfig.maxSameToolCallsPerSession) {
                console.log(`[chat] Text tool call limit for ${tc.name}: ${callCount} calls`)
                blockedResults.push({ tool: tc.name, success: false, output: `[BLOCKED: "${tc.name}" called ${callCount} times — max ${modeConfig.maxSameToolCallsPerSession} per session.]` })
                continue
              }
              if (agentMode === "investigate" && !READONLY_TOOLS.has(tc.name)) {
                blockedResults.push({ tool: tc.name, success: false, output: `[BLOCKED: "${tc.name}" not allowed in investigate mode.]` })
                continue
              }
              loopCtx.toolCallFingerprints.set(tc.name, fingerprint)
              loopCtx.toolCallCounts.set(tc.name, callCount + 1)
              filteredCalls.push(tc)
            }

            // Execute filtered calls — parallel for all read-only, sequential for writes
            const parallelReadOnly = filteredCalls.filter(tc => READONLY_TOOLS.has(tc.name))
            const sequentialWrite = filteredCalls.filter(tc => !READONLY_TOOLS.has(tc.name))

            const toolOutcomes: Array<{ tc: { name: string; args: Record<string, any> }; result: { output: string; success: boolean }; durationMs: number }> = []

            if (parallelReadOnly.length > 0) {
              const t0 = Date.now()
              const parallel = await Promise.all(parallelReadOnly.map(tc =>
                executeTool(tc.name, tc.args, body.workspaceRoot).then(result => ({ tc, result, durationMs: Date.now() - t0 }))
              ))
              toolOutcomes.push(...parallel)
            }

            for (const tc of sequentialWrite) {
              const t0 = Date.now()
              const result = await executeTool(tc.name, tc.args, body.workspaceRoot)
              toolOutcomes.push({ tc, result, durationMs: Date.now() - t0 })
            }

            const roundResults: Array<{ tool: string; success: boolean; output: string }> = [...blockedResults]
            for (const { tc, result } of toolOutcomes) {
              toolLog.push({ tool: tc.name, args: tc.args, result: result.output.slice(0, 2000), success: result.success })
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

            // ── Halt: detect stalled tool outputs ─────────────────
            const outputHash = simpleHash(roundResults.map(r => r.output).join("|"))
            loopCtx.phase = "observe"
            if (outputHash === loopCtx.lastToolOutputHash) {
              loopCtx.stalledRounds++
              if (loopCtx.stalledRounds >= 2) {
                console.log(`[chat] Round ${round}: Tool outputs unchanged for 2 rounds — halting loop`)
                loopCtx.phase = "halt"
                const haltMsg = { role: "user", content: "Tool outputs have not changed. You have enough information to answer — provide your best final response now." }
                messages.push(haltMsg)
                // Don't continue — fall through to final response after pushing halt msg
                // Fire one more model call to get the summary
                const haltReqBody = { ...reqBody, messages }
                try {
                  const haltRes = await providerFetch(endpoint, apiKey, cloudProviderId, haltReqBody, inferenceTimeout)
                  if (haltRes.ok) {
                    const haltData = (await haltRes.json()) as any
                    return logAndReturn(c, haltData, Date.now() - start, originalModelName, providerName, totalInput, totalOutput, toolLog, chatLog, body.sessionId, body.message, budget)
                  }
                } catch {}
                return logAndReturn(c, data, Date.now() - start, originalModelName, providerName, totalInput, totalOutput, toolLog, chatLog, body.sessionId, body.message, budget)
              }
            } else {
              loopCtx.stalledRounds = 0
              loopCtx.lastToolOutputHash = outputHash
            }

            // ── Phase: reflect → next act ─────────────────────────
            const toolResultsText = buildReflectionPrompt(roundResults, round, maxRounds, agentMode)
            messages.push({ role: "user", content: toolResultsText })
            loopCtx.phase = "reflect"
            continue  // next round — model gets reflection prompt + results
          }
        }

        // ── Self-correction: detect lazy responses without tools ───
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

        // ── Phase: respond — no tool calls, return final answer ───
        loopCtx.phase = "respond"
        return logAndReturn(c, data, Date.now() - start, originalModelName, providerName, totalInput, totalOutput, toolLog, chatLog, body.sessionId, body.message, budget)
      }

      // ── Max rounds exceeded ───────────────────────────────────
      loopCtx.phase = "halt"
      return c.json({
        text: "(Reached maximum tool-call rounds. The model may need more iterations.)",
        model: originalModelName,
        provider: providerName,
        tokens: { input: totalInput, output: totalOutput },
        latencyMs: Date.now() - start,
        toolCalls: toolLog,
        warning: `Reached ${maxRounds} tool rounds limit (mode: ${agentMode})`,
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

      const currentUser = (c.get("user") as any) || {}
      let resolved
      try {
        resolved = await resolveModel(body.modelID, body.providerID, currentUser.sub)
      } catch (resolveErr: any) {
        const status = resolveErr.status || 500
        return c.json({ error: resolveErr.message || "Failed to resolve model", model: body.modelID }, status)
      }
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
        // 403 — model restricted at gateway level
        if (res.status === 403) {
          return c.json({ error: "Model access restricted", detail: `The model "${modelApiId}" is not accessible with your API key. This is a gateway policy restriction — select a different model.`, model: modelApiId }, 403)
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

      const currentUser = (c.get("user") as any) || {}
      let resolved
      try {
        resolved = await resolveModel(body.modelID, body.providerID, currentUser.sub)
      } catch (resolveErr: any) {
        const status = resolveErr.status || 500
        return c.json({ error: resolveErr.message || "Failed to resolve model", model: body.modelID }, status)
      }
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
        // 403 — model restricted at gateway level
        if (res.status === 403) {
          return c.json({ error: "Model access restricted", detail: `The model "${modelName}" is not accessible with your API key. This is a gateway policy restriction — select a different model.`, model: modelName, provider: providerName }, 403)
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
              return formatFinalResponse(c, retryData, Date.now() - start, modelName, providerName, 0, 0, [], budget, body.sessionId)
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
      return formatFinalResponse(c, data, Date.now() - start, modelName, providerName, 0, 0, [], budget, body.sessionId)
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
     * POST /api/chat/sessions/register — register a VS Code stream session (no message content)
     * Called by the VS Code extension after each stream-based chat to keep the
     * admin Sessions page in sync with locally-stored VS Code sessions.
     */
    .post("/sessions/register", async (c) => {
      if (!chatLog) return c.json({ ok: false, error: "chat log not available" }, 503)
      const currentUser = (c.get("user") as any) || {}
      const body = await c.req.json().catch(() => ({}))
      const { sessionId, title, model, messageCount } = body
      if (!sessionId || typeof sessionId !== "string") {
        return c.json({ ok: false, error: "sessionId required" }, 400)
      }
      try {
        await chatLog.registerSession({
          sessionId,
          title: title || "(untitled)",
          model: model || "unknown",
          messageCount: Number(messageCount) || 1,
          userId: currentUser.sub,
        })
        return c.json({ ok: true })
      } catch (err: any) {
        return c.json({ ok: false, error: err.message }, 500)
      }
    })

    /**
     * GET /api/chat/sessions — list VS Code extension chat sessions from platform log
     */
    .get("/sessions", async (c) => {
      if (!chatLog) return c.json([])
      const limit = c.req.query("limit") ? Number(c.req.query("limit")) : 50
      const currentUser = (c.get("user") as any) || {}
      return c.json(await chatLog.listSessions(limit, currentUser.sub))
    })

    /**
     * GET /api/chat/sessions/:id — get all messages in a session
     */
    .get("/sessions/:id", async (c) => {
      if (!chatLog) return c.json({ error: "not_found" }, 404)
      const entries = await chatLog.getEntries(c.req.param("id"))
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
  budget?: BudgetManager,
) {
  if (chatLog && sessionId) {
    const text = stripToolBlocks(data.choices?.[0]?.message?.content ?? "")
    const currentUser = (c.get("user") as any) || {}
    try {
      chatLog.store({
        sessionId,
        userMessage,
        assistantReply: text || "(no response)",
        model: modelName,
        toolCallCount: toolLog.length,
        latencyMs,
        userId: currentUser.sub,
      })
    } catch {}
  }
  return formatFinalResponse(c, data, latencyMs, modelName, providerName, extraInput, extraOutput, toolLog, budget, sessionId)
}

/** Log an error response to chat history so it appears in session list. */
function logErrorToChat(
  chatLog: ChatLogStore | undefined,
  sessionId: string | undefined,
  userMessage: string,
  errorDetail: string,
  model: string,
  latencyMs: number,
  userId?: string,
) {
  if (chatLog && sessionId && userMessage) {
    try {
      chatLog.store({
        sessionId,
        userMessage,
        assistantReply: `⚠️ Error: ${errorDetail}`,
        model,
        toolCallCount: 0,
        latencyMs,
        userId,
      })
    } catch {}
  }
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
  budget?: BudgetManager,
  sessionId?: string,
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
  const inputTokens = (usage.prompt_tokens ?? 0) + extraInput
  const outputTokens = (usage.completion_tokens ?? 0) + extraOutput
  if (budget) {
    const currentUser = (c.get("user") as any) || {}
    const userId = currentUser.sub || "default"
    try {
      budget.recordUsage({
        userID: userId,
        tokensInput: inputTokens,
        tokensOutput: outputTokens,
        modelID: modelName,
        sessionID: sessionId,
      })
    } catch {}
  }

  // Include per-stage timing breakdown if available
  const stageTiming = c.get("_stageTimingMs") as Record<string, number> | undefined
  const timingField = stageTiming ? {
    parseMs:        stageTiming.parse,
    policyMs:       stageTiming.policy,
    modelResolveMs: stageTiming.modelResolve,
    preModelMs:     stageTiming.preModel,
    inferenceMs:    latencyMs,
    totalMs:        latencyMs + (stageTiming.preModel ?? 0),
  } : undefined

  return c.json({
    text: text || "(no response)",
    reasoning: reasoning || undefined,
    model: modelName,
    provider: providerName,
    tokens: {
      input: inputTokens,
      output: outputTokens,
    },
    latencyMs,
    toolCalls: toolLog.length > 0 ? toolLog : undefined,
    _timing: timingField,
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
  preferredApiKey?: string,
): Promise<Array<{
  endpoint: string; modelApiId: string; modelName: string; providerName: string
  apiKey: string; contextLimit?: number; outputLimit?: number
}>> {
  const reg = await buildRegistry()
  const gwEndpoint = env.VLLM_GATEWAY_URL ?? ""
  // Use only the user's verified key — no system key fallback
  const gwKey = preferredApiKey || ""

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
  userId?: string,
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

  // Per-user vLLM key REQUIRED — each user must have an admin-verified key.
  // No system key fallback; users without a verified key cannot use local models.
  let userGwKey = ""
  if (userId) {
    try {
      userGwKey = await apiKeyService.getActiveVllmKey(userId) || ""
    } catch {
      userGwKey = ""
    }
  }

  // Helper: resolve endpoint/apiKey for a local provider — always gateway
  function localEndpoint(_p: typeof reg.local[0]) {
    if (!userGwKey) {
      throw Object.assign(
        new Error("Your API key has not been verified by an admin yet, or no key is configured. Please add your infra API key and wait for admin approval."),
        { status: 403 }
      )
    }
    return {
      endpoint: gwEndpoint || _p.endpoint,
      apiKey: userGwKey,
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
