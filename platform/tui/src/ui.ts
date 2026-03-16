// ---------------------------------------------------------------------------
// ui.ts — Reusable UI rendering primitives for the Thirdwave TUI
// Panels, tables, status bars, spinners, markdown rendering
// ---------------------------------------------------------------------------

import { Marked } from "marked"
import { markedTerminal } from "marked-terminal"
import { C, Box, TERM_WIDTH, INNER_WIDTH, SPINNER_FRAMES } from "./theme"

// ── Markdown Renderer ────────────────────────────────────────────────

const marked = new Marked()
marked.use(markedTerminal({
  width: 80,
  reflowText: true,
  showSectionPrefix: false,
}))

export function renderMarkdown(text: string): string {
  try {
    const result = marked.parse(text) as string
    // Strip any residual HTML tags that marked-terminal didn't handle
    return result
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trimEnd()
  } catch {
    return text
  }
}

// ── Spinner ──────────────────────────────────────────────────────────
// Uses a dedicated line that we overwrite in-place.  When stopped we
// erase that line completely so it doesn't leave artefacts.

let spinnerInterval: ReturnType<typeof setInterval> | null = null
let spinnerFrame = 0
let spinnerLineWritten = false

export function startSpinner(msg: string) {
  stopSpinner() // clear any left-over spinner
  spinnerFrame = 0
  spinnerLineWritten = false
  spinnerInterval = setInterval(() => {
    const frame = C.primary(SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length])
    // Move to column 0, clear entire line, write spinner
    if (!spinnerLineWritten) {
      process.stdout.write("\n")
      spinnerLineWritten = true
    }
    process.stdout.write(`\x1b[2K\r  ${frame} ${C.muted(msg)}`)
    spinnerFrame++
  }, 80)
}

export function stopSpinner() {
  if (spinnerInterval) {
    clearInterval(spinnerInterval)
    spinnerInterval = null
  }
  if (spinnerLineWritten) {
    // Erase the spinner line completely: clear line + carriage return
    process.stdout.write("\x1b[2K\r")
    spinnerLineWritten = false
  }
}

// ── Panel Drawing ────────────────────────────────────────────────────
// Creates boxed panels with rounded corners, titles, and optional tags

export function panel(opts: {
  title?: string
  titleRight?: string
  body: string[]
  color?: (s: string) => string
  indent?: number
}) {
  const color = opts.color ?? C.dim
  const indent = " ".repeat(opts.indent ?? 2)
  const w = TERM_WIDTH() - (opts.indent ?? 2) * 2

  // Top border
  let top = Box.tl + Box.h
  if (opts.title) {
    const titleStr = ` ${opts.title} `
    top += titleStr
    const remaining = w - 3 - stripAnsi(titleStr).length
    if (opts.titleRight) {
      const rightStr = ` ${opts.titleRight} `
      const gap = remaining - stripAnsi(rightStr).length - 1
      top += Box.h.repeat(Math.max(1, gap)) + rightStr + Box.h
    } else {
      top += Box.h.repeat(Math.max(1, remaining))
    }
  } else {
    top += Box.h.repeat(Math.max(1, w - 3))
  }
  top += Box.tr
  console.log(indent + color(top))

  // Body lines
  for (const line of opts.body) {
    const text = ` ${line}`
    const visLen = stripAnsi(text).length
    const pad = Math.max(0, w - 2 - visLen)
    console.log(indent + color(Box.v) + text + " ".repeat(pad) + color(Box.v))
  }

  // Bottom border
  console.log(indent + color(Box.bl + Box.h.repeat(Math.max(1, w - 2)) + Box.br))
}

// ── Compact Panel (no side borders, just top/bottom lines) ──────────

export function section(title: string, lines: string[]) {
  const w = TERM_WIDTH() - 4
  console.log()
  console.log(`  ${C.textBold(title)}`)
  console.log(`  ${C.dim(Box.h.repeat(w))}`)
  for (const l of lines) {
    console.log(`  ${l}`)
  }
}

// ── Key-Value Display ────────────────────────────────────────────────

export function kvLine(key: string, value: string, indent = 4) {
  const pad = " ".repeat(indent)
  const keyW = 18
  const k = key.padEnd(keyW)
  console.log(`${pad}${C.muted(k)} ${value}`)
}

// ── Table ────────────────────────────────────────────────────────────

export function table(headers: string[], rows: string[][]) {
  if (rows.length === 0) return
  // Calculate column widths
  const colW = headers.map((h, i) => {
    const maxData = rows.reduce((max, row) => Math.max(max, stripAnsi(row[i] || "").length), 0)
    return Math.max(stripAnsi(h).length, maxData)
  })

  // Header
  const hdr = headers.map((h, i) => C.muted(h.padEnd(colW[i]))).join("  ")
  console.log(`    ${hdr}`)
  console.log(`    ${C.dim(colW.map(w => Box.h.repeat(w)).join("──"))}`)

  // Rows
  for (const row of rows) {
    const r = row.map((cell, i) => {
      const vis = stripAnsi(cell).length
      return cell + " ".repeat(Math.max(0, colW[i] - vis))
    }).join("  ")
    console.log(`    ${r}`)
  }
}

// ── Status Dot ───────────────────────────────────────────────────────

export function statusDot(ok: boolean): string {
  return ok ? C.success(Box.dot) : C.error(Box.dot)
}

export function statusIcon(status: string): string {
  switch (status) {
    case "completed": case "ok": case "success":
      return C.success(Box.check)
    case "running": case "in-progress": case "active":
      return C.warning("⟳")
    case "failed": case "error":
      return C.error(Box.cross_mark)
    case "queued": case "pending": case "not-started":
      return C.muted(Box.dotEmpty)
    default:
      return C.dim(Box.dotEmpty)
  }
}

// ── Strip ANSI ───────────────────────────────────────────────────────

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "")
}

// ── Header Bar ───────────────────────────────────────────────────────

export function headerBar(opts: {
  sessionId?: string
  sessionTitle?: string
  model?: string
  agent?: string
}) {
  const w = TERM_WIDTH()
  console.log()
  const brand = C.primaryBg("  ◆ Thirdwave  ")
  const agentInfo = opts.agent ? `  ${C.textBold(opts.agent.charAt(0).toUpperCase() + opts.agent.slice(1))}` : ""
  const sessionInfo = opts.sessionId
    ? `  ${C.muted("session:")}${C.accent(opts.sessionId.slice(0, 8))}  ${C.muted(opts.sessionTitle || "(untitled)")}`
    : `  ${C.muted("no session")}`
  const modelInfo = opts.model ? `  ${C.muted("model:")}${C.text(opts.model)}` : ""
  console.log(`  ${brand}${agentInfo}${sessionInfo}${modelInfo}`)
  console.log(`  ${C.dim(Box.h.repeat(w - 4))}`)
}

// ── Footer Hint Bar ──────────────────────────────────────────────────

export function footerHints(hints: string[]) {
  const w = TERM_WIDTH()
  console.log(`  ${C.dim(Box.h.repeat(w - 4))}`)
  console.log(`  ${hints.map(h => C.muted(h)).join(C.dim("  •  "))}`)
}

// ── Chat Message Display ─────────────────────────────────────────────

export function userMessage(text: string) {
  console.log()
  console.log(`  ${C.user(Box.dot)} ${C.user("You")}`)
  console.log(`  ${C.dim(Box.v)}`)
  const lines = text.split("\n")
  for (const line of lines) {
    console.log(`  ${C.dim(Box.v)} ${C.text(line)}`)
  }
  console.log(`  ${C.dim(Box.v)}`)
}

export function assistantMessage(text: string, tokenInfo?: string) {
  console.log()

  // Header line
  const label = `${C.assistant(Box.diamond)} ${C.assistant("Assistant")}`
  const right = tokenInfo ? C.muted(tokenInfo) : ""
  console.log(`  ${label}  ${right}`)
  console.log(`  ${C.primary(Box.v)}`)

  // Render markdown, trim trailing blank lines so we don't print empty │ rows
  const rendered = renderMarkdown(text)
  const lines = rendered.split("\n")
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop()
  for (const line of lines) {
    console.log(`  ${C.primary(Box.v)} ${line}`)
  }
  console.log(`  ${C.primary(Box.v)}`)
}

const REASONING_MAX_LINES = 8

export function reasoningBlock(text: string) {
  const label = `${C.muted("◇ Reasoning")}`
  console.log()
  console.log(`  ${label}`)
  console.log(`  ${C.dim(Box.v)}`)
  const allLines = text.trim().split("\n")
  const shown = allLines.slice(0, REASONING_MAX_LINES)
  for (const line of shown) {
    console.log(`  ${C.dim(Box.v)} ${C.muted(line)}`)
  }
  if (allLines.length > REASONING_MAX_LINES) {
    console.log(`  ${C.dim(Box.v)} ${C.dim(`  … +${allLines.length - REASONING_MAX_LINES} more lines (use /history to see all)`)}`)
  }
  console.log(`  ${C.dim(Box.v)}`)
}

export function toolCallLine(name: string) {
  console.log(`    ${C.warning("⚙")} ${C.muted(name)}`)
}

// ── Empty State ──────────────────────────────────────────────────────

export function emptyState(message: string, hint?: string) {
  console.log()
  console.log(`  ${C.muted(message)}`)
  if (hint) console.log(`  ${C.dim(hint)}`)
}

// ── Error Display ────────────────────────────────────────────────────

export function errorMsg(msg: string, detail?: string) {
  console.log(`  ${C.error(Box.cross_mark)} ${C.error(msg)}`)
  if (detail) console.log(`    ${C.dim(detail)}`)
}

// ── Success Display ──────────────────────────────────────────────────

export function successMsg(msg: string) {
  console.log(`  ${C.success(Box.check)} ${C.success(msg)}`)
}

export function warnMsg(msg: string) {
  console.log(`  ${C.warning(Box.warning_sign)} ${C.warning(msg)}`)
}
