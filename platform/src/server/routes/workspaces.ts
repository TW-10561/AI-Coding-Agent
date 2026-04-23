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
      const user = (c.var as any).user || {}
      const ownerId = user.sub
      const isAdmin = String(user.role || "").toLowerCase() === "admin"
      return c.json(await workspaces.list({ tag: tag || undefined, ownerId: isAdmin ? undefined : ownerId }))
    })

    // Get active workspace
    .get("/active", async (c) => {
      const user = (c.var as any).user || {}
      const ownerId = user.sub
      const isAdmin = String(user.role || "").toLowerCase() === "admin"
      const active = await workspaces.active(isAdmin ? undefined : ownerId)
      if (!active) return c.json({ error: "no_active_workspace" }, 404)
      return c.json(active)
    })

    // Get workspace by ID
    .get("/:id", async (c) => {
      const user = (c.var as any).user || {}
      const ownerId = user.sub
      const isAdmin = String(user.role || "").toLowerCase() === "admin"
      const ws = await workspaces.get(c.req.param("id"), isAdmin ? undefined : ownerId)
      if (!ws) return c.json({ error: "not_found" }, 404)
      return c.json(ws)
    })

    // Create workspace
    .post("/", async (c) => {
      const body = CreateBody.parse(await c.req.json())
      const user = (c.var as any).user || {}
      // Capture current user as owner if authenticated
      const ownerId = user.sub
      const ws = await workspaces.create({ ...body, ownerId })
      return c.json(ws, 201)
    })

    // Update workspace
    .patch("/:id", async (c) => {
      const body = UpdateBody.parse(await c.req.json())
      const user = (c.var as any).user || {}
      const ownerId = user.sub
      const isAdmin = String(user.role || "").toLowerCase() === "admin"
      try {
        const ws = await workspaces.update(c.req.param("id"), body, isAdmin ? undefined : ownerId)
        return c.json(ws)
      } catch (e: any) {
        if (e?.message?.includes("not found")) return c.json({ error: "not_found" }, 404)
        throw e
      }
    })

    // Switch to workspace
    .post("/:id/switch", async (c) => {
      const user = (c.var as any).user || {}
      const ownerId = user.sub
      const isAdmin = String(user.role || "").toLowerCase() === "admin"
      try {
        const ws = await workspaces.switchTo(c.req.param("id"), isAdmin ? undefined : ownerId)
        return c.json(ws)
      } catch (e: any) {
        if (e?.message?.includes("not found")) return c.json({ error: "not_found" }, 404)
        if (e?.message?.includes("no longer exists")) return c.json({ error: "directory_missing", message: e.message }, 400)
        throw e
      }
    })

    // Delete workspace
    .delete("/:id", async (c) => {
      const user = (c.var as any).user || {}
      const ownerId = user.sub
      const isAdmin = String(user.role || "").toLowerCase() === "admin"
      const ok = await workspaces.delete(c.req.param("id"), isAdmin ? undefined : ownerId)
      if (!ok) return c.json({ error: "not_found" }, 404)
      return c.json({ deleted: true })
    })

    // Workspace stats
    .get("/:id/stats", async (c) => {
      const user = (c.var as any).user || {}
      const ownerId = user.sub
      const isAdmin = String(user.role || "").toLowerCase() === "admin"
      const ws = await workspaces.get(c.req.param("id"), isAdmin ? undefined : ownerId)
      if (!ws) return c.json({ error: "not_found" }, 404)
      const stats = await workspaces.stats()
      return c.json(stats)
    })
}
