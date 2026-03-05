// ---------------------------------------------------------------------------
// Skill routes — /api/skills
// Browse, search, and read contextual skills
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import type { SkillManager } from "../../services/skill-manager"

export function skillRoutes(skills: SkillManager) {
  return new Hono()

    /** GET /api/skills — list all skills (metadata only) */
    .get("/", (c) => {
      const category = c.req.query("category")
      if (category) {
        const byCategory = skills.byCategory()
        return c.json(byCategory[category] ?? [])
      }
      return c.json(skills.listAll())
    })

    /** GET /api/skills/categories — grouped by category */
    .get("/categories", (c) => {
      return c.json(skills.byCategory())
    })

    /** GET /api/skills/search?q=... — search skills by keyword */
    .get("/search", (c) => {
      const q = c.req.query("q") ?? ""
      if (!q.trim()) return c.json([])
      return c.json(skills.search(q))
    })

    /** GET /api/skills/:id — get full skill content */
    .get("/:id", (c) => {
      const id = c.req.param("id")
      const skill = skills.get(id)
      if (!skill) return c.json({ error: `Skill not found: ${id}` }, 404)
      return c.json(skill)
    })

    /** POST /api/skills/reload — reload skills from disk */
    .post("/reload", (c) => {
      skills.load()
      return c.json({ ok: true, count: skills.count() })
    })
}
