// ---------------------------------------------------------------------------
// File routes — /api/files
// Local filesystem operations — no OpenCode dependency.
// Uses the same tool functions from tool-executor.ts for consistency.
// ---------------------------------------------------------------------------

import { Hono } from "hono"
import { env } from "../../config/env"
import { readdirSync, statSync, readFileSync, existsSync } from "fs"
import { resolve, relative, join } from "path"

const PROJECT_DIR = env.OPENCODE_DIR

/** Recursively list files, returning a flat array of relative paths. */
function listTree(dir: string, base: string, depth = 0, maxDepth = 3): Array<{ path: string; type: "file" | "dir"; size?: number }> {
  if (depth > maxDepth) return []
  const SKIP = new Set(["node_modules", ".git", "dist", "build", ".turbo", "__pycache__", ".venv"])
  const results: Array<{ path: string; type: "file" | "dir"; size?: number }> = []
  try {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue
      const full = join(dir, entry)
      try {
        const stat = statSync(full)
        const rel = relative(base, full)
        if (stat.isDirectory()) {
          results.push({ path: rel + "/", type: "dir" })
          if (depth < maxDepth) results.push(...listTree(full, base, depth + 1, maxDepth))
        } else {
          results.push({ path: rel, type: "file", size: stat.size })
        }
      } catch {}
    }
  } catch {}
  return results
}

export function fileRoutes() {
  return new Hono()
    // List files in directory
    .get("/", async (c) => {
      const dir = c.req.query("path") ?? "."
      const fullDir = dir.startsWith("/") ? dir : resolve(PROJECT_DIR, dir)
      // Prevent traversal outside project
      if (!fullDir.startsWith(PROJECT_DIR)) {
        return c.json({ error: "Path outside project root" }, 403)
      }
      if (!existsSync(fullDir)) {
        return c.json({ error: "Directory not found" }, 404)
      }
      const files = listTree(fullDir, PROJECT_DIR)
      return c.json(files)
    })

    // Read file content
    .get("/content", async (c) => {
      const path = c.req.query("path")
      if (!path) return c.json({ error: "missing path" }, 400)
      const fullPath = path.startsWith("/") ? path : resolve(PROJECT_DIR, path)
      if (!fullPath.startsWith(PROJECT_DIR)) {
        return c.json({ error: "Path outside project root" }, 403)
      }
      if (!existsSync(fullPath)) {
        return c.json({ error: "File not found" }, 404)
      }
      try {
        const content = readFileSync(fullPath, "utf-8")
        const stat = statSync(fullPath)
        return c.json({ path: relative(PROJECT_DIR, fullPath), content, size: stat.size, lines: content.split("\n").length })
      } catch (e: any) {
        return c.json({ error: e.message }, 500)
      }
    })

    // File status (basic stats)
    .get("/status", async (c) => {
      try {
        const tree = listTree(PROJECT_DIR, PROJECT_DIR, 0, 1)
        return c.json({ totalFiles: tree.filter(f => f.type === "file").length, totalDirs: tree.filter(f => f.type === "dir").length })
      } catch (e: any) {
        return c.json({ error: e.message }, 500)
      }
    })

    // Find files by name pattern
    .get("/find", async (c) => {
      const q = c.req.query("q")
      if (!q) return c.json({ error: "missing query" }, 400)
      const allFiles = listTree(PROJECT_DIR, PROJECT_DIR, 0, 5)
      const matches = allFiles.filter(f => f.path.toLowerCase().includes(q.toLowerCase())).slice(0, 100)
      return c.json(matches)
    })

    // Search file contents (grep)
    .get("/search", async (c) => {
      const q = c.req.query("q")
      if (!q) return c.json({ error: "missing query" }, 400)
      try {
        const proc = Bun.spawn(
          ["grep", "-rn", "--color=never", "-m", "50",
           "--exclude-dir=node_modules", "--exclude-dir=.git",
           "--exclude-dir=dist", "--exclude-dir=build",
           "-e", q, PROJECT_DIR],
          { stdout: "pipe", stderr: "pipe" },
        )
        const stdout = await new Response(proc.stdout).text()
        await proc.exited
        const results = stdout.trim().split("\n").filter(Boolean).map(line => {
          const rel = line.replace(PROJECT_DIR + "/", "")
          const [file, lineNum, ...rest] = rel.split(":")
          return { file, line: Number(lineNum), text: rest.join(":").trim() }
        }).slice(0, 50)
        return c.json(results)
      } catch (e: any) {
        return c.json({ error: e.message }, 500)
      }
    })
}
