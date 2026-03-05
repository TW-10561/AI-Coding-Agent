// ---------------------------------------------------------------------------
// Skill Manager — loads, indexes, and serves contextual skills
//
// Skills are markdown knowledge files stored in platform/skills/installed/.
// Each skill has a SKILL.md with YAML frontmatter (name, description, icon,
// category, tags) and rich reference content.
//
// This service:
//   • Loads all skills at startup into an in-memory index.
//   • Provides search by keyword/tag matching.
//   • Returns skill content for injection into chat context (RAG-lite).
//   • Supports hot-reload when skills change on disk.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync } from "fs"
import { join, basename } from "path"

// ── Types ─────────────────────────────────────────────────────────────

export interface SkillMeta {
  id: string                // folder name, e.g. "systematic-debugging"
  name: string              // from frontmatter, e.g. "systematic-debugging"
  displayName: string       // title-cased: "Systematic Debugging"
  description: string       // short description from frontmatter
  icon: string              // emoji icon
  category: string          // e.g. "Development", "Testing", "Azure"
  tags: string[]            // keyword tags for matching
}

export interface Skill extends SkillMeta {
  content: string           // full markdown body (after frontmatter)
  filePath: string          // absolute path to SKILL.md
  sizeBytes: number         // file size for display
}

export interface SkillSearchResult {
  skill: SkillMeta
  relevance: number         // 0-1 score
  matchedOn: string         // what matched: "tag", "name", "description", "content"
}

// ── Frontmatter parser ────────────────────────────────────────────────

function parseFrontmatter(raw: string): { meta: Record<string, any>; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!match) return { meta: {}, body: raw }

  const yamlBlock = match[1]!
  const body = match[2]!.trim()
  const meta: Record<string, any> = {}

  for (const line of yamlBlock.split("\n")) {
    const m = line.match(/^(\w[\w-]*):\s*(.*)$/)
    if (!m) continue
    const key = m[1]!
    let value: any = m[2]!.trim()

    // Parse YAML arrays like [tag1, tag2, tag3]
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((s: string) => s.trim())
    }

    meta[key] = value
  }

  return { meta, body }
}

// ── Skill Manager ─────────────────────────────────────────────────────

export class SkillManager {
  private skills: Map<string, Skill> = new Map()
  private skillsDir: string
  private loaded = false

  constructor(opts: { skillsDir: string }) {
    this.skillsDir = opts.skillsDir
  }

  /** Load (or reload) all skills from disk */
  load(): void {
    this.skills.clear()
    const installedDir = join(this.skillsDir, "installed")

    let dirs: string[]
    try {
      dirs = readdirSync(installedDir)
    } catch {
      console.warn(`[skills] Could not read ${installedDir}`)
      this.loaded = true
      return
    }

    for (const dir of dirs) {
      const dirPath = join(installedDir, dir)
      try {
        if (!statSync(dirPath).isDirectory()) continue
      } catch { continue }

      const skillFile = join(dirPath, "SKILL.md")
      try {
        const raw = readFileSync(skillFile, "utf-8")
        const { meta, body } = parseFrontmatter(raw)
        const stat = statSync(skillFile)

        const id = basename(dir)
        const skill: Skill = {
          id,
          name: meta.name ?? id,
          displayName: titleCase(meta.name ?? id),
          description: meta.description ?? "",
          icon: meta.icon ?? "📦",
          category: meta.category ?? "General",
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          content: body,
          filePath: skillFile,
          sizeBytes: stat.size,
        }

        this.skills.set(id, skill)
      } catch {
        // Corrupted skill — skip
      }
    }

    this.loaded = true
  }

  /** Ensure skills are loaded */
  private ensureLoaded(): void {
    if (!this.loaded) this.load()
  }

  /** Get all skills (metadata only) */
  listAll(): SkillMeta[] {
    this.ensureLoaded()
    return [...this.skills.values()].map(s => ({
      id: s.id,
      name: s.name,
      displayName: s.displayName,
      description: s.description,
      icon: s.icon,
      category: s.category,
      tags: s.tags,
    }))
  }

  /** Get a single skill by id (full content) */
  get(id: string): Skill | null {
    this.ensureLoaded()
    return this.skills.get(id) ?? null
  }

  /** Count of loaded skills */
  count(): number {
    this.ensureLoaded()
    return this.skills.size
  }

  /** Get skills grouped by category */
  byCategory(): Record<string, SkillMeta[]> {
    const all = this.listAll()
    const groups: Record<string, SkillMeta[]> = {}
    for (const s of all) {
      const cat = s.category || "Other"
      ;(groups[cat] ??= []).push(s)
    }
    return groups
  }

  /**
   * Search skills by a query string.
   * Matches against: tags, name, description, category, content.
   * Returns results sorted by relevance (best first).
   *
   * Filtering:
   *   - Stopwords (common English words) are removed before matching.
   *   - Words shorter than 3 characters are ignored for substring matching.
   *   - Tag/name partial matching uses word-boundary-aware checks to avoid
   *     spurious hits (e.g. "hi" inside "architecture").
   */
  search(query: string): SkillSearchResult[] {
    this.ensureLoaded()
    const q = query.toLowerCase().trim()
    if (!q) return []

    // Split into words and filter out stopwords + tiny fragments
    const rawWords = q.split(/\s+/)
    const meaningful = rawWords.filter(w => w.length >= 3 && !STOPWORDS.has(w))

    // If the entire query is stopwords / too short, return nothing
    if (meaningful.length === 0) return []

    const results: SkillSearchResult[] = []

    for (const skill of this.skills.values()) {
      let best = 0
      let matchedOn = ""

      // ── Exact tag match (highest) ─────────────────────────────
      for (const tag of skill.tags) {
        const tl = tag.toLowerCase()
        // Full query equals a tag, or a meaningful word equals a tag
        if (tl === q || meaningful.some(w => tl === w)) {
          if (0.95 > best) { best = 0.95; matchedOn = "tag" }
        }
        // A tag *starts with* a meaningful word (≥4 chars) — moderate match
        // This prevents "hi" matching "architecture" but allows "arch" → "architecture"
        else if (meaningful.some(w => w.length >= 4 && (tl.startsWith(w) || w.startsWith(tl)))) {
          if (0.65 > best) { best = 0.65; matchedOn = "tag" }
        }
      }

      // ── Name match ────────────────────────────────────────────
      const nameLower = skill.name.toLowerCase()
      const nameParts = nameLower.split(/[-_\s]+/)
      if (nameLower === q) {
        if (1.0 > best) { best = 1.0; matchedOn = "name" }
      } else {
        // Count how many meaningful words exactly match or prefix-match a name-part
        const exactNameHits = meaningful.filter(w => nameParts.some(np => np === w)).length
        const prefixNameHits = meaningful.filter(w => w.length >= 4 && nameParts.some(np => np !== w && np.startsWith(w))).length

        if (exactNameHits >= 2) {
          // Multiple exact name-part hits → strong signal
          if (0.9 > best) { best = 0.9; matchedOn = "name" }
        } else if (exactNameHits === 1 && prefixNameHits >= 1) {
          if (0.85 > best) { best = 0.85; matchedOn = "name" }
        } else if (exactNameHits === 1) {
          // Single exact name-part hit (e.g. "python" in "python-performance-optimization")
          if (0.8 > best) { best = 0.8; matchedOn = "name" }
        } else if (prefixNameHits >= 1) {
          // Only prefix match (e.g. "build" → "builder") — low score, below auto-inject threshold
          if (0.6 > best) { best = 0.6; matchedOn = "name" }
        }
      }

      // ── Category match (exact word) ─────────────────────────
      const catLower = skill.category.toLowerCase()
      if (meaningful.some(w => catLower === w || catLower.startsWith(w) && w.length >= 4)) {
        if (0.6 > best) { best = 0.6; matchedOn = "category" }
      }

      // ── Description match — all meaningful words present ─────
      const descLower = skill.description.toLowerCase()
      if (meaningful.length >= 2 && meaningful.every(w => descLower.includes(w))) {
        if (0.75 > best) { best = 0.75; matchedOn = "description" }
      } else {
        // At least half the meaningful words present in description
        const descHits = meaningful.filter(w => descLower.includes(w)).length
        if (descHits >= 2 && descHits / meaningful.length >= 0.6) {
          const s = 0.5 + (descHits / meaningful.length) * 0.2
          if (s > best) { best = s; matchedOn = "description" }
        }
      }

      // ── Content match (lower relevance — fuzzy) ─────────────
      if (best === 0 && meaningful.length >= 2) {
        const contentLower = skill.content.toLowerCase()
        const matchCount = meaningful.filter(w => contentLower.includes(w)).length
        // Require at least 2 meaningful words to match content
        if (matchCount >= 2) {
          const score = 0.25 + (matchCount / meaningful.length) * 0.25
          if (score > best) { best = score; matchedOn = "content" }
        }
      }

      if (best > 0) {
        results.push({
          skill: {
            id: skill.id,
            name: skill.name,
            displayName: skill.displayName,
            description: skill.description,
            icon: skill.icon,
            category: skill.category,
            tags: skill.tags,
          },
          relevance: best,
          matchedOn,
        })
      }
    }

    return results.sort((a, b) => b.relevance - a.relevance)
  }

  /**
   * Find the best matching skill for a user message.
   * Used to automatically inject relevant skill context into chat prompts.
   * Returns null if no skill matches above the threshold.
   *
   * The threshold is intentionally high (0.75) to avoid false positives.
   * Skills should only activate when the user's message clearly relates
   * to a domain topic — not on casual greetings or vague requests.
   */
  findRelevantSkill(message: string, threshold = 0.75): Skill | null {
    // Skip skill search for very short messages (greetings, single words)
    if (message.trim().length < 8) return null
    const results = this.search(message)
    if (results.length === 0 || results[0]!.relevance < threshold) return null
    return this.get(results[0]!.skill.id)
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Common English stopwords — ignored during skill search to prevent false matches */
const STOPWORDS = new Set([
  // articles & determiners
  "a", "an", "the", "this", "that", "these", "those",
  // pronouns
  "i", "me", "my", "we", "us", "our", "you", "your", "he", "she", "it", "they",
  "him", "her", "his", "its", "them", "their",
  // prepositions & conjunctions
  "in", "on", "at", "to", "of", "for", "by", "with", "from", "up", "as", "or",
  "and", "but", "so", "if", "not", "no", "nor", "yet",
  // common verbs
  "is", "am", "are", "was", "were", "be", "do", "did", "does", "has", "have",
  "had", "can", "could", "will", "would", "shall", "should", "may", "might",
  "get", "got", "let",
  // greetings & filler
  "hi", "hey", "hello", "thanks", "thank", "please", "ok", "yes", "no",
  "what", "how", "why", "when", "where", "who", "which",
  // misc
  "just", "very", "too", "also", "only", "about", "all", "any", "some",
  "way", "out", "now", "then", "here", "there", "well", "more", "much",
])

function titleCase(s: string): string {
  return s
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase())
}
