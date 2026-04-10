// ---------------------------------------------------------------------------
// Unit tests — task queue logic (no external server required)
// ---------------------------------------------------------------------------

import { describe, test, expect, mock } from "bun:test"
import { TaskQueue } from "../src/services/task-queue"
import { AgentExecutor } from "../src/services/agent-executor"

// Minimal mock executor
const mockExecutor = {
  run: mock(() => Promise.resolve({ text: "done", rounds: 1, tokens: { input: 10, output: 10 }, toolLog: [] })),
} as unknown as AgentExecutor

describe("TaskQueue", () => {
  test("enqueue creates a queued task", () => {
    const queue = new TaskQueue({ executor: mockExecutor, concurrency: 0 })
    const run = queue.enqueue({
      userID: "u1",
      prompt: "hello",
      directory: "/tmp",
    })
    expect(run.id).toBeDefined()
    expect(run.status).toBe("queued")
    expect(run.prompt).toBe("hello")
  })

  test("list returns all runs", () => {
    const queue = new TaskQueue({ executor: mockExecutor, concurrency: 0 })
    queue.enqueue({ userID: "u1", prompt: "a", directory: "/tmp" })
    queue.enqueue({ userID: "u2", prompt: "b", directory: "/tmp" })
    expect(queue.list().length).toBe(2)
  })

  test("list filters by userID", () => {
    const queue = new TaskQueue({ executor: mockExecutor, concurrency: 0 })
    queue.enqueue({ userID: "u1", prompt: "a", directory: "/tmp" })
    queue.enqueue({ userID: "u2", prompt: "b", directory: "/tmp" })
    expect(queue.list({ userID: "u1" }).length).toBe(1)
  })

  test("abort queued task sets status to aborted", async () => {
    const queue = new TaskQueue({ executor: mockExecutor, concurrency: 0 })
    const run = queue.enqueue({ userID: "u1", prompt: "x", directory: "/tmp" })
    const ok = await queue.abort(run.id)
    expect(ok).toBe(true)
    expect(queue.get(run.id)?.status).toBe("aborted")
  })

  test("onUpdate fires on enqueue", async () => {
    const queue = new TaskQueue({ executor: mockExecutor, concurrency: 0 })
    const events: string[] = []
    queue.onUpdate((run) => events.push(run.status))
    queue.enqueue({ userID: "u1", prompt: "x", directory: "/tmp" })
    expect(events).toContain("queued")
  })
})
