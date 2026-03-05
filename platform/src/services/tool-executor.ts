// ---------------------------------------------------------------------------
// Tool Executor — Executes AI agent tools (bash, file, search, web, etc.)
//
// This is the standalone tool-calling layer that integrates with the chat
// route.  When a vLLM model returns `tool_calls`, the chat route invokes
// this executor, feeds results back, and lets the model iterate.
//
// Tools:
//   1. bash          — run shell commands (policy-gated)
//   2. read_file     — read a file or range
//   3. write_file    — write / patch a file
//   4. list_dir      — list directory contents
//   5. grep_search   — search files with regex/text
//   6. web_fetch     — fetch a URL (policy-gated)
// ---------------------------------------------------------------------------

import { env } from "../config/env"
import { defaultPolicyEngine } from "./policy-engine"

// ── Tool definitions (OpenAI function-calling schema) ────────────────

export interface ToolDef {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export const TOOL_DEFINITIONS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "bash",
      description:
        "Execute a shell command. Use this for running code, installing packages, git operations, file manipulation, and system tasks. Commands run in the project directory by default.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute",
          },
          timeout: {
            type: "number",
            description: "Timeout in milliseconds (default: 30000, max: 120000)",
          },
          workdir: {
            type: "string",
            description: "Working directory (default: project root)",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read the contents of a file. Specify startLine/endLine for partial reads. Returns file text and line count.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or project-relative file path",
          },
          startLine: {
            type: "number",
            description: "First line to read (1-indexed, default: 1)",
          },
          endLine: {
            type: "number",
            description: "Last line to read (inclusive, default: EOF)",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Write content to a file. Creates the file and parent directories if they don't exist. If the file exists, it will be overwritten.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or project-relative file path",
          },
          content: {
            type: "string",
            description: "Full file content to write",
          },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description:
        "List directory contents. Returns entries with type (file/directory) and size.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or project-relative directory path",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep_search",
      description:
        "Search files for a pattern using grep. Returns matching lines with file paths and line numbers. Use for finding code, function definitions, imports, etc.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Search pattern (regex supported)",
          },
          path: {
            type: "string",
            description: "Directory or file to search in (default: project root)",
          },
          include: {
            type: "string",
            description: "File glob pattern (e.g. '*.ts', '*.py')",
          },
          maxResults: {
            type: "number",
            description: "Max results to return (default: 50)",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description:
        "Fetch content from a URL. Returns the text body. Useful for reading documentation, APIs, or web pages.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch",
          },
          maxBytes: {
            type: "number",
            description: "Max response bytes to return (default: 50000)",
          },
        },
        required: ["url"],
      },
    },
  },
]

// ── Tool Execution ───────────────────────────────────────────────────

export interface ToolResult {
  success: boolean
  output: string
  truncated?: boolean
}

const MAX_OUTPUT = 50_000 // 50 KB per tool call
const DEFAULT_TIMEOUT = 30_000
const MAX_TIMEOUT = 120_000
const PROJECT_DIR = env.OPENCODE_DIR

function resolvePath(p: string): string {
  if (p.startsWith("/")) return p
  return `${PROJECT_DIR}/${p}`
}

function truncateOutput(s: string, max = MAX_OUTPUT): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false }
  return {
    text: s.slice(0, max) + `\n\n... (truncated, ${s.length - max} bytes omitted)`,
    truncated: true,
  }
}

// ── Individual tool handlers ─────────────────────────────────────────

async function execBash(args: { command: string; timeout?: number; workdir?: string }): Promise<ToolResult> {
  const command = args.command
  const cwd = args.workdir ? resolvePath(args.workdir) : PROJECT_DIR
  const timeout = Math.min(args.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)

  // Policy check: destructive commands
  try {
    const policy = defaultPolicyEngine.evaluate({ command })
    if (policy.decision === "deny") {
      return { success: false, output: `Policy denied: ${policy.reasons.join("; ")}` }
    }
  } catch {}

  try {
    const proc = Bun.spawn(["bash", "-c", command], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env as Record<string, string>, HOME: process.env.HOME ?? "/root" },
    })

    // Timeout handling
    const timer = setTimeout(() => {
      try { proc.kill("SIGTERM") } catch {}
      setTimeout(() => { try { proc.kill("SIGKILL") } catch {} }, 2000)
    }, timeout)

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const exitCode = await proc.exited
    clearTimeout(timer)

    let output = ""
    if (stdout.trim()) output += stdout
    if (stderr.trim()) output += (output ? "\n" : "") + stderr
    if (!output) output = exitCode === 0 ? "(no output)" : `Exit code: ${exitCode}`

    const { text, truncated } = truncateOutput(output)
    return {
      success: exitCode === 0,
      output: exitCode === 0 ? text : `Exit code ${exitCode}:\n${text}`,
      truncated,
    }
  } catch (e: any) {
    return { success: false, output: `Execution error: ${e.message ?? e}` }
  }
}

async function execReadFile(args: { path: string; startLine?: number; endLine?: number }): Promise<ToolResult> {
  const filepath = resolvePath(args.path)

  // Policy check: sensitive files
  try {
    const policy = defaultPolicyEngine.evaluate({ filePath: filepath })
    if (policy.decision === "deny") {
      return { success: false, output: `Policy denied: ${policy.reasons.join("; ")}` }
    }
  } catch {}

  try {
    const file = Bun.file(filepath)
    if (!(await file.exists())) {
      return { success: false, output: `File not found: ${args.path}` }
    }

    const text = await file.text()
    const lines = text.split("\n")
    const start = Math.max(1, args.startLine ?? 1) - 1
    const end = Math.min(lines.length, args.endLine ?? lines.length)
    const slice = lines.slice(start, end)

    const header = `File: ${args.path} (${lines.length} lines total, showing ${start + 1}-${end})\n`
    const { text: content, truncated } = truncateOutput(header + slice.join("\n"))
    return { success: true, output: content, truncated }
  } catch (e: any) {
    return { success: false, output: `Read error: ${e.message ?? e}` }
  }
}

async function execWriteFile(args: { path: string; content: string }): Promise<ToolResult> {
  const filepath = resolvePath(args.path)

  // Policy check: sensitive files
  try {
    const policy = defaultPolicyEngine.evaluate({ filePath: filepath })
    if (policy.decision === "deny") {
      return { success: false, output: `Policy denied: ${policy.reasons.join("; ")}` }
    }
  } catch {}

  try {
    // Ensure parent directories exist
    const dir = filepath.replace(/\/[^/]+$/, "")
    const { mkdirSync } = await import("fs")
    try { mkdirSync(dir, { recursive: true }) } catch {}

    await Bun.write(filepath, args.content)
    const lineCount = args.content.split("\n").length
    return { success: true, output: `Wrote ${lineCount} lines to ${args.path}` }
  } catch (e: any) {
    return { success: false, output: `Write error: ${e.message ?? e}` }
  }
}

async function execListDir(args: { path: string }): Promise<ToolResult> {
  const dirpath = resolvePath(args.path)
  try {
    const { readdirSync, statSync } = await import("fs")
    const entries = readdirSync(dirpath)
    const results: string[] = []
    for (const entry of entries.slice(0, 200)) {
      try {
        const stat = statSync(`${dirpath}/${entry}`)
        const type = stat.isDirectory() ? "dir" : "file"
        const size = stat.isFile() ? ` (${stat.size} bytes)` : ""
        results.push(`  ${type === "dir" ? entry + "/" : entry}${size}`)
      } catch {
        results.push(`  ${entry} (stat failed)`)
      }
    }
    const header = `Directory: ${args.path} (${entries.length} entries${entries.length > 200 ? ", showing first 200" : ""})\n`
    return { success: true, output: header + results.join("\n") }
  } catch (e: any) {
    return { success: false, output: `List error: ${e.message ?? e}` }
  }
}

async function execGrepSearch(args: { pattern: string; path?: string; include?: string; maxResults?: number }): Promise<ToolResult> {
  const searchPath = args.path ? resolvePath(args.path) : PROJECT_DIR
  const maxResults = args.maxResults ?? 50

  try {
    const grepArgs = ["grep", "-rn", "--color=never"]
    if (args.include) grepArgs.push(`--include=${args.include}`)
    grepArgs.push("-m", String(maxResults * 2)) // get extras before filtering
    grepArgs.push("-e", args.pattern, searchPath)

    const proc = Bun.spawn(grepArgs, {
      stdout: "pipe",
      stderr: "pipe",
    })

    const stdout = await new Response(proc.stdout).text()
    await proc.exited

    if (!stdout.trim()) {
      return { success: true, output: `No matches found for "${args.pattern}"` }
    }

    const lines = stdout.trim().split("\n").slice(0, maxResults)
    // Make paths relative to project
    const relative = lines.map((l) => l.replace(PROJECT_DIR + "/", ""))
    const { text, truncated } = truncateOutput(relative.join("\n"))
    return { success: true, output: `${lines.length} matches:\n${text}`, truncated }
  } catch (e: any) {
    return { success: false, output: `Search error: ${e.message ?? e}` }
  }
}

async function execWebFetch(args: { url: string; maxBytes?: number }): Promise<ToolResult> {
  const maxBytes = args.maxBytes ?? MAX_OUTPUT

  // Policy check: network guard
  try {
    const policy = defaultPolicyEngine.evaluate({ url: args.url })
    if (policy.decision === "deny") {
      return { success: false, output: `Policy denied: ${policy.reasons.join("; ")}` }
    }
  } catch {}

  try {
    const resp = await fetch(args.url, {
      headers: { "User-Agent": "Artemis-AI/1.0" },
      signal: AbortSignal.timeout(15_000),
    })
    if (!resp.ok) {
      return { success: false, output: `HTTP ${resp.status}: ${resp.statusText}` }
    }
    const text = await resp.text()
    const { text: content, truncated } = truncateOutput(text, maxBytes)
    return { success: true, output: content, truncated }
  } catch (e: any) {
    return { success: false, output: `Fetch error: ${e.message ?? e}` }
  }
}

// ── Dispatcher ───────────────────────────────────────────────────

const TOOL_HANDLERS: Record<string, (args: any) => Promise<ToolResult>> = {
  bash: execBash,
  read_file: execReadFile,
  write_file: execWriteFile,
  list_dir: execListDir,
  grep_search: execGrepSearch,
  web_fetch: execWebFetch,
}

/**
 * Execute a tool call returned by the model.
 */
export async function executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const handler = TOOL_HANDLERS[name]
  if (!handler) {
    return { success: false, output: `Unknown tool: ${name}. Available: ${Object.keys(TOOL_HANDLERS).join(", ")}` }
  }

  try {
    return await handler(args)
  } catch (e: any) {
    return { success: false, output: `Tool ${name} crashed: ${e.message ?? e}` }
  }
}

/**
 * Get tool definitions suitable for the OpenAI tools parameter.
 */
export function getToolDefinitions(): ToolDef[] {
  return TOOL_DEFINITIONS
}
