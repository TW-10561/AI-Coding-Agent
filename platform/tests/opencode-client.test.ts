// ---------------------------------------------------------------------------
// Unit tests — OpenCodeClient (mock fetch)
// ---------------------------------------------------------------------------

import { describe, test, expect, mock, beforeEach } from "bun:test"
import { OpenCodeClient, OpenCodeError } from "../src/services/opencode-client"

let mockFetch: ReturnType<typeof mock>

function createClient() {
  mockFetch = mock()
  // @ts-ignore
  globalThis.fetch = mockFetch
  return new OpenCodeClient({ url: "http://localhost:4096", directory: "/test" })
}

describe("OpenCodeClient", () => {
  test("health returns ok when server responds", async () => {
    const client = createClient()
    mockFetch.mockResolvedValueOnce(new Response("{}", { status: 200 }))
    const result = await client.health()
    expect(result.ok).toBe(true)
  })

  test("health returns not ok when server is down", async () => {
    const client = createClient()
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"))
    const result = await client.health()
    expect(result.ok).toBe(false)
  })

  test("sessions returns parsed JSON", async () => {
    const client = createClient()
    const sessions = [{ id: "s1", title: "Test", agentID: "build", createdAt: 0, updatedAt: 0 }]
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(sessions), { status: 200 }))
    const result = await client.sessions()
    expect(result).toEqual(sessions)
  })

  test("request throws OpenCodeError on non-ok response", async () => {
    const client = createClient()
    mockFetch.mockResolvedValueOnce(new Response("Not Found", { status: 404 }))
    try {
      await client.session("nonexistent")
      expect(true).toBe(false)
    } catch (err) {
      expect(err).toBeInstanceOf(OpenCodeError)
      expect((err as OpenCodeError).status).toBe(404)
    }
  })

  test("sets x-opencode-directory header", async () => {
    const client = createClient()
    mockFetch.mockResolvedValueOnce(new Response("[]", { status: 200 }))
    await client.sessions()
    const call = mockFetch.mock.calls[0]
    expect(call[1].headers["x-opencode-directory"]).toBe("/test")
  })
})
