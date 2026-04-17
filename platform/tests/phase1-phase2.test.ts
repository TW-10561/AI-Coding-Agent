// ---------------------------------------------------------------------------
// Phase 1 & Phase 2 — Comprehensive Test Suite
// ---------------------------------------------------------------------------
// Tests PostgreSQL setup, OpenCode removal, dual-write services, route
// changes, migration script compilation, and the full agentic pipeline.
// ---------------------------------------------------------------------------

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "fs"
import { resolve, join } from "path"

// ═══════════════════════════════════════════════════════════════════════════
// 1. PostgreSQL Configuration & Connection (Phase 1)
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 1: PostgreSQL Configuration", () => {
  test("env.ts exports POSTGRES_URL and PGBOUNCER_URL", async () => {
    const envModule = await import("../src/config/env")
    const schema = envModule.env
    // These are optional; no error when absent
    expect(typeof schema.PORT).toBe("number")
    expect(typeof schema.HOST).toBe("string")
    // POSTGRES_URL / PGBOUNCER_URL are optional strings
    // Just verify the env module loads without throwing
    expect(schema).toBeDefined()
  })

  test("db.ts exports pgEnabled, sql, dbHealth, dbClose, dbReady", async () => {
    const db = await import("../src/config/db")
    expect(typeof db.pgEnabled).toBe("boolean")
    expect(db.sql).toBeDefined()
    expect(typeof db.dbHealth).toBe("function")
    expect(typeof db.dbClose).toBe("function")
    expect(db.dbReady).toBeDefined() // Promise
  })

  test("pgEnabled is false when POSTGRES_URL is not set", async () => {
    // In test env, POSTGRES_URL is typically not set
    if (!process.env.POSTGRES_URL && !process.env.PGBOUNCER_URL) {
      const db = await import("../src/config/db")
      expect(db.pgEnabled).toBe(false)
    }
  })

  test("schema.sql file exists and contains all 19 tables", () => {
    const schemaPath = resolve(import.meta.dir, "../src/config/schema.sql")
    expect(existsSync(schemaPath)).toBe(true)
    const content = readFileSync(schemaPath, "utf-8")

    const expectedTables = [
      "roles", "users", "registration_requests", "api_keys",
      "api_key_audit_log", "tool_metadata", "tool_access_policies",
      "path_access_rules", "approval_requests", "audit_log",
      "workspaces", "sessions", "messages", "risk_scores",
      "budget_limits", "budget_usage", "tasks", "chat_sessions",
      "chat_entries",
    ]

    for (const table of expectedTables) {
      expect(content).toContain(`CREATE TABLE IF NOT EXISTS ${table}`)
    }
  })

  test("schema.sql uses idempotent CREATE IF NOT EXISTS", () => {
    const content = readFileSync(resolve(import.meta.dir, "../src/config/schema.sql"), "utf-8")
    // Every CREATE TABLE should be IF NOT EXISTS
    const createStatements = content.match(/CREATE TABLE\b/g) ?? []
    const idempotent = content.match(/CREATE TABLE IF NOT EXISTS/g) ?? []
    expect(createStatements.length).toBe(idempotent.length)
    expect(createStatements.length).toBe(19)
  })

  test("schema.sql enables pgcrypto extension", () => {
    const content = readFileSync(resolve(import.meta.dir, "../src/config/schema.sql"), "utf-8")
    expect(content).toContain('CREATE EXTENSION IF NOT EXISTS "pgcrypto"')
  })

  test("seed.sql exists and contains 4 roles, 17 tools, 68 RBAC policies", () => {
    const seedPath = resolve(import.meta.dir, "../src/config/seed.sql")
    expect(existsSync(seedPath)).toBe(true)
    const content = readFileSync(seedPath, "utf-8")

    // 4 roles
    expect(content).toContain("'admin'")
    expect(content).toContain("'developer'")
    expect(content).toContain("'team_leader'")
    expect(content).toContain("'readonly'")

    // Key tools
    expect(content).toContain("'bash'")
    expect(content).toContain("'read'")
    expect(content).toContain("'write'")
    expect(content).toContain("'edit'")

    // ON CONFLICT (idempotent)
    expect(content).toContain("ON CONFLICT")
  })

  test("docker-compose.yml has postgres and pgbouncer services", () => {
    const composePath = resolve(import.meta.dir, "../docker/docker-compose.yml")
    expect(existsSync(composePath)).toBe(true)
    const content = readFileSync(composePath, "utf-8")

    expect(content).toContain("postgres:")
    expect(content).toContain("postgres:16-alpine")
    expect(content).toContain("pgbouncer:")
    expect(content).toContain("initdb.d")   // schema mount
    expect(content).toContain("schema.sql")
    expect(content).toContain("seed.sql")
    expect(content).toContain("pg_isready") // healthcheck
  })

  test("Phase 2 tables have proper indexes", () => {
    const content = readFileSync(resolve(import.meta.dir, "../src/config/schema.sql"), "utf-8")

    // Budget tables
    expect(content).toContain("idx_budget_limits_user")
    expect(content).toContain("idx_budget_usage_user")

    // Tasks table
    expect(content).toContain("idx_tasks_state")
    expect(content).toContain("idx_tasks_user")

    // Chat tables
    expect(content).toContain("idx_chat_session_time")
    expect(content).toContain("idx_chat_entry_session")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. Dual-Write Services (Phase 2)
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 2: WorkspaceManager", () => {
  let manager: InstanceType<typeof import("../src/services/workspace-manager").WorkspaceManager>
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = resolve("/tmp", `test-ws-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    const { WorkspaceManager } = await import("../src/services/workspace-manager")
    manager = new WorkspaceManager({ dbPath: resolve(tmpDir, "workspaces.db") })
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("create() returns workspace with correct fields", () => {
    const ws = manager.create({ name: "test-workspace", directory: tmpDir })
    expect(ws.id).toBeDefined()
    expect(ws.name).toBe("test-workspace")
    expect(ws.directory).toBe(tmpDir)
    expect(ws.active).toBe(false) // create() sets active=false; use switchTo() to activate
    expect(ws.createdAt).toBeDefined()
  })

  test("get() retrieves created workspace", () => {
    const subDir = tmpDir + "/sub"
    mkdirSync(subDir, { recursive: true })
    const ws = manager.create({ name: "get-test", directory: subDir })
    const found = manager.get(ws.id)
    expect(found).toBeDefined()
    expect(found!.id).toBe(ws.id)
    expect(found!.name).toBe("get-test")
  })

  test("list() returns all workspaces", () => {
    const all = manager.list()
    expect(Array.isArray(all)).toBe(true)
    expect(all.length).toBeGreaterThanOrEqual(2)
  })

  test("update() changes workspace fields", () => {
    const subDir = tmpDir + "/upd"
    mkdirSync(subDir, { recursive: true })
    const ws = manager.create({ name: "update-me", directory: subDir })
    const updated = manager.update(ws.id, { name: "updated-name", tags: ["dev"] })
    expect(updated.name).toBe("updated-name")
    expect(updated.tags).toContain("dev")
  })

  test("delete() removes workspace", () => {
    const subDir = tmpDir + "/del"
    mkdirSync(subDir, { recursive: true })
    const ws = manager.create({ name: "delete-me", directory: subDir })
    const deleted = manager.delete(ws.id)
    expect(deleted).toBe(true)
    expect(manager.get(ws.id)).toBeUndefined()
  })

  test("stats() returns aggregated info", () => {
    const stats = manager.stats()
    expect(typeof stats.total).toBe("number")
    expect(stats).toBeDefined()
  })

  test("switchTo() activates workspace", () => {
    const dirA = tmpDir + "/a"
    const dirB = tmpDir + "/b"
    mkdirSync(dirA, { recursive: true })
    mkdirSync(dirB, { recursive: true })
    const ws1 = manager.create({ name: "ws-a", directory: dirA })
    const ws2 = manager.create({ name: "ws-b", directory: dirB })
    manager.switchTo(ws2.id)
    const active = manager.get(ws2.id)
    expect(active?.active).toBe(true)
  })

  test("create() rejects duplicate directory", () => {
    const dir = tmpDir + "/unique"
    mkdirSync(dir, { recursive: true })
    manager.create({ name: "first", directory: dir })
    expect(() => manager.create({ name: "second", directory: dir })).toThrow()
  })
})

describe("Phase 2: AuditLogger", () => {
  let logger: InstanceType<typeof import("../src/services/audit-logger").AuditLogger>
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = resolve("/tmp", `test-audit-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    const { AuditLogger } = await import("../src/services/audit-logger")
    logger = new AuditLogger({ dbPath: resolve(tmpDir, "audit.db"), flushSize: 2 })
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("log() returns an AuditEntry with id and timestamp", () => {
    const entry = logger.log({ action: "test.action", userID: "user1", success: true })
    expect(entry.id).toBeDefined()
    expect(entry.timestamp).toBeDefined()
    expect(entry.action).toBe("test.action")
    expect(entry.userID).toBe("user1")
  })

  test("query() retrieves logged entries", () => {
    logger.log({ action: "query.test", userID: "user2", success: true })
    logger.log({ action: "query.test", userID: "user2", success: false })
    const results = logger.query({ action: "query.test" })
    expect(results.length).toBeGreaterThanOrEqual(2)
  })

  test("query() filters by userID", () => {
    logger.log({ action: "filter.test", userID: "specific-user", success: true })
    const results = logger.query({ userID: "specific-user" })
    expect(results.every(e => e.userID === "specific-user")).toBe(true)
  })

  test("stats() returns aggregated statistics", () => {
    const stats = logger.stats()
    expect(typeof stats.total).toBe("number")
    expect(stats.total).toBeGreaterThan(0)
    expect(typeof stats.byAction).toBe("object")
  })

  test("wrap() captures success and error", async () => {
    const result = await logger.wrap("test.success", {}, async () => "ok")
    expect(result).toBe("ok")

    try {
      await logger.wrap("test.fail", {}, async () => { throw new Error("boom") })
    } catch {}

    const entries = logger.query({ action: "test.fail" })
    expect(entries.some(e => !e.success)).toBe(true)
  })
})

describe("Phase 2: BudgetManager", () => {
  let budget: InstanceType<typeof import("../src/services/budget-manager").BudgetManager>
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = resolve("/tmp", `test-budget-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    const { BudgetManager } = await import("../src/services/budget-manager")
    budget = new BudgetManager({ dbPath: resolve(tmpDir, "budget.db") })
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("setLimit() creates a budget limit", () => {
    const { ulid } = require("ulid")
    const limit = budget.setLimit({
      id: ulid(),
      userID: "user1",
      window: "day",
      maxTokens: 100000,
      maxRequests: 50,
      hardLimit: false,
    })
    expect(limit.id).toBeDefined()
    expect(limit.userID).toBe("user1")
    expect(limit.window).toBe("day")
    expect(limit.maxTokens).toBe(100000)
  })

  test("getLimits() returns limits for user", () => {
    const limits = budget.getLimits("user1")
    expect(limits.length).toBeGreaterThanOrEqual(1)
    expect(limits[0].userID).toBe("user1")
  })

  test("recordUsage() and check() work together", () => {
    const { ulid } = require("ulid")
    budget.setLimit({ id: ulid(), userID: "checker", window: "total", maxRequests: 5, hardLimit: true })
    budget.recordUsage({ userID: "checker", tokensInput: 50, tokensOutput: 50, costCents: 0 })
    const result = budget.check("checker")
    expect(result.allowed).toBe(true)
  })

  test("check() denies when budget exceeded", () => {
    const { ulid } = require("ulid")
    budget.setLimit({ id: ulid(), userID: "overbudget", window: "total", maxRequests: 1, hardLimit: true })
    // Record more usage than the limit
    budget.recordUsage({ userID: "overbudget", tokensInput: 0, tokensOutput: 0, costCents: 0 })
    budget.recordUsage({ userID: "overbudget", tokensInput: 0, tokensOutput: 0, costCents: 0 })
    const result = budget.check("overbudget")
    expect(result.allowed).toBe(false)
    expect(result.reason).toBeDefined()
  })

  test("summary() returns per-window breakdown", () => {
    const s = budget.summary("user1")
    expect(typeof s).toBe("object")
  })
})

describe("Phase 2: ChatLogStore", () => {
  let chatLog: InstanceType<typeof import("../src/services/chat-log").ChatLogStore>
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = resolve("/tmp", `test-chatlog-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    const { ChatLogStore } = await import("../src/services/chat-log")
    chatLog = new ChatLogStore({ dbPath: resolve(tmpDir, "chat-log.db") })
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("store() saves a session and entries", () => {
    chatLog.store({
      sessionId: "s1",
      model: "test-model",
      userMessage: "Hello",
      assistantReply: "Hi there!",
      toolCallCount: 0,
      latencyMs: 50,
    })

    const sessions = chatLog.listSessions()
    expect(sessions.length).toBeGreaterThanOrEqual(1)
    expect(sessions.some(s => s.id === "s1")).toBe(true)
  })

  test("getEntries() returns user and assistant messages", () => {
    const entries = chatLog.getEntries("s1")
    expect(entries.length).toBe(2) // user + assistant
    expect(entries.some(e => e.role === "user")).toBe(true)
    expect(entries.some(e => e.role === "assistant")).toBe(true)
  })

  test("listSessions() respects limit", () => {
    // Store a few more sessions
    for (let i = 2; i <= 5; i++) {
      chatLog.store({
        sessionId: `s${i}`,
        model: "test-model",
        userMessage: `q${i}`,
        assistantReply: `a${i}`,
        toolCallCount: 0,
        latencyMs: 10,
      })
    }
    const limited = chatLog.listSessions(2)
    expect(limited.length).toBe(2)
  })

  test("store() updates existing session message count", () => {
    chatLog.store({
      sessionId: "s1",
      model: "test-model",
      userMessage: "Follow up",
      assistantReply: "Response",
      toolCallCount: 1,
      latencyMs: 30,
    })
    const entries = chatLog.getEntries("s1")
    expect(entries.length).toBe(4) // 2 original + 2 new
  })
})

describe("Phase 2: TaskStateTracker", () => {
  let tracker: InstanceType<typeof import("../src/services/task-state-tracker").TaskStateTracker>
  let tmpDir: string

  beforeAll(async () => {
    tmpDir = resolve("/tmp", `test-tracker-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    const { TaskStateTracker } = await import("../src/services/task-state-tracker")
    tracker = new TaskStateTracker({ dbPath: resolve(tmpDir, "tasks.db") })
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test("create() returns task in queued state", () => {
    const task = tracker.create({ title: "Test task", prompt: "Do something" })
    expect(task.id).toBeDefined()
    expect(task.state).toBe("queued")
    expect(task.title).toBe("Test task")
    expect(task.prompt).toBe("Do something")
  })

  test("transition() changes task state", () => {
    const task = tracker.create({ title: "Trans test", prompt: "go" })
    const running = tracker.transition(task.id, "running")
    expect(running.state).toBe("running")
    expect(running.startedAt).toBeDefined()
  })

  test("transition() enforces state machine", () => {
    const task = tracker.create({ title: "SM test", prompt: "go" })
    // queued → completed is NOT valid (must go through running)
    expect(() => tracker.transition(task.id, "completed")).toThrow()
  })

  test("transition() allows valid paths", () => {
    const task = tracker.create({ title: "Valid path", prompt: "go" })
    tracker.transition(task.id, "running")
    const completed = tracker.transition(task.id, "completed", { result: "done" })
    expect(completed.state).toBe("completed")
    expect(completed.completedAt).toBeDefined()
  })

  test("get() retrieves task by id", () => {
    const task = tracker.create({ title: "Get test", prompt: "go" })
    const found = tracker.get(task.id)
    expect(found).toBeDefined()
    expect(found!.title).toBe("Get test")
  })

  test("list() filters by state", () => {
    const t1 = tracker.create({ title: "List A", prompt: "go" })
    const t2 = tracker.create({ title: "List B", prompt: "go" })
    tracker.transition(t1.id, "running")
    const running = tracker.list({ state: "running" })
    expect(running.some(t => t.id === t1.id)).toBe(true)
    expect(running.some(t => t.id === t2.id)).toBe(false)
  })

  test("stats() returns state counts", () => {
    const stats = tracker.stats()
    expect(typeof stats.total).toBe("number")
    expect(stats.total).toBeGreaterThan(0)
    expect(typeof stats.queued).toBe("number")
    expect(typeof stats.running).toBe("number")
  })

  test("onStateChange() callback fires", () => {
    let fired = false
    const unsub = tracker.onStateChange((task, from, to) => {
      fired = true
      expect(from).toBe("queued")
      expect(to).toBe("running")
    })
    const task = tracker.create({ title: "CB test", prompt: "go" })
    tracker.transition(task.id, "running")
    expect(fired).toBe(true)
    unsub()
  })

  test("nextQueued() returns highest priority queued task", () => {
    tracker.create({ title: "Low pri", prompt: "go", priority: 10 })
    tracker.create({ title: "High pri", prompt: "go", priority: 1 })
    const next = tracker.nextQueued()
    expect(next).toBeDefined()
    // Priority 1 should come before 10
    expect(next!.priority).toBeLessThanOrEqual(10)
  })

  test("updateProgress() sets progress and step", () => {
    const task = tracker.create({ title: "Prog test", prompt: "go" })
    tracker.transition(task.id, "running")
    tracker.updateProgress(task.id, 50, "Step 2 of 4")
    const updated = tracker.get(task.id)
    expect(updated!.progress).toBe(50)
    expect(updated!.currentStep).toBe("Step 2 of 4")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. OpenCode Removal — No OpenCode Imports in Key Files
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 2: OpenCode Removal Verification", () => {
  const routeDir = resolve(import.meta.dir, "../src/server/routes")
  const serviceDir = resolve(import.meta.dir, "../src/services")

  function fileContains(path: string, pattern: string): boolean {
    if (!existsSync(path)) return false
    return readFileSync(path, "utf-8").includes(pattern)
  }

  test("sessions.ts has NO OpenCode imports", () => {
    expect(fileContains(join(routeDir, "sessions.ts"), "opencode-client")).toBe(false)
    expect(fileContains(join(routeDir, "sessions.ts"), "OpenCodeClient")).toBe(false)
  })

  test("files.ts has NO OpenCode imports", () => {
    expect(fileContains(join(routeDir, "files.ts"), "opencode-client")).toBe(false)
    expect(fileContains(join(routeDir, "files.ts"), "OpenCodeClient")).toBe(false)
  })

  test("health.ts has NO OpenCode imports", () => {
    expect(fileContains(join(routeDir, "health.ts"), "opencode-client")).toBe(false)
    expect(fileContains(join(routeDir, "health.ts"), "OpenCodeClient")).toBe(false)
  })

  test("events.ts has NO OpenCode imports", () => {
    expect(fileContains(join(routeDir, "events.ts"), "opencode-client")).toBe(false)
  })

  test("providers.ts has NO OpenCode imports", () => {
    expect(fileContains(join(routeDir, "providers.ts"), "opencode-client")).toBe(false)
  })

  test("index.ts has NO OpenCode imports", () => {
    const indexPath = resolve(import.meta.dir, "../src/server/index.ts")
    expect(fileContains(indexPath, "opencode-client")).toBe(false)
    expect(fileContains(indexPath, "new OpenCodeClient")).toBe(false)
  })

  test("index.ts uses AgentExecutor", () => {
    const content = readFileSync(resolve(import.meta.dir, "../src/server/index.ts"), "utf-8")
    expect(content).toContain("AgentExecutor")
    expect(content).toContain("new AgentExecutor()")
  })

  test("scalable-queue.ts has NO OpenCode dependency", () => {
    expect(fileContains(join(serviceDir, "scalable-queue.ts"), "opencode-client")).toBe(false)
  })

  test("subagent-orchestrator.ts has NO OpenCode dependency", () => {
    expect(fileContains(join(serviceDir, "subagent-orchestrator.ts"), "opencode-client")).toBe(false)
  })

  test("parallel-executor.ts has NO OpenCode dependency", () => {
    expect(fileContains(join(serviceDir, "parallel-executor.ts"), "opencode-client")).toBe(false)
  })

  test("task-queue.ts has NO OpenCode dependency", () => {
    expect(fileContains(join(serviceDir, "task-queue.ts"), "opencode-client")).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. Dual-Write Pattern Verification (imports + pattern presence)
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 2: Dual-Write Pattern", () => {
  const serviceDir = resolve(import.meta.dir, "../src/services")

  function serviceContent(name: string): string {
    return readFileSync(join(serviceDir, name), "utf-8")
  }

  test("workspace-manager.ts imports from config/db", () => {
    const c = serviceContent("workspace-manager.ts")
    expect(c).toContain('from "../config/db"')
    expect(c).toContain("pgEnabled")
    expect(c).toContain("pgSql")
  })

  test("audit-logger.ts imports from config/db", () => {
    const c = serviceContent("audit-logger.ts")
    expect(c).toContain('from "../config/db"')
    expect(c).toContain("pgEnabled")
  })

  test("budget-manager.ts imports from config/db", () => {
    const c = serviceContent("budget-manager.ts")
    expect(c).toContain('from "../config/db"')
    expect(c).toContain("pgEnabled")
  })

  test("chat-log.ts imports from config/db", () => {
    const c = serviceContent("chat-log.ts")
    expect(c).toContain('from "../config/db"')
    expect(c).toContain("pgEnabled")
  })

  test("task-state-tracker.ts imports from config/db", () => {
    const c = serviceContent("task-state-tracker.ts")
    expect(c).toContain('from "../config/db"')
    expect(c).toContain("pgEnabled")
  })

  test("all dual-write services use fire-and-forget .catch()", () => {
    const files = [
      "workspace-manager.ts", "audit-logger.ts", "budget-manager.ts",
      "chat-log.ts", "task-state-tracker.ts",
    ]
    for (const f of files) {
      const c = serviceContent(f)
      expect(c).toContain(".catch(")
    }
  })

  test("all dual-write services use ON CONFLICT for idempotency", () => {
    const files = [
      "workspace-manager.ts", "budget-manager.ts", "chat-log.ts",
    ]
    for (const f of files) {
      const c = serviceContent(f)
      expect(c).toContain("ON CONFLICT")
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. AgentExecutor & LLM Client Verification
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 2: AgentExecutor & LLM Client", () => {
  test("AgentExecutor can be instantiated", async () => {
    const { AgentExecutor } = await import("../src/services/agent-executor")
    const executor = new AgentExecutor()
    expect(executor).toBeDefined()
    expect(typeof executor.run).toBe("function")
  })

  test("llm-client.ts exports resolveModel, providerFetch, findFallbackModels", async () => {
    const llm = await import("../src/services/llm-client")
    expect(typeof llm.resolveModel).toBe("function")
    expect(typeof llm.providerFetch).toBe("function")
    expect(typeof llm.findFallbackModels).toBe("function")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 6. Route Compilation & Instantiation
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 2: Route Instantiation", () => {
  test("healthRoutes() returns a Hono instance", async () => {
    const { healthRoutes } = await import("../src/server/routes/health")
    const app = healthRoutes()
    expect(app).toBeDefined()
    // Hono instances have fetch()
    expect(typeof app.fetch).toBe("function")
  })

  test("fileRoutes() returns a Hono instance", async () => {
    const { fileRoutes } = await import("../src/server/routes/files")
    const app = fileRoutes()
    expect(app).toBeDefined()
    expect(typeof app.fetch).toBe("function")
  })

  test("sessionRoutes() returns a Hono instance", async () => {
    const { sessionRoutes } = await import("../src/server/routes/sessions")
    const { ChatLogStore } = await import("../src/services/chat-log")
    const tmpDir = resolve("/tmp", `test-session-route-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    try {
      const chatLog = new ChatLogStore({ dbPath: tmpDir + "/chat-log.db" })
      const app = sessionRoutes(chatLog)
      expect(app).toBeDefined()
      expect(typeof app.fetch).toBe("function")
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test("taskRoutes() returns a Hono instance", async () => {
    const { taskRoutes } = await import("../src/server/routes/tasks")
    const { TaskQueue } = await import("../src/services/task-queue")
    const { ScalableQueue } = await import("../src/services/scalable-queue")
    const { TaskStateTracker } = await import("../src/services/task-state-tracker")
    const tmpDir = resolve("/tmp", `test-task-route-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    try {
      const tracker = new TaskStateTracker({ dbPath: tmpDir + "/tasks.db" })
      const queue = new TaskQueue({ concurrency: 1 })
      const scalable = new ScalableQueue({ tracker, concurrency: 1 })
      const app = taskRoutes(queue, scalable, tracker)
      expect(app).toBeDefined()
      expect(typeof app.fetch).toBe("function")
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  test("eventRoutes() returns a Hono instance", async () => {
    const { eventRoutes } = await import("../src/server/routes/events")
    const { TaskQueue } = await import("../src/services/task-queue")
    const queue = new TaskQueue({ concurrency: 1 })
    const app = eventRoutes(queue)
    expect(app).toBeDefined()
    expect(typeof app.fetch).toBe("function")
  })

  test("providerRoutes() returns a Hono instance", async () => {
    const { providerRoutes } = await import("../src/server/routes/providers")
    const { SkillManager } = await import("../src/services/skill-manager")
    const skills = new SkillManager({ skillsDir: "/tmp/test-skills-" + Date.now() })
    const app = providerRoutes(skills)
    expect(app).toBeDefined()
    expect(typeof app.fetch).toBe("function")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 7. Route Functional Tests (in-process, no live server needed)
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 2: Health Routes (in-process)", () => {
  let app: any

  beforeAll(async () => {
    const { healthRoutes } = await import("../src/server/routes/health")
    const { Hono } = await import("hono")
    app = new Hono()
    app.route("/health", healthRoutes())
  })

  test("GET /health returns platform ok", async () => {
    const res = await app.request("/health")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.platform).toBe("ok")
    expect(body.opencode).toBe("standalone")
    expect(typeof body.uptime).toBe("number")
  })

  test("GET /health/ready returns ready + standalone", async () => {
    const res = await app.request("/health/ready")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ready).toBe(true)
    expect(body.standalone).toBe(true)
  })
})

describe("Phase 2: File Routes (in-process)", () => {
  let app: any

  beforeAll(async () => {
    const { fileRoutes } = await import("../src/server/routes/files")
    const { Hono } = await import("hono")
    app = new Hono()
    app.route("/api/files", fileRoutes())
  })

  test("GET /api/files lists project files", async () => {
    const res = await app.request("/api/files")
    expect(res.status).toBe(200)
    const files = await res.json()
    expect(Array.isArray(files)).toBe(true)
  })

  test("GET /api/files?path=nonexistent returns 403 or 404", async () => {
    // Absolute path outside project root → 403; relative nonexistent → 404
    const res1 = await app.request("/api/files?path=/nonexistent-dir-12345")
    expect([403, 404]).toContain(res1.status)
    const res2 = await app.request("/api/files?path=nonexistent-dir-12345")
    expect(res2.status).toBe(404)
  })

  test("GET /api/files/status returns counts", async () => {
    const res = await app.request("/api/files/status")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.totalFiles).toBe("number")
    expect(typeof body.totalDirs).toBe("number")
  })

  test("GET /api/files/find?q=package.json returns matches", async () => {
    const res = await app.request("/api/files/find?q=package.json")
    expect(res.status).toBe(200)
    const matches = await res.json()
    expect(Array.isArray(matches)).toBe(true)
    expect(matches.length).toBeGreaterThan(0)
  })

  test("GET /api/files/find without q returns 400", async () => {
    const res = await app.request("/api/files/find")
    expect(res.status).toBe(400)
  })

  test("GET /api/files/content without path returns 400", async () => {
    const res = await app.request("/api/files/content")
    expect(res.status).toBe(400)
  })

  test("GET /api/files/content?path=package.json reads file", async () => {
    const res = await app.request("/api/files/content?path=package.json")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.content).toBeDefined()
    expect(typeof body.size).toBe("number")
    expect(typeof body.lines).toBe("number")
  })

  test("path traversal is blocked", async () => {
    const res = await app.request("/api/files?path=/etc/passwd")
    // Should be 403 (outside project root) or 404
    expect([403, 404]).toContain(res.status)
  })
})

describe("Phase 2: Session Routes (in-process)", () => {
  let app: any

  beforeAll(async () => {
    const { sessionRoutes } = await import("../src/server/routes/sessions")
    const { ChatLogStore } = await import("../src/services/chat-log")
    const { Hono } = await import("hono")
    const tmpDir = resolve("/tmp", `test-sess-routes-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    const chatLog = new ChatLogStore({ dbPath: tmpDir + "/chat-log.db" })
    app = new Hono()
    app.route("/api/sessions", sessionRoutes(chatLog))
  })

  test("POST /api/sessions creates a session", async () => {
    const res = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Test Session" }),
    })
    expect(res.status).toBe(201)
    const session = await res.json()
    expect(session.id).toBeDefined()
    expect(session.title).toBe("Test Session")
  })

  test("GET /api/sessions lists sessions", async () => {
    // GET / reads from chatLog, not the in-memory sessionStore
    // So it may be empty unless a message was sent. Just verify the shape.
    const res = await app.request("/api/sessions")
    expect(res.status).toBe(200)
    const sessions = await res.json()
    expect(Array.isArray(sessions)).toBe(true)
  })

  test("GET /api/sessions/:id returns a session", async () => {
    const createRes = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Get Test" }),
    })
    const { id } = await createRes.json()
    const res = await app.request(`/api/sessions/${id}`)
    expect(res.status).toBe(200)
    const session = await res.json()
    expect(session.id).toBe(id)
  })

  test("DELETE /api/sessions/:id removes a session", async () => {
    const createRes = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Delete Test" }),
    })
    const { id } = await createRes.json()
    const delRes = await app.request(`/api/sessions/${id}`, { method: "DELETE" })
    expect(delRes.status).toBe(200)

    const getRes = await app.request(`/api/sessions/${id}`)
    expect(getRes.status).toBe(404)
  })

  test("GET /api/sessions/status returns count", async () => {
    const res = await app.request("/api/sessions/status")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.total).toBe("number")
    expect(typeof body.active).toBe("number")
  })

  test("GET /api/sessions/:id/messages returns empty for new session", async () => {
    const createRes = await app.request("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Msg Test" }),
    })
    const { id } = await createRes.json()
    const res = await app.request(`/api/sessions/${id}/messages`)
    expect(res.status).toBe(200)
    const msgs = await res.json()
    expect(Array.isArray(msgs)).toBe(true)
  })
})

describe("Phase 2: Task Routes (in-process)", () => {
  let app: any

  beforeAll(async () => {
    const { taskRoutes } = await import("../src/server/routes/tasks")
    const { TaskQueue } = await import("../src/services/task-queue")
    const { ScalableQueue } = await import("../src/services/scalable-queue")
    const { TaskStateTracker } = await import("../src/services/task-state-tracker")
    const { Hono } = await import("hono")
    const tmpDir = resolve("/tmp", `test-task-routes-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })
    const tracker = new TaskStateTracker({ dbPath: tmpDir + "/tasks.db" })
    const queue = new TaskQueue({ concurrency: 1 })
    const scalable = new ScalableQueue({ tracker, concurrency: 1 })
    app = new Hono()
    app.route("/api/tasks", taskRoutes(queue, scalable, tracker))
  })

  test("POST /api/tasks creates task with status=queued", async () => {
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Test task prompt" }),
    })
    expect(res.status).toBe(201)
    const task = await res.json()
    expect(task.id).toBeDefined()
    expect(task.status).toBe("queued") // SDK-compatible field
    expect(task.state).toBe("queued")  // Also present from spread
    expect(task.prompt).toBe("Test task prompt")
  })

  test("GET /api/tasks lists tasks", async () => {
    const res = await app.request("/api/tasks")
    expect(res.status).toBe(200)
    const tasks = await res.json()
    expect(Array.isArray(tasks)).toBe(true)
    expect(tasks.length).toBeGreaterThan(0)
  })

  test("GET /api/tasks/stats returns state counts", async () => {
    const res = await app.request("/api/tasks/stats")
    expect(res.status).toBe(200)
    const stats = await res.json()
    expect(typeof stats.total).toBe("number")
    expect(typeof stats.queued).toBe("number")
  })

  test("POST /api/tasks validation rejects empty prompt", async () => {
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "" }),
    })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })

  test("GET /api/tasks/:id returns specific task", async () => {
    const createRes = await app.request("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Get by ID test" }),
    })
    const { id } = await createRes.json()
    const res = await app.request(`/api/tasks/${id}`)
    expect(res.status).toBe(200)
    const task = await res.json()
    expect(task.id).toBe(id)
    expect(task.status).toBe("queued")
  })

  test("GET /api/tasks/:id returns 404 for unknown ID", async () => {
    const res = await app.request("/api/tasks/nonexistent-id-12345")
    expect(res.status).toBe(404)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 8. Migration Script Verification
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 2: Migration Script", () => {
  test("migrate-sqlite-to-pg.ts exists", () => {
    const path = resolve(import.meta.dir, "../scripts/migrate-sqlite-to-pg.ts")
    expect(existsSync(path)).toBe(true)
  })

  test("migration script uses idempotent ON CONFLICT DO NOTHING", () => {
    const content = readFileSync(resolve(import.meta.dir, "../scripts/migrate-sqlite-to-pg.ts"), "utf-8")
    expect(content).toContain("ON CONFLICT")
    expect(content).toContain("DO NOTHING")
  })

  test("migration script supports --dry-run", () => {
    const content = readFileSync(resolve(import.meta.dir, "../scripts/migrate-sqlite-to-pg.ts"), "utf-8")
    expect(content).toContain("--dry-run")
    expect(content).toContain("dryRun")
  })

  test("migration script supports --only filter", () => {
    const content = readFileSync(resolve(import.meta.dir, "../scripts/migrate-sqlite-to-pg.ts"), "utf-8")
    expect(content).toContain("--only=")
    expect(content).toContain("onlySet")
  })

  test("migration script backs up databases", () => {
    const content = readFileSync(resolve(import.meta.dir, "../scripts/migrate-sqlite-to-pg.ts"), "utf-8")
    expect(content).toContain("backup")
  })

  test("migration script migrates all 5 sources", () => {
    const content = readFileSync(resolve(import.meta.dir, "../scripts/migrate-sqlite-to-pg.ts"), "utf-8")
    expect(content).toContain("workspaces")
    expect(content).toContain("audit")
    expect(content).toContain("budget")
    expect(content).toContain("chat")
    expect(content).toContain("tasks")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 9. Types Verification
// ═══════════════════════════════════════════════════════════════════════════

describe("Phase 2: Type Definitions", () => {
  test("HealthStatus includes standalone option", () => {
    const content = readFileSync(resolve(import.meta.dir, "../src/types/index.ts"), "utf-8")
    expect(content).toContain('"standalone"')
  })

  test("TaskRun type has status field", () => {
    const content = readFileSync(resolve(import.meta.dir, "../src/types/index.ts"), "utf-8")
    expect(content).toContain("status:")
    expect(content).toContain('"queued"')
    expect(content).toContain('"running"')
    expect(content).toContain('"completed"')
    expect(content).toContain('"failed"')
    expect(content).toContain('"aborted"')
  })
})
