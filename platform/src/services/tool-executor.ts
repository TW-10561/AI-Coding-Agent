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
import { defaultPolicyEngine, isSensitiveFile } from "./policy-engine"
import type { HITLService } from "./hitl-service"

// ── HITL integration ─────────────────────────────────────────────────
// Set by the server at startup so tools can trigger approval requests.
let _hitl: HITLService | null = null
export function setToolHITL(hitl: HITLService) { _hitl = hitl }

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
        "List directory contents. Returns entries sorted (directories first, then files) with size. Automatically filters noise directories (node_modules, .git, etc.).",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or project-relative directory path (default: project root)",
          },
          recursive: {
            type: "boolean",
            description: "List recursively up to 3 levels deep (default: false)",
          },
          depth: {
            type: "number",
            description: "Max depth for recursive listing (1-5, default: 1, or 3 if recursive=true)",
          },
        },
        required: [],
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
  {
    type: "function",
    function: {
      name: "git_status",
      description: "Get git status of the project — shows branch, modified files, staged changes, and untracked files.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "git_diff",
      description: "Show git diff — changed lines in working directory or staged changes. Optionally diff a specific file.",
      parameters: {
        type: "object",
        properties: {
          staged: { type: "boolean", description: "Show staged (cached) diff instead of working directory" },
          file: { type: "string", description: "Specific file to diff (relative or absolute path)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "git_log",
      description: "Show recent git commit history (oneline format with decorations).",
      parameters: {
        type: "object",
        properties: {
          count: { type: "number", description: "Number of commits to show (default: 10, max: 50)" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "file_exists",
      description: "Check whether a file or directory exists at the given path. Use this BEFORE read_file or list_dir to avoid unnecessary errors when the existence of the path is uncertain.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or project-relative file or directory path to check",
          },
        },
        required: ["path"],
      },
    },
  },
  // ── New tools (Phase 1 — RBAC-tracked in tool_metadata) ────────────
  {
    type: "function",
    function: {
      name: "edit",
      description:
        "Edit a specific section of a file by replacing old text with new text. Safer than write_file for targeted changes — preserves the rest of the file. Use for surgical edits.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path (absolute or project-relative)" },
          oldText: { type: "string", description: "Exact text to find and replace (must match exactly, including whitespace)" },
          newText: { type: "string", description: "Replacement text" },
        },
        required: ["path", "oldText", "newText"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "multiedit",
      description:
        "Apply multiple edits across one or more files in a single call. Each edit specifies a file, old text, and new text. All edits are applied atomically — if one fails, all are rolled back.",
      parameters: {
        type: "object",
        properties: {
          edits: {
            type: "array",
            description: "Array of edits to apply",
            items: {
              type: "object",
              properties: {
                path: { type: "string", description: "File path" },
                oldText: { type: "string", description: "Text to find" },
                newText: { type: "string", description: "Replacement text" },
              },
              required: ["path", "oldText", "newText"],
            },
          },
        },
        required: ["edits"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_patch",
      description:
        "Apply a unified diff patch to a file. Use standard unified diff format (output of `diff -u` or `git diff`). Handles context lines and line offsets.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File to patch" },
          patch: { type: "string", description: "Unified diff content (starts with --- and +++)" },
        },
        required: ["path", "patch"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "glob",
      description:
        "Find files matching a glob pattern. Returns matching file paths. Use for discovering files by extension, name pattern, or directory structure.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob pattern (e.g. '**/*.ts', 'src/**/*.test.*', '*.json')" },
          path: { type: "string", description: "Base directory to search from (default: project root)" },
          maxResults: { type: "number", description: "Max results to return (default: 100)" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "codesearch",
      description:
        "Semantic code search — find function definitions, class declarations, imports, type definitions, and symbol references. More precise than grep for code structure queries.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for (e.g. 'function handleAuth', 'class UserService', 'import express')" },
          path: { type: "string", description: "Directory to search in (default: project root)" },
          language: { type: "string", description: "Filter by language (e.g. 'typescript', 'python', 'rust')" },
          maxResults: { type: "number", description: "Max results (default: 20)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "websearch",
      description:
        "Search the web for information. Returns search results with titles, URLs, and snippets. Use for finding documentation, Stack Overflow answers, or API references.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          maxResults: { type: "number", description: "Max results (default: 5)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "batch",
      description:
        "Execute multiple independent tool calls in parallel. Use when you need to perform several operations that don't depend on each other (e.g. read multiple files, search + list simultaneously).",
      parameters: {
        type: "object",
        properties: {
          calls: {
            type: "array",
            description: "Array of tool calls to execute in parallel",
            items: {
              type: "object",
              properties: {
                tool: { type: "string", description: "Tool name to call" },
                args: { type: "object", description: "Arguments for the tool" },
              },
              required: ["tool", "args"],
            },
          },
        },
        required: ["calls"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "task",
      description:
        "Create a background task for long-running operations. The task is queued and executed asynchronously. Use for operations that may take a long time (builds, test suites, deployments).",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title for the task" },
          command: { type: "string", description: "Shell command to execute" },
          timeout: { type: "number", description: "Timeout in ms (default: 300000 = 5 min)" },
        },
        required: ["title", "command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "plan",
      description:
        "Create a structured execution plan for a complex task. Breaks down the task into numbered steps with descriptions. Use this to organize multi-step work before executing.",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string", description: "What you want to accomplish" },
          steps: {
            type: "array",
            description: "Ordered list of steps",
            items: {
              type: "object",
              properties: {
                step: { type: "number", description: "Step number" },
                action: { type: "string", description: "What to do" },
                tool: { type: "string", description: "Which tool to use (optional)" },
              },
              required: ["step", "action"],
            },
          },
        },
        required: ["goal", "steps"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "question",
      description:
        "Ask the user a clarifying question before proceeding. Use when the request is ambiguous, requires a choice between alternatives, or needs more information to proceed correctly.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "The question to ask the user" },
          options: {
            type: "array",
            description: "Optional list of choices for the user",
            items: { type: "string" },
          },
          context: { type: "string", description: "Brief context about why you're asking" },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "skill",
      description:
        "Load a skill (knowledge module) into context for specialized guidance. Skills provide best practices for specific domains like testing, debugging, API design, etc. List available skills or load one by name.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", description: "'list' to see available skills, 'load' to load a specific skill" },
          name: { type: "string", description: "Skill name to load (required when action='load')" },
        },
        required: ["action"],
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
const AGENT_WORKSPACE = env.AGENT_WORKSPACE_DIR ?? `${PROJECT_DIR}/.agent-workspace`

// Ensure the agent workspace directory exists on startup
try {
  const { mkdirSync } = require("fs")
  mkdirSync(AGENT_WORKSPACE, { recursive: true })
} catch {}

function resolvePath(p: string, wsRoot?: string): string {
  const baseDir = getProjectDir(wsRoot)
  const resolved = p.startsWith("/") ? p : `${baseDir}/${p}`
  const { resolve: pathResolve } = require("path")
  const { realpathSync, existsSync } = require("fs")
  const normalized = pathResolve(resolved)
  // Resolve symlinks to prevent traversal via symlinked paths
  const real = existsSync(normalized) ? realpathSync(normalized) : normalized
  if (!real.startsWith(baseDir) && !real.startsWith(PROJECT_DIR) && !real.startsWith(AGENT_WORKSPACE) && !real.startsWith("/tmp")) {
    throw new Error(`Path traversal denied: ${p} resolves outside project root`)
  }
  return real
}

function truncateOutput(s: string, max = MAX_OUTPUT): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false }
  return {
    text: s.slice(0, max) + `\n\n... (truncated, ${s.length - max} bytes omitted)`,
    truncated: true,
  }
}

// ── HITL approval helper ─────────────────────────────────────────────
// When a tool triggers "ask", we poll the HITL service for approval/denial
// up to a timeout (default 2 minutes). This lets the agentic loop block
// until the user approves or denies in the extension UI.

const HITL_POLL_INTERVAL = 1000   // 1 second
const HITL_POLL_TIMEOUT  = 120_000 // 2 minutes

async function awaitHITLApproval(requestId: string): Promise<"approved" | "denied" | "expired"> {
  if (!_hitl) return "denied"
  const start = Date.now()
  while (Date.now() - start < HITL_POLL_TIMEOUT) {
    const req = _hitl.getRequest(requestId)
    if (!req) {
      // Request was resolved (moved to resolved list) — check resolved list
      const resolved = _hitl.getResolved(10)
      const found = resolved.find(r => r.id === requestId)
      if (found) return found.status === "approved" ? "approved" : "denied"
      return "expired"
    }
    if (req.status !== "pending") {
      return req.status === "approved" ? "approved" : "denied"
    }
    await new Promise(resolve => setTimeout(resolve, HITL_POLL_INTERVAL))
  }
  return "expired"
}

/**
 * Run HITL evaluation. Returns "allow" to proceed, or a ToolResult for deny/expired.
 * For "ask", waits for user approval.
 */
async function hitlCheck(ctx: {
  action: string
  command?: string
  filePath?: string
  url?: string
  diffSize?: number
}): Promise<{ proceed: true } | ToolResult> {
  try {
    if (_hitl) {
      const hitlResult = _hitl.evaluate(ctx)
      if (hitlResult.decision === "deny") {
        return { success: false, output: `⛔ SECURITY RESTRICTION: ${hitlResult.reasons.join("; ")}. You MUST tell the user this file/action is restricted for security purposes. Do NOT claim the file does not exist.` }
      }
      if (hitlResult.decision === "ask" && hitlResult.approvalRequest) {
        const verdict = await awaitHITLApproval(hitlResult.approvalRequest.id)
        if (verdict === "approved") return { proceed: true }
        return { success: false, output: verdict === "expired"
          ? `⏳ HITL approval timed out (${hitlResult.approvalRequest.id}): ${hitlResult.reasons.join("; ")}`
          : `❌ HITL denied (${hitlResult.approvalRequest.id}): ${hitlResult.reasons.join("; ")}` }
      }
    } else {
      const policy = defaultPolicyEngine.evaluate({
        command: ctx.command,
        filePath: ctx.filePath,
        url: ctx.url,
        diffSize: ctx.diffSize,
      })
      if (policy.decision === "deny") {
        return { success: false, output: `⛔ SECURITY RESTRICTION: ${policy.reasons.join("; ")}. You MUST tell the user this file/action is restricted for security purposes. Do NOT claim the file does not exist.` }
      }
    }
  } catch {}
  return { proceed: true }
}

// ── Individual tool handlers ─────────────────────────────────────────

async function execBash(args: { command: string; timeout?: number; workdir?: string }, wsRoot?: string): Promise<ToolResult> {
  const command = args.command
  const cwd = args.workdir ? resolvePath(args.workdir, wsRoot) : getProjectDir(wsRoot)
  const timeout = Math.min(args.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)

  // Check if bash command references sensitive files (bypass prevention)
  const cmdTokens = command.split(/[\s|;&><]+/)
  for (const token of cmdTokens) {
    if (token && isSensitiveFile(token)) {
      return {
        success: false,
        output: `⛔ SECURITY RESTRICTION: The file "${token}" is a sensitive/protected file. Access is denied by security policy. You MUST tell the user: "Access to this file is restricted for security purposes." Do NOT claim the file does not exist.`,
      }
    }
  }

  // Policy + HITL check
  const check = await hitlCheck({ action: "bash", command })
  if (!("proceed" in check)) return check

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

async function execReadFile(args: { path: string; startLine?: number; endLine?: number }, wsRoot?: string): Promise<ToolResult> {
  const filepath = resolvePath(args.path, wsRoot)

  // Policy + HITL check
  const check = await hitlCheck({ action: "read", filePath: filepath })
  if (!("proceed" in check)) return check as ToolResult

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

async function execWriteFile(args: { path: string; content: string }, wsRoot?: string): Promise<ToolResult> {
  // For relative paths, write into the project directory (same as read_file).
  // Absolute paths are resolved against the project root as before.
  const filepath = resolvePath(args.path, wsRoot)

  if (!args.content && args.content !== "") {
    return { success: false, output: `write_file error: no content provided for ${args.path}` }
  }

  // Policy + HITL check — only pass diffSize for large files (>10KB) to avoid
  // triggering elevated risk for every normal write
  const contentSize = args.content?.length ?? 0
  const check = await hitlCheck({ action: "edit", filePath: filepath, diffSize: contentSize > 10000 ? contentSize : undefined })
  if (!("proceed" in check)) return check

  try {
    // Ensure parent directories exist
    const dir = filepath.replace(/\/[^/]+$/, "")
    const { mkdirSync } = await import("fs")
    try { mkdirSync(dir, { recursive: true }) } catch {}

    await Bun.write(filepath, args.content)
    const lineCount = args.content.split("\n").length
    const sizeKB = Math.round(contentSize / 1024)
    const sizeNote = sizeKB > 50 ? ` (${sizeKB}KB)` : ""
    return { success: true, output: `Wrote ${lineCount} lines${sizeNote} to ${args.path}` }
  } catch (e: any) {
    return { success: false, output: `Write error: ${e.message ?? e}` }
  }
}

async function execFileExists(args: { path: string }, wsRoot?: string): Promise<ToolResult> {
  try {
    const resolved = resolvePath(args.path, wsRoot)
    const { existsSync, statSync } = await import("fs")
    if (!existsSync(resolved)) {
      return { success: true, output: `NOT_FOUND: ${args.path} does not exist` }
    }
    const stat = statSync(resolved)
    const kind = stat.isDirectory() ? "directory" : "file"
    return { success: true, output: `EXISTS: ${args.path} is a ${kind} (${stat.isDirectory() ? '' : stat.size + ' bytes'})`.trimEnd() }
  } catch (e: any) {
    // Path traversal check throws — treat as not found
    if (e.message?.includes('Path traversal')) return { success: true, output: `NOT_FOUND: ${args.path} is outside the project root` }
    return { success: false, output: `Check error: ${e.message ?? e}` }
  }
}

async function execListDir(args: { path?: string; recursive?: boolean; depth?: number }, wsRoot?: string): Promise<ToolResult> {
  const dirpath = resolvePath(args.path || ".", wsRoot)
  try {
    const { readdirSync, statSync, existsSync } = await import("fs")
    // Pre-check: return a clear error if directory does not exist
    if (!existsSync(dirpath)) {
      return { success: false, output: `Directory not found: "${args.path || '.'}". Use file_exists to check paths before listing, or list_dir on a parent directory to see what exists.` }
    }
    if (!statSync(dirpath).isDirectory()) {
      return { success: false, output: `Not a directory: "${args.path}". Use read_file to read a file's contents.` }
    }
    const entries = readdirSync(dirpath)
    const results: string[] = []
    for (const entry of entries.slice(0, 500)) {
      try {
        const stat = statSync(`${dirpath}/${entry}`)
        const type = stat.isDirectory() ? "dir" : "file"
        const size = stat.isFile() ? ` (${stat.size} bytes)` : ""
        const restricted = isSensitiveFile(entry) ? " [RESTRICTED - sensitive file]" : ""
        results.push(`  ${type === "dir" ? entry + "/" : entry}${size}${restricted}`)
      } catch {
        results.push(`  ${entry} (stat failed)`)
      }
    }
    const header = `Directory: ${args.path || "."} (${entries.length} entries${entries.length > 500 ? ", showing first 500" : ""})\n`
    return { success: true, output: header + results.join("\n") }
  } catch (e: any) {
    return { success: false, output: `List error: ${e.message ?? e}` }
  }
}


async function execGrepSearch(args: { pattern: string; path?: string; include?: string; maxResults?: number }, wsRoot?: string): Promise<ToolResult> {
  const searchPath = args.path ? resolvePath(args.path, wsRoot) : getProjectDir(wsRoot)
  const maxResults = args.maxResults ?? 50

  // Block grep on sensitive files
  if (args.path && isSensitiveFile(args.path)) {
    return { success: false, output: `⛔ SECURITY RESTRICTION: "${args.path}" is a sensitive/protected file. Access denied by security policy. Tell the user this file is restricted.` }
  }

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
    // Make paths relative to project and filter out sensitive file matches
    const relative = lines
      .map((l) => l.replace(getProjectDir(wsRoot) + "/", ""))
      .filter((l) => !isSensitiveFile(l.split(":")[0] ?? ""))
    const { text, truncated } = truncateOutput(relative.join("\n"))
    return { success: true, output: `${relative.length} matches:\n${text}`, truncated }
  } catch (e: any) {
    return { success: false, output: `Search error: ${e.message ?? e}` }
  }
}

async function execWebFetch(args: { url: string; maxBytes?: number }): Promise<ToolResult> {
  const maxBytes = args.maxBytes ?? MAX_OUTPUT

  // Policy + HITL check
  const check = await hitlCheck({ action: "web_fetch", url: args.url })
  if (!("proceed" in check)) return check

  try {
    const resp = await fetch(args.url, {
      headers: { "User-Agent": "Thirdwave-AI/1.0" },
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

// ── Git tools ────────────────────────────────────────────────────────

async function execGitStatus(_args: Record<string, unknown>, wsRoot?: string): Promise<ToolResult> {
  try {
    const proc = Bun.spawn(["git", "status", "--porcelain", "-b"], {
      cwd: getProjectDir(wsRoot),
      stdout: "pipe",
      stderr: "pipe",
    })
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited
    if (exitCode !== 0) return { success: false, output: stderr || "Not a git repository" }
    if (!stdout.trim()) return { success: true, output: "Working tree clean (no changes)" }
    return { success: true, output: stdout }
  } catch (e: any) {
    return { success: false, output: `Git error: ${e.message ?? e}` }
  }
}

async function execGitDiff(args: { staged?: boolean; file?: string }, wsRoot?: string): Promise<ToolResult> {
  try {
    const gitArgs = ["git", "diff"]
    if (args.staged) gitArgs.push("--cached")
    if (args.file) gitArgs.push("--", resolvePath(args.file, wsRoot))
    gitArgs.push("--stat")

    const proc = Bun.spawn(gitArgs, {
      cwd: getProjectDir(wsRoot),
      stdout: "pipe",
      stderr: "pipe",
    })
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited
    if (exitCode !== 0) return { success: false, output: stderr || "Git diff failed" }

    // Also get the actual diff (limited)
    const diffProc = Bun.spawn([...gitArgs.filter(a => a !== "--stat")], {
      cwd: getProjectDir(wsRoot),
      stdout: "pipe",
      stderr: "pipe",
    })
    const diffOut = await new Response(diffProc.stdout).text()
    await diffProc.exited

    const combined = stdout.trim() + (diffOut.trim() ? "\n\n" + diffOut.trim() : "")
    if (!combined.trim()) return { success: true, output: "No differences" }
    const { text, truncated } = truncateOutput(combined)
    return { success: true, output: text, truncated }
  } catch (e: any) {
    return { success: false, output: `Git error: ${e.message ?? e}` }
  }
}

async function execGitLog(args: { count?: number }, wsRoot?: string): Promise<ToolResult> {
  try {
    const n = Math.min(args.count ?? 10, 50)
    const proc = Bun.spawn(["git", "log", `--oneline`, `-${n}`, "--decorate"], {
      cwd: getProjectDir(wsRoot),
      stdout: "pipe",
      stderr: "pipe",
    })
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited
    if (exitCode !== 0) return { success: false, output: stderr || "Git log failed" }
    return { success: true, output: stdout || "No commits" }
  } catch (e: any) {
    return { success: false, output: `Git error: ${e.message ?? e}` }
  }
}

// ── Dispatcher ───────────────────────────────────────────────────

// ── Edit tool — surgical find-and-replace ────────────────────────────

async function execEdit(args: { path: string; oldText: string; newText: string }, wsRoot?: string): Promise<ToolResult> {
  const filepath = resolvePath(args.path, wsRoot)

  const check = await hitlCheck({ action: "edit", filePath: filepath })
  if (!("proceed" in check)) return check

  try {
    const file = Bun.file(filepath)
    if (!(await file.exists())) {
      return { success: false, output: `File not found: ${args.path}` }
    }
    const content = await file.text()
    const idx = content.indexOf(args.oldText)
    if (idx === -1) {
      return { success: false, output: `edit failed: oldText not found in ${args.path}. Make sure the text matches exactly (including whitespace and newlines).` }
    }
    // Check for multiple matches
    const secondIdx = content.indexOf(args.oldText, idx + 1)
    if (secondIdx !== -1) {
      return { success: false, output: `edit failed: oldText matches multiple locations in ${args.path}. Add more surrounding context to make it unique.` }
    }
    const updated = content.slice(0, idx) + args.newText + content.slice(idx + args.oldText.length)
    await Bun.write(filepath, updated)
    return { success: true, output: `Edited ${args.path}: replaced ${args.oldText.length} chars with ${args.newText.length} chars` }
  } catch (e: any) {
    return { success: false, output: `Edit error: ${e.message ?? e}` }
  }
}

// ── Multiedit tool — batch edits with rollback ───────────────────────

async function execMultiedit(args: { edits: Array<{ path: string; oldText: string; newText: string }> }, wsRoot?: string): Promise<ToolResult> {
  if (!args.edits || !Array.isArray(args.edits) || args.edits.length === 0) {
    return { success: false, output: "multiedit: no edits provided" }
  }

  // Save originals for rollback
  const originals = new Map<string, string>()
  const results: string[] = []

  try {
    for (const edit of args.edits) {
      const filepath = resolvePath(edit.path, wsRoot)

      const check = await hitlCheck({ action: "edit", filePath: filepath })
      if (!("proceed" in check)) return check

      const file = Bun.file(filepath)
      if (!(await file.exists())) {
        throw new Error(`File not found: ${edit.path}`)
      }

      // Read original (cache to avoid re-reading if editing same file multiple times)
      let content = originals.get(filepath)
      if (content === undefined) {
        content = await file.text()
        originals.set(filepath, content)
      }

      const idx = content.indexOf(edit.oldText)
      if (idx === -1) {
        throw new Error(`oldText not found in ${edit.path}`)
      }

      content = content.slice(0, idx) + edit.newText + content.slice(idx + edit.oldText.length)
      // Update in-memory state for subsequent edits to same file
      originals.set(filepath, content)
      await Bun.write(filepath, content)
      results.push(`  ✓ ${edit.path}: replaced ${edit.oldText.length} → ${edit.newText.length} chars`)
    }

    return { success: true, output: `Applied ${args.edits.length} edits:\n${results.join("\n")}` }
  } catch (e: any) {
    // Rollback: restore originals
    for (const [filepath, original] of originals) {
      try { await Bun.write(filepath, original) } catch {}
    }
    return { success: false, output: `multiedit rolled back: ${e.message ?? e}` }
  }
}

// ── Apply patch tool — unified diff ──────────────────────────────────

async function execApplyPatch(args: { path: string; patch: string }, wsRoot?: string): Promise<ToolResult> {
  const filepath = resolvePath(args.path, wsRoot)

  const check = await hitlCheck({ action: "edit", filePath: filepath })
  if (!("proceed" in check)) return check

  try {
    // Write patch to temp file and apply with `patch` command
    const tmpPatch = `/tmp/thirdwave-patch-${Date.now()}.diff`
    await Bun.write(tmpPatch, args.patch)

    const proc = Bun.spawn(["patch", "--no-backup-if-mismatch", filepath, tmpPatch], {
      cwd: getProjectDir(wsRoot),
      stdout: "pipe",
      stderr: "pipe",
    })
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    // Clean up temp file
    try { const { unlinkSync } = await import("fs"); unlinkSync(tmpPatch) } catch {}

    if (exitCode !== 0) {
      return { success: false, output: `Patch failed:\n${stderr || stdout}` }
    }
    return { success: true, output: `Patched ${args.path}:\n${stdout}` }
  } catch (e: any) {
    return { success: false, output: `Patch error: ${e.message ?? e}` }
  }
}

// ── Glob tool — find files by pattern ────────────────────────────────

async function execGlob(args: { pattern: string; path?: string; maxResults?: number }, wsRoot?: string): Promise<ToolResult> {
  const baseDir = args.path ? resolvePath(args.path, wsRoot) : getProjectDir(wsRoot)
  const maxResults = args.maxResults ?? 100

  try {
    const { Glob } = require("bun")
    const glob = new Glob(args.pattern)
    const matches: string[] = []

    for (const match of glob.scanSync({ cwd: baseDir, absolute: false })) {
      // Skip noise directories
      if (match.includes("node_modules/") || match.includes(".git/")) continue
      matches.push(match)
      if (matches.length >= maxResults) break
    }

    if (matches.length === 0) {
      return { success: true, output: `No files match "${args.pattern}" in ${args.path || "."}` }
    }
    matches.sort()
    const { text, truncated } = truncateOutput(matches.join("\n"))
    return { success: true, output: `${matches.length} matches:\n${text}`, truncated }
  } catch (e: any) {
    return { success: false, output: `Glob error: ${e.message ?? e}` }
  }
}

// ── Codesearch tool — symbol-aware grep ──────────────────────────────

async function execCodesearch(args: { query: string; path?: string; language?: string; maxResults?: number }, wsRoot?: string): Promise<ToolResult> {
  const searchPath = args.path ? resolvePath(args.path, wsRoot) : getProjectDir(wsRoot)
  const maxResults = args.maxResults ?? 20

  // Build language-specific include patterns
  const langMap: Record<string, string> = {
    typescript: "*.ts", javascript: "*.js", python: "*.py", rust: "*.rs",
    go: "*.go", java: "*.java", cpp: "*.cpp", c: "*.c", ruby: "*.rb",
    php: "*.php", swift: "*.swift", kotlin: "*.kt", css: "*.css",
    html: "*.html", yaml: "*.yml", json: "*.json", sql: "*.sql",
  }

  // Build regex patterns for common code structures
  const query = args.query
  const patterns: string[] = []

  // Direct search
  patterns.push(query)

  // Also search for common definition patterns
  const words = query.replace(/^(function|class|type|interface|import|export|const|let|var|def|fn)\s+/i, "").trim()
  if (words !== query) {
    patterns.push(words) // Also search the bare identifier
  }

  try {
    const grepArgs = ["grep", "-rn", "--color=never", "-m", String(maxResults * 3)]
    if (args.language && langMap[args.language.toLowerCase()]) {
      grepArgs.push(`--include=${langMap[args.language.toLowerCase()]}`)
    }
    // Exclude noise
    grepArgs.push("--exclude-dir=node_modules", "--exclude-dir=.git", "--exclude-dir=dist", "--exclude-dir=build")
    grepArgs.push("-e", patterns[0]!)
    for (const p of patterns.slice(1)) {
      grepArgs.push("-e", p)
    }
    grepArgs.push(searchPath)

    const proc = Bun.spawn(grepArgs, { stdout: "pipe", stderr: "pipe" })
    const stdout = await new Response(proc.stdout).text()
    await proc.exited

    if (!stdout.trim()) {
      return { success: true, output: `No code matches for "${args.query}"${args.language ? ` in ${args.language} files` : ""}` }
    }

    const lines = stdout.trim().split("\n")
    // Make paths relative and filter sensitive files
    const relative = lines
      .map(l => l.replace(getProjectDir(wsRoot) + "/", ""))
      .filter(l => !isSensitiveFile(l.split(":")[0] ?? ""))
      .slice(0, maxResults)

    const { text, truncated } = truncateOutput(relative.join("\n"))
    return { success: true, output: `${relative.length} code matches:\n${text}`, truncated }
  } catch (e: any) {
    return { success: false, output: `Codesearch error: ${e.message ?? e}` }
  }
}

// ── Websearch tool — search the web ──────────────────────────────────

async function execWebsearch(args: { query: string; maxResults?: number }): Promise<ToolResult> {
  const maxResults = args.maxResults ?? 5

  // Policy + HITL check
  const check = await hitlCheck({ action: "web_fetch", url: `search:${args.query}` })
  if (!("proceed" in check)) return check

  try {
    // Use DuckDuckGo HTML search (no API key required)
    const q = encodeURIComponent(args.query)
    const resp = await fetch(`https://html.duckduckgo.com/html/?q=${q}`, {
      headers: { "User-Agent": "Thirdwave-AI/1.0" },
      signal: AbortSignal.timeout(10_000),
    })
    if (!resp.ok) {
      return { success: false, output: `Search failed: HTTP ${resp.status}` }
    }
    const html = await resp.text()

    // Parse results from DuckDuckGo HTML
    const results: Array<{ title: string; url: string; snippet: string }> = []
    const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi
    let match
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      const url = decodeURIComponent((match[1] ?? "").replace(/.*uddg=/, "").replace(/&.*/, ""))
      const title = (match[2] ?? "").replace(/<[^>]+>/g, "").trim()
      const snippet = (match[3] ?? "").replace(/<[^>]+>/g, "").trim()
      if (url && title) {
        results.push({ title, url, snippet })
      }
    }

    if (results.length === 0) {
      return { success: true, output: `No search results for "${args.query}"` }
    }

    const formatted = results.map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
    ).join("\n\n")
    return { success: true, output: `Search results for "${args.query}":\n\n${formatted}` }
  } catch (e: any) {
    return { success: false, output: `Search error: ${e.message ?? e}` }
  }
}

// ── Batch tool — parallel execution ──────────────────────────────────

async function execBatch(args: { calls: Array<{ tool: string; args: Record<string, unknown> }> }, wsRoot?: string): Promise<ToolResult> {
  if (!args.calls || !Array.isArray(args.calls) || args.calls.length === 0) {
    return { success: false, output: "batch: no tool calls provided" }
  }
  if (args.calls.length > 10) {
    return { success: false, output: "batch: max 10 parallel calls allowed" }
  }

  // Policy + HITL check
  const check = await hitlCheck({ action: "batch" })
  if (!("proceed" in check)) return check

  const results = await Promise.allSettled(
    args.calls.map(async (call, i) => {
      const handler = TOOL_HANDLERS[call.tool]
      if (!handler) return { index: i, tool: call.tool, result: { success: false, output: `Unknown tool: ${call.tool}` } as ToolResult }
      const result = await handler(call.args, wsRoot)
      return { index: i, tool: call.tool, result }
    })
  )

  const output = results.map((r, i) => {
    if (r.status === "fulfilled") {
      const v = r.value
      return `[${i + 1}] ${v.tool}: ${v.result.success ? "✓" : "✗"}\n${v.result.output}`
    }
    return `[${i + 1}] ${args.calls[i]!.tool}: ✗ (crashed: ${r.reason})`
  }).join("\n\n---\n\n")

  const allSuccess = results.every(r => r.status === "fulfilled" && r.value.result.success)
  return { success: allSuccess, output: `Batch (${args.calls.length} calls):\n\n${output}` }
}

// ── Task tool — queue a background task ──────────────────────────────

async function execTask(args: { title: string; command: string; timeout?: number }, wsRoot?: string): Promise<ToolResult> {
  const check = await hitlCheck({ action: "bash", command: args.command })
  if (!("proceed" in check)) return check

  const timeout = Math.min(args.timeout ?? 300_000, 600_000) // max 10 min
  const cwd = getProjectDir(wsRoot)

  try {
    const proc = Bun.spawn(["bash", "-c", args.command], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env as Record<string, string>, HOME: process.env.HOME ?? "/root" },
    })

    const timer = setTimeout(() => {
      try { proc.kill("SIGTERM") } catch {}
      setTimeout(() => { try { proc.kill("SIGKILL") } catch {} }, 3000)
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
    if (!output) output = exitCode === 0 ? "(completed, no output)" : `Exit code: ${exitCode}`

    const { text, truncated } = truncateOutput(output)
    return {
      success: exitCode === 0,
      output: `Task "${args.title}" ${exitCode === 0 ? "completed" : "failed (exit " + exitCode + ")"}:\n${text}`,
      truncated,
    }
  } catch (e: any) {
    return { success: false, output: `Task error: ${e.message ?? e}` }
  }
}

// ── Plan tool — structured execution plan ────────────────────────────

async function execPlan(args: { goal: string; steps: Array<{ step: number; action: string; tool?: string }> }): Promise<ToolResult> {
  if (!args.goal || !args.steps || args.steps.length === 0) {
    return { success: false, output: "plan: provide a goal and at least one step" }
  }

  const formatted = args.steps.map(s =>
    `  ${s.step}. ${s.action}${s.tool ? ` [tool: ${s.tool}]` : ""}`
  ).join("\n")

  return {
    success: true,
    output: `📋 Plan: ${args.goal}\n\n${formatted}\n\nReady to execute. Proceed step by step.`,
  }
}

// ── Question tool — ask user for clarification ───────────────────────

async function execQuestion(args: { question: string; options?: string[]; context?: string }): Promise<ToolResult> {
  let output = `❓ ${args.question}`
  if (args.context) output = `Context: ${args.context}\n\n${output}`
  if (args.options && args.options.length > 0) {
    output += "\n\nOptions:\n" + args.options.map((o, i) => `  ${i + 1}. ${o}`).join("\n")
  }
  return { success: true, output }
}

// ── Skill tool — load knowledge modules ──────────────────────────────

let _skillManager: { search: (q: string, n: number) => Array<{ skill: { id: string; displayName: string; description: string }; relevance: number }>; get: (id: string) => { content: string; displayName: string } | undefined; list: () => Array<{ id: string; displayName: string; description: string; category: string }> } | null = null
export function setSkillManager(sm: any) { _skillManager = sm }

async function execSkill(args: { action: string; name?: string }): Promise<ToolResult> {
  if (!_skillManager) {
    return { success: false, output: "Skill manager not initialized" }
  }

  if (args.action === "list") {
    const skills = _skillManager.list()
    if (skills.length === 0) return { success: true, output: "No skills installed" }
    const formatted = skills.map(s => `  • ${s.displayName} (${s.id}) — ${s.description}`).join("\n")
    return { success: true, output: `Available skills (${skills.length}):\n${formatted}` }
  }

  if (args.action === "load" && args.name) {
    const skill = _skillManager.get(args.name)
    if (!skill) {
      // Try search
      const results = _skillManager.search(args.name, 1)
      if (results.length > 0) {
        const found = _skillManager.get(results[0]!.skill.id)
        if (found) {
          const { text, truncated } = truncateOutput(found.content, 30_000)
          return { success: true, output: `Skill: ${found.displayName}\n\n${text}`, truncated }
        }
      }
      return { success: false, output: `Skill "${args.name}" not found. Use skill(action="list") to see available skills.` }
    }
    const { text, truncated } = truncateOutput(skill.content, 30_000)
    return { success: true, output: `Skill: ${skill.displayName}\n\n${text}`, truncated }
  }

  return { success: false, output: 'skill: action must be "list" or "load" (with name)' }
}

// ── Handler registry ─────────────────────────────────────────────────

const TOOL_HANDLERS: Record<string, (args: any, wsRoot?: string) => Promise<ToolResult>> = {
  bash: execBash,
  read_file: execReadFile,
  write_file: execWriteFile,
  list_dir: execListDir,
  file_exists: execFileExists,
  grep_search: execGrepSearch,
  web_fetch: execWebFetch,
  git_status: execGitStatus,
  git_diff: execGitDiff,
  git_log: execGitLog,
  // Phase 1 tools
  edit: execEdit,
  multiedit: execMultiedit,
  apply_patch: execApplyPatch,
  glob: execGlob,
  codesearch: execCodesearch,
  websearch: execWebsearch,
  batch: execBatch,
  task: execTask,
  plan: execPlan,
  question: execQuestion,
  skill: execSkill,
  // Aliases (PLAN names → existing tools)
  read: execReadFile,
  write: execWriteFile,
  ls: execListDir,
  grep: execGrepSearch,
  webfetch: execWebFetch,
}

// Allow the chat route to override the workspace root dynamically
let _workspaceRoot: string | null = null
export function setWorkspaceRoot(root: string | null) { _workspaceRoot = root }
function getProjectDir(wsRoot?: string): string { return wsRoot || _workspaceRoot || PROJECT_DIR }

/**
 * Execute a tool call returned by the model.
 * Optionally accepts a workspaceRoot to override the default PROJECT_DIR.
 */
export async function executeTool(name: string, args: Record<string, unknown>, workspaceRoot?: string): Promise<ToolResult> {
  const handler = TOOL_HANDLERS[name]
  if (!handler) {
    return { success: false, output: `Unknown tool: ${name}. Available: ${Object.keys(TOOL_HANDLERS).join(", ")}` }
  }

  // Pass workspaceRoot directly to the handler instead of mutating global state.
  // This prevents race conditions when multiple tools execute in parallel.
  try {
    return await handler(args, workspaceRoot || undefined)
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
