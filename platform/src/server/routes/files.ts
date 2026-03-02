// ---------------------------------------------------------------------------
// File routes — /api/files
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import { OpenCodeClient } from "../../services/opencode-client"

export function fileRoutes(client: OpenCodeClient) {
  return new Hono()
    .get("/", async (c) => {
      const dir = c.req.query("path")
      const files = await client.listFiles(dir ?? undefined)
      return c.json(files)
    })
    .get("/content", async (c) => {
      const path = c.req.query("path")
      if (!path) return c.json({ error: "missing path" }, 400)
      const content = await client.readFile(path)
      return c.json(content)
    })
    .get("/status", async (c) => {
      const status = await client.fileStatus()
      return c.json(status)
    })
    .get("/find", async (c) => {
      const q = c.req.query("q")
      if (!q) return c.json({ error: "missing query" }, 400)
      const results = await client.findFiles(q)
      return c.json(results)
    })
    .get("/search", async (c) => {
      const q = c.req.query("q")
      if (!q) return c.json({ error: "missing query" }, 400)
      const results = await client.findText(q)
      return c.json(results)
    })
}
