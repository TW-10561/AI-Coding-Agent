// ---------------------------------------------------------------------------
// Workspace routes — /api/workspaces
// Multi-project workspace management
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import z from "zod"
import type { WorkspaceManager } from "../../services/workspace-manager"

const CreateBody = z.object({
  name: z.string().min(1),
  directory: z.string().min(1),
  tags: z.array(z.string()).optional(),
})

const UpdateBody = z.object({
  name: z.string().optional(),
  tags: z.array(z.string()).optional(),
})

export function workspaceRoutes(workspaces: WorkspaceManager) {
  return new Hono()
    // List workspaces
    .get("/", async (c) => {
      const tag = c.req.query("tag")
      return c.json(workspaces.list(tag ? { tag } : undefined))
    })

    // Get active workspace
    .get("/active", async (c) => {
      const active = workspaces.active()
      if (!active) return c.json({ error: "no_active_workspace" }, 404)
      return c.json(active)
    })

    // Get workspace by ID
    .get("/:id", async (c) => {
      const ws = workspaces.get(c.req.param("id"))
      if (!ws) return c.json({ error: "not_found" }, 404)
      return c.json(ws)
    })

    // Create workspace
    .post("/", async (c) => {
      const body = CreateBody.parse(await c.req.json())
      const ws = workspaces.create(body)
      return c.json(ws, 201)
    })

    // Update workspace
    .patch("/:id", async (c) => {
      const body = UpdateBody.parse(await c.req.json())
      try {
        const ws = workspaces.update(c.req.param("id"), body)
        return c.json(ws)
      } catch (e: any) {
        if (e?.message?.includes("not found")) return c.json({ error: "not_found" }, 404)
        throw e
      }
    })

    // Switch to workspace
    .post("/:id/switch", async (c) => {
      try {
        const ws = workspaces.switchTo(c.req.param("id"))
        return c.json(ws)
      } catch (e: any) {
        if (e?.message?.includes("not found")) return c.json({ error: "not_found" }, 404)
        if (e?.message?.includes("no longer exists")) return c.json({ error: "directory_missing", message: e.message }, 400)
        throw e
      }
    })

    // Delete workspace
    .delete("/:id", async (c) => {
      const ok = workspaces.delete(c.req.param("id"))
      if (!ok) return c.json({ error: "not_found" }, 404)
      return c.json({ deleted: true })
    })

    // Workspace stats
    .get("/:id/stats", async (c) => {
      const ws = workspaces.get(c.req.param("id"))
      if (!ws) return c.json({ error: "not_found" }, 404)
      const stats = workspaces.stats()
      return c.json(stats)
    })
}
