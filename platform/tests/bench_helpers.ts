/**
 * bench_helpers.ts — Micro-benchmarks for agent loop helper functions.
 * Run with: bun run platform/tests/bench_helpers.ts
 * Outputs JSON to stdout for the Python report generator.
 */

// ── Inline copies of helpers (same logic as chat.ts) ─────────────────

function simpleHash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0
  }
  return h.toString(36)
}

function summarizeToolOutput(toolName: string, rawOutput: string, success: boolean): string {
  if (!success) return `[ERROR: ${rawOutput.slice(0, 300)}]`
  const lines = rawOutput.split("\n")
  const lineCount = lines.length
  const charCount = rawOutput.length
  if (charCount <= 800) return rawOutput
  switch (toolName) {
    case "bash": {
      const head = lines.slice(0, 20).join("\n")
      const tail = lines.slice(-10).join("\n")
      return `${head}\n... [${lineCount - 30} lines omitted] ...\n${tail}\n[Total: ${lineCount} lines, ${charCount} chars]`
    }
    case "read_file": {
      const head = lines.slice(0, 30).join("\n")
      const tail = lines.slice(-5).join("\n")
      return `${head}\n... [${lineCount - 35} lines omitted] ...\n${tail}\n[File: ${lineCount} total lines]`
    }
    case "grep_search": {
      const matches = lines.filter(l => l.trim()).slice(0, 40)
      return `${matches.join("\n")}${lineCount > 40 ? `\n... [${lineCount - 40} more matches]` : ""}`
    }
    case "list_dir": {
      return lines.slice(0, 60).join("\n") + (lineCount > 60 ? `\n... [${lineCount - 60} more entries]` : "")
    }
    default: {
      return rawOutput.slice(0, 1200) + (charCount > 1200 ? `\n... [truncated, ${charCount} total chars]` : "")
    }
  }
}

function classifyComplexity(message: string): "simple" | "moderate" | "complex" {
  const words = message.split(/\s+/).length
  const multiStep = /\b(and then|after that|also|then|step \d|first.*then|1\.|2\.|3\.|multiple|several|all|every|entire|full|complete)\b/i.test(message)
  const bigTask = /\b(create|build|setup|implement|refactor|migrate|deploy|redesign|rewrite|project|application|app|system|architecture)\b/i.test(message)
  if ((words > 40 && bigTask) || (multiStep && bigTask)) return "complex"
  if (words > 25 || multiStep || bigTask) return "moderate"
  return "simple"
}

function parseTextToolCalls(text: string): Array<{ name: string; args: Record<string, any> }> {
  const calls: Array<{ name: string; args: Record<string, any> }> = []
  const blockRegex = /<tool_use>([\s\S]*?)<\/tool_use>/g
  let blockMatch
  while ((blockMatch = blockRegex.exec(text)) !== null) {
    const parsed = parseToolBlock(blockMatch[1])
    if (parsed) calls.push(parsed)
  }
  const lastOpen = text.lastIndexOf("<tool_use>")
  if (lastOpen >= 0) {
    const afterOpen = text.slice(lastOpen + 10)
    if (!afterOpen.includes("</tool_use>")) {
      const parsed = parseToolBlock(afterOpen)
      if (parsed) calls.push(parsed)
    }
  }
  return calls
}

function parseToolBlock(block: string): { name: string; args: Record<string, any> } | null {
  const nameMatch = block.match(/<name>\s*([\s\S]*?)\s*<\/name>/)
  if (!nameMatch) return null
  const name = nameMatch[1].trim()
  const afterName = block.slice(block.indexOf("</name>") + 7).trim()
  let args: Record<string, any> = {}
  const inputMatch = afterName.match(/<input>\s*([\s\S]*?)\s*<\/input>/)
  const inputContent = inputMatch ? inputMatch[1].trim() : null
  if (inputContent) {
    try { args = JSON.parse(inputContent) } catch {
      try { args = JSON.parse(inputContent.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']')) } catch {}
    }
  }
  return { name, args }
}

function compressMessages(msgs: Array<Record<string, any>>, maxChars: number): Array<Record<string, any>> {
  const total = msgs.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : JSON.stringify(m).length), 0)
  if (total <= maxChars) return msgs
  const keepLast = 6
  if (msgs.length <= keepLast + 1) return msgs
  const recent = msgs.slice(-keepLast)
  const middle = msgs.slice(1, -keepLast)
  if (middle.length === 0) return msgs
  let summary = "[Earlier conversation compressed]\n"
  for (const m of middle) {
    const role = m.role ?? "?"
    const content = typeof m.content === "string" ? m.content : ""
    summary += `• ${role}: ${content.slice(0, 120)}\n`
  }
  return [msgs[0], { role: "user", content: summary }, ...recent]
}

function buildReflectionPrompt(
  results: Array<{ tool: string; success: boolean; output: string }>,
  round: number, maxRounds: number, mode: string
): string {
  const succeeded = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length
  const remaining = maxRounds - round
  let fb = "Tool execution results:\n"
  for (const r of results) {
    const summary = summarizeToolOutput(r.tool, r.output, r.success)
    fb += `\n<tool_result>\n<name>${r.tool}</name>\n<status>${r.success ? "success" : "error"}</status>\n<output>\n${summary}\n</output>\n</tool_result>\n`
  }
  if (failed > 0) {
    fb += `\n⚠️ ${failed} tool(s) FAILED.`
  } else {
    fb += `\n✓ All ${succeeded} tool(s) succeeded.`
  }
  if (mode !== "quick") {
    fb += `\n\n[REFLECTION]\n1. What did I learn?\n2. Do I have enough info?\n3. What is the next minimal action?\n\nRemaining rounds: ${remaining}.`
  }
  if (remaining <= 2 && remaining > 0) {
    fb += `\n\n⏳ CRITICAL: Only ${remaining} round(s) left.`
  }
  return fb
}

function taskNeedsTools(message: string): boolean {
  const ACTION_PATTERN = /\b(create|make|list|show|display|read|write|edit|update|modify|run|execute|check|build|install|delete|remove|fix|find|locate|search|fetch|get|download|git|npm|pip|bun|deno|bash|shell|command|file|files|directory|folder|dir|code|script|project|deploy|test|debug|analyze|generate|refactor|open|close|start|stop|kill|process|port|log|error|import|require|package|setup|configure|init)\b/i
  const CONVERSATIONAL_PATTERN = /^(who|what|how|why|when|where|which|can you|could you|are you|is it|do you|would you|tell me about|explain|describe|what('s| is) (a|an|the|your))\b.{0,80}\??\.?\s*$/i
  const hasActions = ACTION_PATTERN.test(message)
  return !CONVERSATIONAL_PATTERN.test(message) || hasActions
}

// ── Benchmark helpers ─────────────────────────────────────────────────

function bench(name: string, fn: () => void, iters: number): {
  name: string; iters: number; totalMs: number; avgUs: number; opsPerSec: number
} {
  // Warm up
  for (let i = 0; i < Math.min(100, iters / 10); i++) fn()

  const start = performance.now()
  for (let i = 0; i < iters; i++) fn()
  const end = performance.now()
  const totalMs = end - start
  const avgUs = (totalMs / iters) * 1000
  const opsPerSec = Math.round(iters / (totalMs / 1000))
  return { name, iters, totalMs: Math.round(totalMs * 100) / 100, avgUs: Math.round(avgUs * 1000) / 1000, opsPerSec }
}

// ── Test data ─────────────────────────────────────────────────────────

const SMALL_STRING = "hello world this is a test string for hashing"
const MED_STRING = "x".repeat(1000)
const LARGE_STRING = "x".repeat(10000)

const BASH_OUTPUT_LARGE = Array.from({ length: 200 }, (_, i) => `line ${i}: some output here`).join("\n")
const FILE_OUTPUT_LARGE = Array.from({ length: 300 }, (_, i) => `    const variable${i} = 'value${i}';`).join("\n")
const GREP_OUTPUT_LARGE = Array.from({ length: 100 }, (_, i) => `src/file${i}.ts:${i * 3}: match here`).join("\n")
const LIST_DIR_LARGE = Array.from({ length: 150 }, (_, i) => `file_${i}.ts`).join("\n")

const SIMPLE_MSG = "What does this function do?"
const MODERATE_MSG = "I need to fix the bug in the authentication system"
const COMPLEX_MSG = "Create a complete REST API with authentication, database migrations, and deployment configuration for a new project"

const TOOL_CALL_SIMPLE = `<tool_use><name>read_file</name><input>{"path": "src/index.ts"}</input></tool_use>`
const TOOL_CALL_MULTI = `
<tool_use><name>read_file</name><input>{"path": "src/index.ts"}</input></tool_use>
Some text in between
<tool_use><name>bash</name><input>{"command": "ls -la"}</input></tool_use>
<tool_use><name>grep_search</name><input>{"pattern": "function", "path": "src"}</input></tool_use>
`
const TOOL_CALL_COMPLEX_WITH_CONTENT = `
I need to analyze this file first.

<tool_use>
<name>write_file</name>
<input>
{"path": "src/output.ts", "content": "export const x = 1;\\nexport const y = 2;\\n// lots of code\\n"}
</input>
</tool_use>

Let me also check the directory.

<tool_use>
<name>list_dir</name>
<input>{"path": "."}</input>
</tool_use>
`

const MESSAGES_LARGE: Array<Record<string, any>> = [
  { role: "system", content: "You are a helpful assistant. " + "x".repeat(5000) },
  ...Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `Message ${i}: ${"some content ".repeat(100)}`
  }))
]

const TOOL_RESULTS_SMALL = [
  { tool: "read_file", success: true, output: "const x = 1;\nconst y = 2;" },
]
const TOOL_RESULTS_LARGE = [
  { tool: "bash", success: true, output: BASH_OUTPUT_LARGE },
  { tool: "read_file", success: true, output: FILE_OUTPUT_LARGE },
  { tool: "grep_search", success: true, output: GREP_OUTPUT_LARGE },
]

// ── Run benchmarks ────────────────────────────────────────────────────

const results: any[] = []

// 1. simpleHash
results.push(bench("simpleHash (small, 46 chars)", () => simpleHash(SMALL_STRING), 200_000))
results.push(bench("simpleHash (medium, 1000 chars)", () => simpleHash(MED_STRING), 100_000))
results.push(bench("simpleHash (large, 10000 chars)", () => simpleHash(LARGE_STRING), 20_000))

// 2. summarizeToolOutput
results.push(bench("summarizeToolOutput bash (200 lines)", () => summarizeToolOutput("bash", BASH_OUTPUT_LARGE, true), 50_000))
results.push(bench("summarizeToolOutput read_file (300 lines)", () => summarizeToolOutput("read_file", FILE_OUTPUT_LARGE, true), 50_000))
results.push(bench("summarizeToolOutput grep_search (100 lines)", () => summarizeToolOutput("grep_search", GREP_OUTPUT_LARGE, true), 50_000))
results.push(bench("summarizeToolOutput list_dir (150 entries)", () => summarizeToolOutput("list_dir", LIST_DIR_LARGE, true), 50_000))
results.push(bench("summarizeToolOutput default (large)", () => summarizeToolOutput("default", LARGE_STRING, true), 50_000))

// 3. classifyComplexity
results.push(bench("classifyComplexity (simple msg)", () => classifyComplexity(SIMPLE_MSG), 100_000))
results.push(bench("classifyComplexity (moderate msg)", () => classifyComplexity(MODERATE_MSG), 100_000))
results.push(bench("classifyComplexity (complex msg)", () => classifyComplexity(COMPLEX_MSG), 100_000))

// 4. parseTextToolCalls
results.push(bench("parseTextToolCalls (1 call)", () => parseTextToolCalls(TOOL_CALL_SIMPLE), 50_000))
results.push(bench("parseTextToolCalls (3 calls)", () => parseTextToolCalls(TOOL_CALL_MULTI), 20_000))
results.push(bench("parseTextToolCalls (with content)", () => parseTextToolCalls(TOOL_CALL_COMPLEX_WITH_CONTENT), 20_000))

// 5. taskNeedsTools
results.push(bench("taskNeedsTools (simple question)", () => taskNeedsTools("What is 2+2?"), 200_000))
results.push(bench("taskNeedsTools (action request)", () => taskNeedsTools("Create a new React component"), 200_000))
results.push(bench("taskNeedsTools (conversational)", () => taskNeedsTools("Who are you?"), 200_000))

// 6. compressMessages
results.push(bench("compressMessages (20 msgs, no compress)", () => compressMessages(MESSAGES_LARGE, 999_999), 10_000))
results.push(bench("compressMessages (20 msgs, with compress)", () => compressMessages(MESSAGES_LARGE, 10_000), 10_000))

// 7. buildReflectionPrompt
results.push(bench("buildReflectionPrompt (1 result, agent)", () => buildReflectionPrompt(TOOL_RESULTS_SMALL, 3, 15, "agent"), 20_000))
results.push(bench("buildReflectionPrompt (3 results, agent)", () => buildReflectionPrompt(TOOL_RESULTS_LARGE, 3, 15, "agent"), 10_000))

// ── Correctness checks ────────────────────────────────────────────────

const correctness: Record<string, any> = {}

// simpleHash determinism
const h1 = simpleHash("test")
const h2 = simpleHash("test")
const h3 = simpleHash("different")
correctness["simpleHash_deterministic"] = h1 === h2
correctness["simpleHash_different_inputs"] = h1 !== h3
correctness["simpleHash_sample"] = { input: "test", hash: h1 }

// summarizeToolOutput compression
const bashRaw = BASH_OUTPUT_LARGE
const bashSummarized = summarizeToolOutput("bash", bashRaw, true)
correctness["bash_compression_ratio"] = Math.round((1 - bashSummarized.length / bashRaw.length) * 100)
correctness["bash_compressed_chars"] = bashSummarized.length
correctness["bash_original_chars"] = bashRaw.length

const fileRaw = FILE_OUTPUT_LARGE
const fileSummarized = summarizeToolOutput("read_file", fileRaw, true)
correctness["read_file_compression_ratio"] = Math.round((1 - fileSummarized.length / fileRaw.length) * 100)
correctness["read_file_compressed_chars"] = fileSummarized.length
correctness["read_file_original_chars"] = fileRaw.length

// classifyComplexity accuracy
const classifications = [
  [SIMPLE_MSG, "simple"],
  [MODERATE_MSG, "moderate"],
  [COMPLEX_MSG, "complex"],
  ["Fix the typo", "simple"],
  ["Set up a complete microservices architecture with 5 services", "complex"],
  ["Run npm install", "moderate"],
]
const classAccuracy = classifications.filter(([msg, expected]) => classifyComplexity(msg as string) === expected).length
correctness["classifyComplexity_accuracy"] = `${classAccuracy}/${classifications.length}`
correctness["classifyComplexity_samples"] = classifications.map(([msg, expected]) => ({
  msg: (msg as string).slice(0, 60),
  expected,
  got: classifyComplexity(msg as string),
  correct: classifyComplexity(msg as string) === expected,
}))

// parseTextToolCalls accuracy
const parsed1 = parseTextToolCalls(TOOL_CALL_SIMPLE)
correctness["parseTextToolCalls_simple"] = { count: parsed1.length, names: parsed1.map(t => t.name) }
const parsed3 = parseTextToolCalls(TOOL_CALL_MULTI)
correctness["parseTextToolCalls_multi"] = { count: parsed3.length, names: parsed3.map(t => t.name) }
const parsedComplex = parseTextToolCalls(TOOL_CALL_COMPLEX_WITH_CONTENT)
correctness["parseTextToolCalls_complex"] = { count: parsedComplex.length, names: parsedComplex.map(t => t.name) }

// compressMessages correctness
const uncompressed = compressMessages(MESSAGES_LARGE, 999_999)
const compressed = compressMessages(MESSAGES_LARGE, 10_000)
correctness["compressMessages_no_op_len"] = uncompressed.length
correctness["compressMessages_compressed_len"] = compressed.length
correctness["compressMessages_reduced"] = compressed.length < uncompressed.length

// taskNeedsTools
const toolChecks = [
  ["Create a file", true],
  ["Who are you?", false],
  ["What is JavaScript?", false],
  ["List all files in the src directory", true],
  ["Fix the bug in auth.ts", true],
  ["How are you?", false],
]
const toolCheckAccuracy = toolChecks.filter(([msg, expected]) => taskNeedsTools(msg as string) === expected).length
correctness["taskNeedsTools_accuracy"] = `${toolCheckAccuracy}/${toolChecks.length}`
correctness["taskNeedsTools_samples"] = toolChecks.map(([msg, expected]) => ({
  msg,
  expected,
  got: taskNeedsTools(msg as string),
  correct: taskNeedsTools(msg as string) === expected,
}))

// Output JSON result
console.log(JSON.stringify({ benchmarks: results, correctness }, null, 2))
