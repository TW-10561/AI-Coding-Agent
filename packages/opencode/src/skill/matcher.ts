import { Skill } from "./skill"

/**
 * Find skills that appear relevant to the provided text.
 *
 * This is a lightweight heuristic matcher that looks for occurrences of the
 * skill name or words from the description inside the user text.  The scores
 * are intentionally simple; the goal is to surface plausible candidates that
 * would benefit from being injected into the system prompt.  A more advanced
 * implementation (embeddings, LLM prompt, etc.) could replace this later.
 */
export async function findRelevantSkills(
  userText: string,
  skills: Skill.Info[],
  limit = 3,
): Promise<Skill.Info[]> {
  const text = userText.toLowerCase()
  const scored = skills.map((skill) => {
    let score = 0
    const name = skill.name.toLowerCase()
    if (text.includes(name)) score += 10

    const desc = skill.description.toLowerCase()
    for (const word of desc.split(/\W+/)) {
      if (!word) continue
      if (text.includes(word)) score += 1
    }

    return { skill, score }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.skill)
}

/**
 * Render a skill's content as a block suitable for insertion into the
 * system prompt.  The `skill` tool uses a similar format, so we mimic that
 * here for consistency.
 */
export function formatSkillBlock(skill: Skill.Info): string {
  return [`<skill_content name="${skill.name}">`, skill.content, `</skill_content>`].join("\n")
}
