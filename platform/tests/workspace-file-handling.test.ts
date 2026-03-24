/**
 * Workspace & File Handling Test Suite
 *
 * Tests:
 *   1. ToolCallLogger — log file creation, append, read-back
 *   2. WorkspaceManager (extension-side) — context snapshots
 *   3. Platform /api/files routes — integration (requires running server)
 *   4. End-to-end workspace isolation — no paths escape the workspace root
 *
 * Unit tests run without a server.
 * Integration tests are skipped automatically when PLATFORM_URL is not set.
 *
 * Run all:          bun test tests/workspace-file-handling.test.ts
 * Run integration:  PLATFORM_URL=http://localhost:3100 bun test tests/workspace-file-handling.test.ts
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

import { ToolCallLogger }  from "../util/toolCallLogger"
import { PlatformClient }  from "../src/sdk/client"

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const PLATFORM_URL = process.env.PLATFORM_URL ?? ""
const isIntegration = PLATFORM_URL.length > 0

/** Create a fresh temp workspace for each test that needs one. */
function makeTempWorkspace(): string {
  const dir = join(tmpdir(), `thirdwave-ws-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function readJsonl(filePath: string): unknown[] {
  if (!existsSync(filePath)) return []
  return readFileSync(filePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. ToolCallLogger — Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ToolCallLogger", () => {
  let ws: string
  let logger: ToolCallLogger

  beforeEach(() => {
    ws = makeTempWorkspace()
    logger = ToolCallLogger.create(ws)
  })

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true })
  })

  // ── Directory creation ────────────────────────────────────────────────────

  test("creates .thirdwave/logs/ directory automatically", () => {
    expect(existsSync(join(ws, ".thirdwave", "logs"))).toBe(true)
  })

  // ── Tool call logging ─────────────────────────────────────────────────────

  test("logToolCall writes a valid JSONL record", () => {
    logger.logToolCall({ toolName: "bash", toolInput: { command: "ls" } })
    const records = readJsonl(logger.getToolCallsPath())
    expect(records.length).toBe(1)
    const rec = records[0] as Record<string, unknown>
    expect(rec.toolName).toBe("bash")
    expect(typeof rec.id).toBe("string")
    expect(typeof rec.timestamp).toBe("string")
  })

  test("multiple logToolCall calls append to the same file", () => {
    logger.logToolCall({ toolName: "bash",     toolInput: { command: "ls" } })
    logger.logToolCall({ toolName: "edit",     toolInput: { path: "file.ts", content: "x" } })
    logger.logToolCall({ toolName: "webfetch", toolInput: { url: "https://example.com" } })
    const records = readJsonl(logger.getToolCallsPath())
    expect(records.length).toBe(3)
  })

  test("IDs are unique across calls", () => {
    for (let i = 0; i < 10; i++) {
      logger.logToolCall({ toolName: "bash", toolInput: { command: `echo ${i}` } })
    }
    const records = readJsonl(logger.getToolCallsPath()) as Array<{ id: string }>
    const ids = records.map(r => r.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(10)
  })

  test("logToolCall stores optional HITL fields", () => {
    logger.logToolCall({
      toolName: "bash",
      toolInput: { command: "rm -rf /tmp/trash" },
      hitlApproved: false,
      riskScore: 95,
      error: "Denied by HITL",
    })
    const records = readJsonl(logger.getToolCallsPath()) as Array<Record<string, unknown>>
    expect(records[0].hitlApproved).toBe(false)
    expect(records[0].riskScore).toBe(95)
    expect(records[0].error).toBe("Denied by HITL")
  })

  test("timestamps are valid ISO 8601 strings", () => {
    logger.logToolCall({ toolName: "list", toolInput: { dir: "." } })
    const records = readJsonl(logger.getToolCallsPath()) as Array<{ timestamp: string }>
    const ts = records[0].timestamp
    expect(() => new Date(ts)).not.toThrow()
    expect(new Date(ts).toISOString()).toBe(ts)
  })

  // ── traceToolCall ─────────────────────────────────────────────────────────

  test("traceToolCall logs result and duration on success", async () => {
    await logger.traceToolCall({ toolName: "bash", toolInput: "ls" }, async () => "file1\nfile2")
    const records = readJsonl(logger.getToolCallsPath()) as Array<Record<string, unknown>>
    expect(records[0].toolOutput).toBe("file1\nfile2")
    expect(typeof records[0].durationMs).toBe("number")
    expect((records[0].durationMs as number)).toBeGreaterThanOrEqual(0)
  })

  test("traceToolCall logs error and re-throws on failure", async () => {
    let threw = false
    try {
      await logger.traceToolCall({ toolName: "bash", toolInput: "bad" }, async () => {
        throw new Error("command not found")
      })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
    const records = readJsonl(logger.getToolCallsPath()) as Array<Record<string, unknown>>
    expect(records[0].error).toBe("command not found")
  })

  // ── File operation logging ────────────────────────────────────────────────

  test("logFileOp writes a valid JSONL record", () => {
    logger.logFileOp({ operation: "create", path: "/ws/src/new.ts", success: true })
    const records = readJsonl(logger.getFileOpsPath())
    expect(records.length).toBe(1)
    const rec = records[0] as Record<string, unknown>
    expect(rec.operation).toBe("create")
    expect(rec.path).toBe("/ws/src/new.ts")
    expect(rec.success).toBe(true)
  })

  test("logFileOp records failed operations with error message", () => {
    logger.logFileOp({
      operation: "delete",
      path: "/ws/protected.ts",
      success: false,
      blocked: true,
      error: "Denied by policy engine",
    })
    const records = readJsonl(logger.getFileOpsPath()) as Array<Record<string, unknown>>
    expect(records[0].blocked).toBe(true)
    expect(records[0].error).toBe("Denied by policy engine")
  })

  test("all FileOp operations are loggable", () => {
    const ops = ["read", "write", "create", "delete", "rename", "list", "stat"] as const
    for (const op of ops) {
      logger.logFileOp({ operation: op, path: "/ws/file.ts", success: true })
    }
    const records = readJsonl(logger.getFileOpsPath()) as Array<{ operation: string }>
    const logged = records.map(r => r.operation)
    for (const op of ops) {
      expect(logged).toContain(op)
    }
  })

  // ── Read-back helpers ─────────────────────────────────────────────────────

  test("readToolCalls returns last N records", () => {
    for (let i = 0; i < 50; i++) {
      logger.logToolCall({ toolName: "bash", toolInput: { command: `echo ${i}` } })
    }
    const last10 = logger.readToolCalls(10)
    expect(last10.length).toBe(10)
  })

  test("readFileOps returns empty array when no ops logged", () => {
    const result = logger.readFileOps()
    expect(result).toEqual([])
  })

  test("readToolCalls returns empty array before any calls", () => {
    const fresh = ToolCallLogger.create(makeTempWorkspace())
    expect(fresh.readToolCalls()).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Workspace Isolation — Unit Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Workspace Isolation", () => {
  /**
   * These tests validate the expectation that all file-op log entries
   * produced within a bounded workspace stay inside that workspace root.
   */

  test("all logged file paths stay within the workspace root", () => {
    const ws = makeTempWorkspace()
    const logger = ToolCallLogger.create(ws)

    // Simulate the agent doing legit file work inside the workspace
    const legitPaths = [
      `${ws}/src/index.ts`,
      `${ws}/src/utils/helper.ts`,
      `${ws}/README.md`,
      `${ws}/package.json`,
    ]
    for (const path of legitPaths) {
      logger.logFileOp({ operation: "read", path, success: true })
    }

    const records = logger.readFileOps() as Array<{ path: string }>
    for (const rec of records) {
      // Every path must start with the workspace root
      expect(rec.path.startsWith(ws) || rec.path.startsWith(".thirdwave")).toBe(true)
    }

    rmSync(ws, { recursive: true, force: true })
  })

  test("paths outside workspace root are detectable via log scan", () => {
    const ws = makeTempWorkspace()
    const logger = ToolCallLogger.create(ws)

    // Log one legitimate + one escaped path
    logger.logFileOp({ operation: "read", path: `${ws}/README.md`, success: true })
    logger.logFileOp({ operation: "read", path: "/etc/passwd",     success: true })

    const records = logger.readFileOps() as Array<{ path: string }>
    const escaped = records.filter(r => !r.path.startsWith(ws))
    expect(escaped.length).toBe(1)
    expect(escaped[0].path).toBe("/etc/passwd")

    rmSync(ws, { recursive: true, force: true })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Platform Integration Tests  (only run when PLATFORM_URL is set)
// ─────────────────────────────────────────────────────────────────────────────

describe("Platform /api/files [integration]", () => {
  const client = isIntegration ? new PlatformClient({ baseUrl: PLATFORM_URL }) : null

  test.skipIf(!isIntegration)("GET /health returns a healthy response", async () => {
    const res = await client!.health()
    expect(res).toBeDefined()
    expect(typeof res).toBe("object")
  })

  test.skipIf(!isIntegration)("GET /api/files lists workspace root", async () => {
    const files = await client!.listFiles()
    expect(Array.isArray(files)).toBe(true)
    expect(files.length).toBeGreaterThan(0)
  })

  test.skipIf(!isIntegration)("GET /api/files returns entries with name and type", async () => {
    const files = await client!.listFiles() as Array<{ name: string; type: string }>
    for (const entry of files.slice(0, 5)) {
      expect(typeof entry.name).toBe("string")
      expect(["file", "directory"]).toContain(entry.type)
    }
  })

  test.skipIf(!isIntegration)("POST /api/sessions creates a new session", async () => {
    const session = await client!.createSession({ agentID: "test-agent" })
    expect(typeof session.id).toBe("string")
    expect(session.id.length).toBeGreaterThan(0)
    // Cleanup
    await client!.deleteSession(session.id)
  })

  test.skipIf(!isIntegration)("GET /api/sessions lists sessions", async () => {
    const sessions = await client!.listSessions()
    expect(Array.isArray(sessions)).toBe(true)
  })

  test.skipIf(!isIntegration)("GET /api/audit returns entries array", async () => {
    const entries = await client!.queryAudit({ limit: 5 })
    expect(Array.isArray(entries)).toBe(true)
  })

  test.skipIf(!isIntegration)("GET /api/budget returns budget status", async () => {
    const budget = await client!.budgetSummary()
    expect(typeof budget).toBe("object")
  })

  test.skipIf(!isIntegration)("GET /api/hitl/pending returns array", async () => {
    const res = await fetch(`${PLATFORM_URL}/api/hitl/pending`)
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. HITL Approval Flow — Integration (requires PLATFORM_URL)
// ─────────────────────────────────────────────────────────────────────────────

describe("HITL Approval Flow [integration]", () => {
  test.skipIf(!isIntegration)("POST /api/hitl/mode sets autonomy mode", async () => {
    const res = await fetch(`${PLATFORM_URL}/api/hitl/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "default", mode: "supervised" }),
    })
    expect(res.status).toBe(200)
    // Restore
    await fetch(`${PLATFORM_URL}/api/hitl/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "default", mode: "semi_autonomous" }),
    })
  })

  test.skipIf(!isIntegration)("pending HITL approvals can be listed and denied via API", async () => {
    // First check there are pending approvals (there may be none in a clean state)
    const listRes = await fetch(`${PLATFORM_URL}/api/hitl/pending`)
    const pending = await listRes.json() as Array<{ id: string }>
    if (pending.length === 0) return   // Nothing to deny — that's fine

    const firstId = pending[0].id
    const denyRes = await fetch(`${PLATFORM_URL}/api/hitl/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalId: firstId, decision: "deny", reason: "test" }),
    })
    expect(denyRes.status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Log file format contract
// ─────────────────────────────────────────────────────────────────────────────

describe("Log File Format Contract", () => {
  /**
   * These tests document the exact JSON shape that external tools
   * (dashboards, CI checks, audit scripts) can rely on.
   */

  let ws: string
  let logger: ToolCallLogger

  beforeEach(() => {
    ws = makeTempWorkspace()
    logger = ToolCallLogger.create(ws)
  })

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true })
  })

  test("tool-calls.jsonl records always have id, timestamp, toolName, toolInput", () => {
    logger.logToolCall({ toolName: "bash", toolInput: { command: "ls" } })
    const records = readJsonl(logger.getToolCallsPath()) as Array<Record<string, unknown>>
    const rec = records[0]
    expect(rec).toHaveProperty("id")
    expect(rec).toHaveProperty("timestamp")
    expect(rec).toHaveProperty("toolName")
    expect(rec).toHaveProperty("toolInput")
  })

  test("file-ops.jsonl records always have id, timestamp, operation, path, success", () => {
    logger.logFileOp({ operation: "read", path: "/ws/file.ts", success: true })
    const records = readJsonl(logger.getFileOpsPath()) as Array<Record<string, unknown>>
    const rec = records[0]
    expect(rec).toHaveProperty("id")
    expect(rec).toHaveProperty("timestamp")
    expect(rec).toHaveProperty("operation")
    expect(rec).toHaveProperty("path")
    expect(rec).toHaveProperty("success")
  })

  test("each JSONL line is independently parseable (no multi-line JSON)", () => {
    for (let i = 0; i < 5; i++) {
      logger.logToolCall({ toolName: "bash", toolInput: { cmd: `echo ${i}` } })
    }
    const raw = readFileSync(logger.getToolCallsPath(), "utf8")
    const lines = raw.trim().split("\n")
    expect(lines.length).toBe(5)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  test("log files survive process restart (data is persisted to disk)", () => {
    logger.logToolCall({ toolName: "edit", toolInput: { path: "app.ts" } })
    // Create a new logger instance pointing at the same directory
    const logger2 = ToolCallLogger.create(ws)
    const records = logger2.readToolCalls()
    expect(records.length).toBe(1)
    expect(records[0].toolName).toBe("edit")
  })
})
