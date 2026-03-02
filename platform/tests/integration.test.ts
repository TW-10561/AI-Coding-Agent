// ---------------------------------------------------------------------------
// Platform integration tests — runs against a live platform server
// ---------------------------------------------------------------------------

import { describe, test, expect, beforeAll } from "bun:test"
import { PlatformClient } from "../src/sdk/client"

const BASE_URL = process.env.PLATFORM_URL ?? "http://localhost:3100"
const API_KEY = process.env.PLATFORM_API_KEY

let client: PlatformClient

beforeAll(() => {
  client = new PlatformClient({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
  })
})

describe("Health", () => {
  test("GET /health returns platform status", async () => {
    const status = await client.health()
    expect(status.platform).toBe("ok")
    expect(status.version).toBeDefined()
    expect(status.uptime).toBeGreaterThan(0)
  })

  test("GET /health/ready returns readiness", async () => {
    const res = await client.ready()
    expect(typeof res.ready).toBe("boolean")
  })
})

describe("Sessions", () => {
  let sessionID: string

  test("POST /api/sessions creates a new session", async () => {
    const session = await client.createSession({ title: "test-session" })
    expect(session.id).toBeDefined()
    sessionID = session.id
  })

  test("GET /api/sessions lists sessions", async () => {
    const sessions = await client.listSessions()
    expect(Array.isArray(sessions)).toBe(true)
    expect(sessions.length).toBeGreaterThan(0)
  })

  test("GET /api/sessions/:id returns a session", async () => {
    const session = await client.getSession(sessionID)
    expect(session.id).toBe(sessionID)
  })

  test("DELETE /api/sessions/:id deletes a session", async () => {
    await client.deleteSession(sessionID)
    // Verify it's gone
    try {
      await client.getSession(sessionID)
      expect(true).toBe(false) // should not reach here
    } catch (err: any) {
      expect(err.status).toBe(404)
    }
  })
})

describe("Providers", () => {
  test("GET /api/providers returns provider list", async () => {
    const result = await client.listProviders()
    expect(result.all).toBeDefined()
    expect(Array.isArray(result.all)).toBe(true)
  })

  test("GET /api/providers/agents returns agent list", async () => {
    const agents = await client.listAgents()
    expect(Array.isArray(agents)).toBe(true)
  })
})

describe("Tasks", () => {
  test("POST /api/tasks enqueues a task", async () => {
    const task = await client.enqueueTask({
      prompt: "List all files in the current directory",
      directory: process.cwd(),
    })
    expect(task.id).toBeDefined()
    expect(task.status).toBe("queued")
  })

  test("GET /api/tasks lists tasks", async () => {
    const tasks = await client.listTasks()
    expect(Array.isArray(tasks)).toBe(true)
    expect(tasks.length).toBeGreaterThan(0)
  })
})

describe("Files", () => {
  test("GET /api/files lists root directory", async () => {
    const files = await client.listFiles()
    expect(Array.isArray(files)).toBe(true)
  })

  test("GET /api/files/find searches for files", async () => {
    const results = await client.findFiles("package.json")
    expect(Array.isArray(results)).toBe(true)
  })
})

describe("Project & Config", () => {
  test("GET /api/project returns current project", async () => {
    const project = await client.currentProject()
    expect(project).toBeDefined()
  })

  test("GET /api/config returns config", async () => {
    const config = await client.getConfig()
    expect(config).toBeDefined()
  })

  test("GET /api/vcs returns VCS info", async () => {
    const vcs = await client.vcs()
    expect(vcs).toBeDefined()
  })
})
