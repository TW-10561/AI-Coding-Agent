// ---------------------------------------------------------------------------
// ToolCallLogger — Dedicated file logger for tool calls and file operations.
//
// Why a separate logger?
//   util/log.ts writes to stdout (transient, console only).
//   src/services/audit-logger.ts writes to SQLite (good for querying, but not
//   human-readable at a glance during development).
//   This module writes append-only JSONL files you can `tail -f` in a terminal
//   while the agent is running — one file per concern:
//
//     .thirdwave/logs/tool-calls.jsonl   — every tool invocation
//     .thirdwave/logs/file-ops.jsonl     — every file create/read/write/delete
//
// Usage (server-side):
//   import { ToolCallLogger } from "../util/toolCallLogger"
//   const logger = ToolCallLogger.create()
//   logger.logToolCall({ toolName: "bash", toolInput: { command: "ls" }, sessionId })
//   logger.logFileOp({ operation: "write", path: "/repo/src/index.ts", sessionId })
// ---------------------------------------------------------------------------

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs"
import { join, resolve } from "path"

// ── Types ────────────────────────────────────────────────────────────────────

export type ToolCallRecord = {
  id: string
  timestamp: string
  sessionId?: string
  agentId?: string
  /** Name of the tool as reported by OpenCode, e.g. "bash", "edit", "webfetch" */
  toolName: string
  /** Raw tool input object passed by the model */
  toolInput: unknown
  /** Result returned by the tool (may be omitted if async / fire-and-forget) */
  toolOutput?: unknown
  /** Wall-clock execution time in milliseconds */
  durationMs?: number
  /** Set when the tool call threw or the tool reported an error */
  error?: string
  /** HITL decision: undefined = no check needed, true = approved, false = denied */
  hitlApproved?: boolean
  /** Risk score assigned by the RiskEngine (0-100) */
  riskScore?: number
}

export type FileOpRecord = {
  id: string
  timestamp: string
  sessionId?: string
  agentId?: string
  /** Filesystem operation performed by the agent */
  operation: "read" | "write" | "create" | "delete" | "rename" | "list" | "stat"
  /** Absolute or workspace-relative file/directory path */
  path: string
  /** Destination path for rename operations */
  destinationPath?: string
  /** Approximate file size touched (bytes) */
  sizeBytes?: number
  /** Whether the operation completed without error */
  success: boolean
  /** Error message if success=false */
  error?: string
  /** true when HITL / policy engine blocked this operation */
  blocked?: boolean
  /** Risk score if assessed */
  riskScore?: number
  /** Whether the path matched a sensitive-file pattern */
  isSensitive?: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────────

let _counter = 0

function generateId(prefix: string): string {
  const ts = Date.now().toString(36)
  const seq = (++_counter).toString(36).padStart(4, "0")
  return `${prefix}_${ts}_${seq}`
}

function appendJsonl(filePath: string, record: unknown): void {
  try {
    appendFileSync(filePath, JSON.stringify(record) + "\n", "utf8")
  } catch {
    // Non-fatal — dev logging should never crash the server
  }
}

// ── ToolCallLogger class ─────────────────────────────────────────────────────

export class ToolCallLogger {
  private toolCallsFile: string
  private fileOpsFile: string

  private constructor(logDir: string) {
    this.toolCallsFile = join(logDir, "tool-calls.jsonl")
    this.fileOpsFile   = join(logDir, "file-ops.jsonl")
  }

  /**
   * Create a logger that writes into `<baseDir>/.thirdwave/logs/`.
   * `baseDir` defaults to the process working directory.
   */
  static create(baseDir?: string): ToolCallLogger {
    const root   = resolve(baseDir ?? process.cwd())
    const logDir = join(root, ".thirdwave", "logs")
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true })
    }
    return new ToolCallLogger(logDir)
  }

  // ── Tool call API ──────────────────────────────────────────────────────────

  logToolCall(opts: Omit<ToolCallRecord, "id" | "timestamp">): ToolCallRecord {
    const record: ToolCallRecord = {
      id:        generateId("tc"),
      timestamp: new Date().toISOString(),
      ...opts,
    }
    appendJsonl(this.toolCallsFile, record)
    return record
  }

  /**
   * Convenience wrapper: start a tool call timer, execute `fn`, then log result.
   *
   * Example:
   *   const result = await logger.traceToolCall({ toolName: "bash", toolInput: cmd }, () => run(cmd))
   */
  async traceToolCall<T>(
    opts: Omit<ToolCallRecord, "id" | "timestamp" | "toolOutput" | "durationMs" | "error">,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = Date.now()
    try {
      const result = await fn()
      this.logToolCall({ ...opts, toolOutput: result, durationMs: Date.now() - start })
      return result
    } catch (err) {
      this.logToolCall({
        ...opts,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }

  // ── File operation API ─────────────────────────────────────────────────────

  logFileOp(opts: Omit<FileOpRecord, "id" | "timestamp">): FileOpRecord {
    const record: FileOpRecord = {
      id:        generateId("fo"),
      timestamp: new Date().toISOString(),
      ...opts,
    }
    appendJsonl(this.fileOpsFile, record)
    return record
  }

  // ── Reader helpers (for /api/logs routes or test assertions) ───────────────

  readToolCalls(limit = 100): ToolCallRecord[] {
    return this._readJsonl<ToolCallRecord>(this.toolCallsFile, limit)
  }

  readFileOps(limit = 100): FileOpRecord[] {
    return this._readJsonl<FileOpRecord>(this.fileOpsFile, limit)
  }

  getToolCallsPath(): string { return this.toolCallsFile }
  getFileOpsPath(): string   { return this.fileOpsFile }

  private _readJsonl<T>(filePath: string, limit: number): T[] {
    if (!existsSync(filePath)) return []
    const lines = readFileSync(filePath, "utf8").trim().split("\n").filter(Boolean)
    return lines
      .slice(-limit)
      .map(line => { try { return JSON.parse(line) as T } catch { return null } })
      .filter((x): x is T => x !== null)
  }
}

// ── Singleton for convenience ─────────────────────────────────────────────────

let _default: ToolCallLogger | null = null

/** Returns (and lazily creates) a process-wide singleton logger. */
export function getToolCallLogger(): ToolCallLogger {
  if (!_default) {
    _default = ToolCallLogger.create()
  }
  return _default
}
