#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Kadavuley TUI — Terminal UI for the AI Coding Platform
// ---------------------------------------------------------------------------
// Uses ONLY the Platform SDK (PlatformClient) to talk to the backend at :3100.
// Never contacts OpenCode (:4096) directly.
// ---------------------------------------------------------------------------

import { PlatformClient, PlatformApiError } from "../../src/sdk/client"
import type { SessionInfo, MessageWithParts, HealthStatus } from "../../src/types"
import chalk from "chalk"
import { Marked } from "marked"
import markedTerminal from "marked-terminal"
import * as readline from "readline"

// ── Config ───────────────────────────────────────────────────────────

const PLATFORM_URL = process.env.KADAVULEY_URL ?? "http://localhost:3100"
const API_KEY = process.env.KADAVULEY_API_KEY ?? undefined

// ── Init SDK client (talks ONLY to our backend, never to OpenCode) ──

const sdk = new PlatformClient({
  baseUrl: PLATFORM_URL,
  apiKey: API_KEY,
})

// ── Markdown renderer for terminal ──────────────────────────────────

const marked = new Marked(markedTerminal as any)

function renderMarkdown(text: string): string {
  try {
    return (marked.parse(text) as string).trimEnd()
  } catch {
    return text
  }
}

// ── ANSI helpers ─────────────────────────────────────────────────────

const DIM = chalk.dim
const BOLD = chalk.bold
const CYAN = chalk.cyan
const GREEN = chalk.green
const YELLOW = chalk.yellow
const RED = chalk.red
const MAGENTA = chalk.magenta
const BLUE = chalk.blue
const GRAY = chalk.gray

const LOGO = `
${chalk.bgHex("#6366f1").bold("  Kadavuley  ")}  ${DIM("AI Coding Platform — TUI Client")}
${DIM("─".repeat(58))}
`

const HELP_TEXT = `
${BOLD("Session & Chat:")}
  ${CYAN("/new")}               Create a new session
  ${CYAN("/sessions")}          List all sessions
  ${CYAN("/switch <id>")}       Switch to a session
  ${CYAN("/delete <id>")}       Delete a session
  ${CYAN("/history")}           Show messages in current session
  ${CYAN("/status")}            Show platform & model status
  ${CYAN("/providers")}         List available LLM providers
  ${CYAN("/files")}             List project files
  ${CYAN("/project")}           Show project info
  ${CYAN("/vcs")}               Show git branch info
  ${CYAN("/tasks")}             List background tasks

${BOLD("Backend Features:")}
  ${CYAN("/audit")}             View recent audit logs
  ${CYAN("/audit stats")}       View audit statistics
  ${CYAN("/budget")}            View budget usage summary
  ${CYAN("/budget check")}      Check if budget allows requests
  ${CYAN("/budget set <tok>")}  Set hourly token limit
  ${CYAN("/workspaces")}        List workspaces
  ${CYAN("/workspace new")}     Create a workspace (interactive)
  ${CYAN("/workspace switch")}  Switch active workspace
  ${CYAN("/queue")}             View queue metrics
  ${CYAN("/orchestrate")}       Start a multi-agent orchestration (interactive)
  ${CYAN("/orchestrations")}    List orchestrations
  ${CYAN("/parallel")}          Start parallel execution (interactive)
  ${CYAN("/parallel list")}     List parallel executions

${BOLD("General:")}
  ${CYAN("/clear")}             Clear terminal
  ${CYAN("/help")}              Show this help
  ${CYAN("/quit")}              Exit

${DIM("Type any text to send a prompt to your local vLLM model.")}
`

// ── State ────────────────────────────────────────────────────────────

let currentSession: SessionInfo | null = null
let isWaiting = false

// ── Readline setup ───────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
  historySize: 200,
})

function setPrompt() {
  const sessionLabel = currentSession
    ? `${DIM("session:")}${CYAN(currentSession.id.slice(0, 8))}`
    : DIM("no session")
  rl.setPrompt(`\n${GREEN("❯")} ${sessionLabel} ${GREEN("❯")} `)
}

function prompt() {
  setPrompt()
  rl.prompt()
}

// ── Spinner ──────────────────────────────────────────────────────────

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
let spinnerInterval: ReturnType<typeof setInterval> | null = null
let spinnerFrame = 0

function startSpinner(msg: string) {
  spinnerFrame = 0
  process.stdout.write("\n")
  spinnerInterval = setInterval(() => {
    const frame = MAGENTA(SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length])
    process.stdout.write(`\r${frame} ${DIM(msg)}`)
    spinnerFrame++
  }, 80)
}

function stopSpinner() {
  if (spinnerInterval) {
    clearInterval(spinnerInterval)
    spinnerInterval = null
    process.stdout.write("\r" + " ".repeat(60) + "\r")
  }
}

// ── Core actions (all use SDK → Platform backend → OpenCode) ─────────

async function checkHealth(): Promise<boolean> {
  try {
    const health = await sdk.health()
    return health.platform === "ok" && health.opencode === "ok"
  } catch {
    return false
  }
}

async function showStatus() {
  try {
    const health = await sdk.health()
    const providers = await sdk.listProviders()

    console.log()
    console.log(BOLD("  Platform Status"))
    console.log(`  ${health.platform === "ok" ? GREEN("●") : RED("●")} Platform:  ${health.platform}`)
    console.log(`  ${health.opencode === "ok" ? GREEN("●") : RED("●")} OpenCode:  ${health.opencode}`)
    console.log(`  ${DIM("Uptime:")}     ${Math.floor(health.uptime / 1000)}s`)
    console.log(`  ${DIM("Version:")}    ${health.version}`)
    console.log()
    console.log(BOLD("  LLM Providers"))
    console.log(`  ${DIM("Connected:")}  ${providers.connected.join(", ") || "none"}`)
    for (const p of (providers as any).all ?? []) {
      const modelKeys = Object.keys(p.models ?? {})
      console.log(`  ${GREEN("●")} ${BOLD(p.name)} ${DIM(`(${p.id})`)}`)
      for (const k of modelKeys) {
        const m = p.models[k]
        console.log(`    ${CYAN("→")} ${m.name ?? k} ${DIM(`[ctx:${m.limit?.context ?? "?"} out:${m.limit?.output ?? "?"}]`)}`)
      }
    }
  } catch (e) {
    console.log(RED(`  Error: ${e}`))
  }
}

async function createNewSession() {
  try {
    startSpinner("Creating session...")
    const session = await sdk.createSession()
    stopSpinner()
    currentSession = session
    console.log(GREEN(`  ✓ Session created: ${session.id.slice(0, 8)}...`))
    console.log(DIM(`    Agent: ${session.agentID}`))
  } catch (e) {
    stopSpinner()
    console.log(RED(`  Error creating session: ${e}`))
  }
}

async function listSessions() {
  try {
    const sessions = await sdk.listSessions({ limit: 20 })
    if (sessions.length === 0) {
      console.log(DIM("\n  No sessions yet. Use /new to start one."))
      return
    }
    console.log()
    console.log(BOLD(`  Sessions (${sessions.length})`))
    console.log(DIM("  " + "─".repeat(54)))
    for (const s of sessions) {
      const active = currentSession?.id === s.id ? GREEN(" ◀ active") : ""
      const ts = s.updatedAt ?? s.createdAt
      const date = ts ? (typeof ts === "number" && ts > 1e12
        ? new Date(ts).toLocaleString()
        : typeof ts === "string"
          ? new Date(ts).toLocaleString()
          : DIM("?"))
        : DIM("?")
      console.log(
        `  ${CYAN(s.id.slice(0, 8))}  ${s.title || DIM("(untitled)")}  ${DIM(String(date))}${active}`
      )
    }
  } catch (e) {
    console.log(RED(`  Error: ${e}`))
  }
}

async function switchSession(id: string) {
  try {
    // Try to find by prefix match
    const sessions = await sdk.listSessions({ limit: 100 })
    const match = sessions.find(s => s.id.startsWith(id) || s.id === id)
    if (!match) {
      console.log(RED(`  Session not found: ${id}`))
      return
    }
    currentSession = match
    console.log(GREEN(`  ✓ Switched to session ${match.id.slice(0, 8)}`))
    console.log(DIM(`    Title: ${match.title || "(untitled)"}`))
  } catch (e) {
    console.log(RED(`  Error: ${e}`))
  }
}

async function deleteSession(id: string) {
  try {
    const sessions = await sdk.listSessions({ limit: 100 })
    const match = sessions.find(s => s.id.startsWith(id) || s.id === id)
    if (!match) {
      console.log(RED(`  Session not found: ${id}`))
      return
    }
    await sdk.deleteSession(match.id)
    console.log(GREEN(`  ✓ Deleted session ${match.id.slice(0, 8)}`))
    if (currentSession?.id === match.id) {
      currentSession = null
    }
  } catch (e) {
    console.log(RED(`  Error: ${e}`))
  }
}

async function showHistory() {
  if (!currentSession) {
    console.log(YELLOW("  No active session. Use /new or /switch <id>"))
    return
  }
  try {
    const messages = await sdk.listMessages(currentSession.id, { limit: 50 })
    if (messages.length === 0) {
      console.log(DIM("\n  No messages yet. Send a prompt to start."))
      return
    }
    console.log()
    console.log(BOLD(`  History — session ${currentSession.id.slice(0, 8)}`))
    console.log(DIM("  " + "─".repeat(54)))
    for (const msg of messages) {
      const role = msg.info?.role ?? (msg as any).role ?? "unknown"
      const roleLabel = role === "user"
        ? BLUE("  You")
        : MAGENTA("  AI ")

      // Extract text from parts (OpenCode uses `text` field, not `content`)
      let text = ""
      const parts = msg.parts ?? (msg as any).message?.parts ?? []
      for (const part of parts) {
        if (part.type === "text" && (part.text ?? part.content)) {
          text += part.text ?? part.content
        } else if (part.type === "reasoning" && part.text) {
          // Show reasoning in dim color
          text += DIM(part.text)
        } else if (part.type === "tool-invocation" || part.type === "tool-result") {
          text += DIM(`[tool: ${(part as any).toolName ?? part.type}]`) + " "
        }
      }

      if (text) {
        console.log()
        console.log(roleLabel)
        if (role === "assistant") {
          console.log("  " + renderMarkdown(text).split("\n").join("\n  "))
        } else {
          console.log("  " + text.trim())
        }
      }
    }
  } catch (e) {
    console.log(RED(`  Error: ${e}`))
  }
}

async function showProviders() {
  try {
    const providers = await sdk.listProviders()
    console.log()
    console.log(BOLD("  Providers & Models"))
    console.log(DIM("  " + "─".repeat(54)))
    for (const p of (providers as any).all ?? []) {
      console.log(`  ${GREEN("●")} ${BOLD(p.name)} ${DIM(`(${p.id})`)} ${DIM(`source: ${p.source ?? "?"}`)}`)
      const models = p.models ?? {}
      for (const [k, m] of Object.entries(models) as any[]) {
        console.log(`    ${CYAN("→")} ${m.name ?? k}`)
        console.log(`      ${DIM(`id: ${m.api?.id ?? m.id}`)}`)
        console.log(`      ${DIM(`context: ${m.limit?.context ?? "?"} | output: ${m.limit?.output ?? "?"}`)}`)
        console.log(`      ${DIM(`tool_call: ${m.capabilities?.toolcall ?? "?"}`)}`)
      }
    }
    console.log()
    console.log(`  ${DIM("Connected:")} ${providers.connected.join(", ")}`)
  } catch (e) {
    console.log(RED(`  Error: ${e}`))
  }
}

async function showFiles() {
  try {
    const files = await sdk.listFiles()
    console.log()
    console.log(BOLD("  Project Files"))
    console.log(DIM("  " + "─".repeat(54)))
    const items = Array.isArray(files) ? files : []
    for (const f of items.slice(0, 40)) {
      const icon = f.type === "directory" ? "📁" : "📄"
      console.log(`  ${icon} ${f.name ?? f.path}`)
    }
    if (items.length > 40) {
      console.log(DIM(`  ... and ${items.length - 40} more`))
    }
  } catch (e) {
    console.log(RED(`  Error: ${e}`))
  }
}

async function showProject() {
  try {
    const project = await sdk.currentProject()
    const vcs = await sdk.vcs()
    console.log()
    console.log(BOLD("  Project"))
    console.log(`  ${DIM("Name:")}      ${project.name ?? "?"}`)
    console.log(`  ${DIM("Directory:")} ${project.directory ?? "?"}`)
    console.log(`  ${DIM("Branch:")}    ${vcs.branch ?? "?"}`)
  } catch (e) {
    console.log(RED(`  Error: ${e}`))
  }
}

async function showTasks() {
  try {
    const tasks = await sdk.listTasks()
    if (tasks.length === 0) {
      console.log(DIM("\n  No tasks in queue."))
      return
    }
    console.log()
    console.log(BOLD(`  Tasks (${tasks.length})`))
    for (const t of tasks) {
      const statusIcon = t.status === "completed" ? GREEN("✓") :
                          t.status === "running" ? YELLOW("⟳") :
                          t.status === "failed" ? RED("✗") : DIM("○")
      console.log(`  ${statusIcon} ${t.id.slice(0, 8)} ${DIM(t.status)} — ${t.prompt.slice(0, 50)}`)
    }
  } catch (e) {
    console.log(RED(`  Error: ${e}`))
  }
}

// ── Backend Feature Handlers ─────────────────────────────────────────

async function showAudit(sub?: string) {
  try {
    if (sub === "stats") {
      const stats = await sdk.auditStats() as any
      console.log()
      console.log(BOLD("  Audit Statistics"))
      console.log(DIM("  " + "─".repeat(54)))
      console.log(`  ${DIM("Total requests:")}  ${BOLD(String(stats.total ?? 0))}`)
      console.log(`  ${DIM("Errors:")}          ${stats.errors > 0 ? RED(String(stats.errors)) : GREEN("0")}`)
      console.log(`  ${DIM("Avg duration:")}    ${stats.avgDuration ?? 0}ms`)
      if (stats.byAction) {
        console.log()
        console.log(DIM("  By Action:"))
        for (const [action, count] of Object.entries(stats.byAction)) {
          console.log(`    ${CYAN(action)}: ${count}`)
        }
      }
    } else {
      const entries = await sdk.queryAudit({ limit: 15 }) as any[]
      console.log()
      console.log(BOLD(`  Recent Audit Logs (${entries.length})`))
      console.log(DIM("  " + "─".repeat(54)))
      if (entries.length === 0) {
        console.log(DIM("  No audit entries yet."))
      }
      for (const e of entries) {
        const time = new Date(e.timestamp).toLocaleTimeString()
        const status = e.success ? GREEN("✓") : RED("✗")
        const meta = e.metadata ? JSON.parse(e.metadata) : {}
        console.log(`  ${status} ${DIM(time)}  ${CYAN(e.action)}  ${DIM(meta.method ?? "")} ${DIM(meta.path ?? "")}`)
      }
    }
  } catch (e) {
    console.log(RED(`  Error: ${e}`))
  }
}

async function showBudget(sub?: string, arg?: string) {
  try {
    if (sub === "check") {
      const result = await sdk.budgetCheck("default", 1000) as any
      console.log()
      console.log(BOLD("  Budget Check"))
      console.log(DIM("  " + "─".repeat(54)))
      console.log(`  ${DIM("Allowed:")}  ${result.allowed ? GREEN("YES") : RED("NO")}`)
      if (result.warnings?.length > 0) {
        for (const w of result.warnings) {
          console.log(`  ${YELLOW("⚠")} ${w}`)
        }
      }
      if (result.remaining) {
        for (const [k, v] of Object.entries(result.remaining)) {
          console.log(`  ${DIM(k + ":")} ${v}`)
        }
      }
    } else if (sub === "set" && arg) {
      const tokens = parseInt(arg)
      if (isNaN(tokens)) {
        console.log(YELLOW("  Usage: /budget set <max-tokens-per-hour>"))
        return
      }
      await sdk.setBudgetLimits({ window: "hour", maxTokens: tokens, hardLimit: true })
      console.log(GREEN(`  ✓ Hourly token limit set to ${tokens.toLocaleString()}`))
    } else {
      // Show summary
      const summary = await sdk.budgetSummary("default") as any
      console.log()
      console.log(BOLD("  Budget Usage Summary"))
      console.log(DIM("  " + "─".repeat(54)))
      for (const window of ["hour", "day", "month"]) {
        const w = summary[window]
        if (w) {
          const tokens = w.tokensUsed ?? 0
          const reqs = w.requestCount ?? 0
          const cost = w.costCents ?? 0
          console.log(`  ${BOLD(window.charAt(0).toUpperCase() + window.slice(1))}:`)
          console.log(`    ${DIM("Tokens used:")}   ${tokens.toLocaleString()}`)
          console.log(`    ${DIM("Requests:")}      ${reqs}`)
          console.log(`    ${DIM("Cost (cents):")}  ${cost}`)
        }
      }
    }
  } catch (e) {
    console.log(RED(`  Error: ${e}`))
  }
}

async function showWorkspaces() {
  try {
    const list = await sdk.listWorkspaces() as any[]
    console.log()
    console.log(BOLD(`  Workspaces (${list.length})`))
    console.log(DIM("  " + "─".repeat(54)))
    if (list.length === 0) {
      console.log(DIM("  No workspaces. Use /workspace new to create one."))
      return
    }
    for (const ws of list) {
      const active = ws.active ? GREEN(" ◀ active") : ""
      const tags = ws.tags?.length > 0 ? DIM(` [${ws.tags.join(", ")}]`) : ""
      console.log(`  ${ws.active ? GREEN("●") : DIM("○")} ${BOLD(ws.name)} ${DIM(ws.id.slice(0, 8))}${tags}${active}`)
      console.log(`    ${DIM(ws.directory)}`)
    }
  } catch (e) {
    console.log(RED(`  Error: ${e}`))
  }
}

async function createWorkspaceInteractive() {
  return new Promise<void>((resolve) => {
    rl.question(`  ${DIM("Workspace name:")} `, (name) => {
      if (!name.trim()) {
        console.log(YELLOW("  Cancelled."))
        resolve()
        return
      }
      rl.question(`  ${DIM("Directory path:")} `, async (dir) => {
        if (!dir.trim()) {
          console.log(YELLOW("  Cancelled."))
          resolve()
          return
        }
        rl.question(`  ${DIM("Tags (comma-separated, or empty):")} `, async (tagsStr) => {
          try {
            const tags = tagsStr.trim() ? tagsStr.split(",").map(t => t.trim()) : []
            const ws = await sdk.createWorkspace({ name: name.trim(), directory: dir.trim(), tags }) as any
            console.log(GREEN(`  ✓ Workspace created: ${ws.name} (${ws.id.slice(0, 8)})`))
          } catch (e: any) {
            console.log(RED(`  Error: ${e.message ?? e}`))
          }
          resolve()
        })
      })
    })
  })
}

async function switchWorkspaceInteractive() {
  try {
    const list = await sdk.listWorkspaces() as any[]
    if (list.length === 0) {
      console.log(DIM("  No workspaces. Use /workspace new first."))
      return
    }
    console.log()
    for (let i = 0; i < list.length; i++) {
      const ws = list[i]
      const active = ws.active ? GREEN(" ◀") : ""
      console.log(`  ${CYAN(String(i + 1))}. ${ws.name} ${DIM(ws.directory)}${active}`)
    }
    return new Promise<void>((resolve) => {
      rl.question(`\n  ${DIM("Enter number to switch:")} `, async (num) => {
        const idx = parseInt(num) - 1
        if (isNaN(idx) || idx < 0 || idx >= list.length) {
          console.log(YELLOW("  Cancelled."))
          resolve()
          return
        }
        try {
          await sdk.switchWorkspace(list[idx].id)
          console.log(GREEN(`  ✓ Switched to ${list[idx].name}`))
        } catch (e: any) {
          console.log(RED(`  Error: ${e.message ?? e}`))
        }
        resolve()
      })
    })
  } catch (e) {
    console.log(RED(`  Error: ${e}`))
  }
}

async function showQueueMetrics() {
  try {
    const m = await sdk.queueMetrics() as any
    console.log()
    console.log(BOLD("  Queue Metrics"))
    console.log(DIM("  " + "─".repeat(54)))
    console.log(`  ${DIM("Running workers:")}   ${BOLD(String(m.running ?? 0))}`)
    console.log(`  ${DIM("Queued tasks:")}      ${m.queued ?? 0}`)
    console.log(`  ${DIM("Concurrency limit:")} ${m.concurrencyLimit ?? 0}`)
    console.log(`  ${DIM("Queue depth limit:")} ${m.queueDepthLimit ?? 0}`)
    if (m.stats) {
      console.log()
      console.log(DIM("  Task States:"))
      for (const [state, count] of Object.entries(m.stats)) {
        if (state === "total") continue
        const val = count as number
        const color = state === "completed" ? GREEN : state === "failed" ? RED : state === "running" ? YELLOW : DIM
        console.log(`    ${color(state)}: ${val}`)
      }
      console.log(`    ${BOLD("total")}: ${m.stats.total ?? 0}`)
    }
  } catch (e) {
    console.log(RED(`  Error: ${e}`))
  }
}

async function showOrchestrations() {
  try {
    const list = await sdk.listOrchestrations() as any[]
    console.log()
    console.log(BOLD(`  Orchestrations (${list.length})`))
    console.log(DIM("  " + "─".repeat(54)))
    if (list.length === 0) {
      console.log(DIM("  No orchestrations yet. Use /orchestrate to start one."))
      return
    }
    for (const o of list) {
      const statusIcon = o.status === "completed" ? GREEN("✓") :
                          o.status === "running" ? YELLOW("⟳") :
                          o.status === "failed" ? RED("✗") : DIM("○")
      const tasks = o.tasks ?? []
      const done = tasks.filter((t: any) => t.status === "completed").length
      console.log(`  ${statusIcon} ${BOLD(o.name)} ${DIM(o.id.slice(0, 8))} — ${done}/${tasks.length} tasks ${DIM(o.status)}`)
      for (const t of tasks) {
        const tIcon = t.status === "completed" ? GREEN("✓") :
                      t.status === "running" ? YELLOW("⟳") :
                      t.status === "failed" ? RED("✗") : DIM("○")
        console.log(`    ${tIcon} ${t.label} ${DIM(t.status)}`)
      }
    }
  } catch (e) {
    console.log(RED(`  Error: ${e}`))
  }
}

async function startOrchestrationInteractive() {
  return new Promise<void>((resolve) => {
    rl.question(`  ${DIM("Orchestration name:")} `, (name) => {
      if (!name.trim()) { console.log(YELLOW("  Cancelled.")); resolve(); return }

      const tasks: { label: string; prompt: string; dependsOn?: string[] }[] = []

      const addTask = () => {
        rl.question(`  ${DIM(`Task ${tasks.length + 1} label (empty to finish):`)} `, (label) => {
          if (!label.trim()) {
            if (tasks.length === 0) {
              console.log(YELLOW("  Need at least 1 task. Cancelled."))
              resolve()
              return
            }
            // Submit orchestration
            submitOrchestration(name.trim(), tasks).then(resolve)
            return
          }
          rl.question(`    ${DIM("Prompt:")} `, (prompt) => {
            if (!prompt.trim()) { console.log(YELLOW("  Skipped.")); addTask(); return }
            rl.question(`    ${DIM("Depends on (comma-separated labels, or empty):")} `, (deps) => {
              const dependsOn = deps.trim() ? deps.split(",").map(d => d.trim()) : undefined
              tasks.push({ label: label.trim(), prompt: prompt.trim(), dependsOn })
              console.log(GREEN(`    ✓ Added task: ${label.trim()}`))
              addTask()
            })
          })
        })
      }
      addTask()
    })
  })
}

async function submitOrchestration(name: string, tasks: { label: string; prompt: string; dependsOn?: string[] }[]) {
  try {
    startSpinner("Starting orchestration...")
    const result = await sdk.startOrchestration({ name, tasks, maxConcurrency: 3 }) as any
    stopSpinner()
    console.log(GREEN(`  ✓ Orchestration started: ${result.id?.slice(0, 8) ?? "?"} — ${tasks.length} tasks`))
    console.log(DIM(`    Use /orchestrations to monitor progress`))
  } catch (e: any) {
    stopSpinner()
    console.log(RED(`  Error: ${e.message ?? e}`))
  }
}

async function showParallelExecutions() {
  try {
    const list = await sdk.listParallelExecutions() as any[]
    console.log()
    console.log(BOLD(`  Parallel Executions (${list.length})`))
    console.log(DIM("  " + "─".repeat(54)))
    if (list.length === 0) {
      console.log(DIM("  No parallel executions yet. Use /parallel to start one."))
      return
    }
    for (const exec of list) {
      const statusIcon = exec.status === "completed" ? GREEN("✓") :
                          exec.status === "running" ? YELLOW("⟳") :
                          exec.status === "failed" ? RED("✗") : DIM("○")
      const tasks = exec.tasks ?? []
      const done = tasks.filter((t: any) => t.status === "completed").length
      console.log(`  ${statusIcon} ${BOLD(exec.name)} ${DIM(exec.id.slice(0, 8))} — ${done}/${tasks.length} tasks ${DIM(exec.status)}`)
      for (const t of tasks) {
        const tIcon = t.status === "completed" ? GREEN("✓") :
                      t.status === "running" ? YELLOW("⟳") :
                      t.status === "failed" ? RED("✗") : DIM("○")
        console.log(`    ${tIcon} ${t.label} ${DIM(t.status)}`)
      }
      if (exec.aggregatedResult) {
        console.log(`    ${MAGENTA("Fan-in result:")} ${exec.aggregatedResult.slice(0, 100)}...`)
      }
    }
  } catch (e) {
    console.log(RED(`  Error: ${e}`))
  }
}

async function startParallelInteractive() {
  return new Promise<void>((resolve) => {
    rl.question(`  ${DIM("Execution name:")} `, (name) => {
      if (!name.trim()) { console.log(YELLOW("  Cancelled.")); resolve(); return }

      const tasks: { label: string; prompt: string; dependsOn?: string[] }[] = []

      const addTask = () => {
        rl.question(`  ${DIM(`Task ${tasks.length + 1} label (empty to finish):`)} `, (label) => {
          if (!label.trim()) {
            if (tasks.length === 0) {
              console.log(YELLOW("  Need at least 1 task. Cancelled."))
              resolve()
              return
            }
            rl.question(`  ${DIM("Fan-in prompt (empty to skip):")} `, async (fanIn) => {
              try {
                startSpinner("Starting parallel execution...")
                const result = await sdk.executeParallel({
                  name: name.trim(),
                  concurrency: 3,
                  timeoutMs: 120000,
                  fanInPrompt: fanIn.trim() || undefined,
                  tasks,
                }) as any
                stopSpinner()
                console.log(GREEN(`  ✓ Parallel execution started: ${result.id?.slice(0, 8) ?? "?"} — ${tasks.length} tasks`))
                console.log(DIM(`    Use /parallel list to monitor progress`))
              } catch (e: any) {
                stopSpinner()
                console.log(RED(`  Error: ${e.message ?? e}`))
              }
              resolve()
            })
            return
          }
          rl.question(`    ${DIM("Prompt:")} `, (prompt) => {
            if (!prompt.trim()) { console.log(YELLOW("  Skipped.")); addTask(); return }
            rl.question(`    ${DIM("Depends on (comma-separated labels, or empty):")} `, (deps) => {
              const dependsOn = deps.trim() ? deps.split(",").map(d => d.trim()) : undefined
              tasks.push({ label: label.trim(), prompt: prompt.trim(), dependsOn })
              console.log(GREEN(`    ✓ Added task: ${label.trim()}`))
              addTask()
            })
          })
        })
      }
      addTask()
    })
  })
}

// ── Send prompt to LLM ──────────────────────────────────────────────

async function sendPrompt(content: string) {
  if (!currentSession) {
    console.log(YELLOW("  No active session. Creating one..."))
    await createNewSession()
    if (!currentSession) return
  }

  isWaiting = true
  startSpinner("Thinking via vLLM...")

  try {
    // Use SDK prompt method — SDK → Platform backend → OpenCode → vLLM
    const response = await sdk.prompt(currentSession!.id, { content })

    stopSpinner()

    // Extract assistant text from response parts
    let text = ""
    let toolCalls: string[] = []
    const parts = response.parts ?? (response as any).message?.parts ?? []

    for (const part of parts) {
      if (part.type === "text" && (part.text ?? part.content)) {
        text += part.text ?? part.content
      } else if (part.type === "reasoning" && part.text) {
        // Show reasoning before main response
        console.log()
        console.log(DIM("  ┌─ Reasoning " + "─".repeat(41)))
        const rLines = (part.text as string).trim().split("\n")
        for (const rl of rLines) {
          console.log(DIM("  │ " + rl))
        }
        console.log(DIM("  └" + "─".repeat(55)))
      } else if (part.type === "tool-invocation") {
        toolCalls.push((part as any).toolName ?? "tool")
      } else if (part.type === "tool-result") {
        toolCalls.push(`${(part as any).toolName ?? "tool"} → result`)
      }
    }

    // Show tool calls if any
    if (toolCalls.length > 0) {
      console.log()
      console.log(DIM("  Tools used:"))
      for (const tc of toolCalls) {
        console.log(`    ${YELLOW("⚙")} ${DIM(tc)}`)
      }
    }

    // Show assistant response
    if (text) {
      console.log()
      console.log(MAGENTA("  ┌─ Assistant ") + DIM("─".repeat(42)))
      const rendered = renderMarkdown(text)
      const lines = rendered.split("\n")
      for (const line of lines) {
        console.log(MAGENTA("  │ ") + line)
      }
      console.log(MAGENTA("  └" + DIM("─".repeat(55))))
    } else if (toolCalls.length === 0) {
      console.log(DIM("\n  (empty response)"))
    }

  } catch (e) {
    stopSpinner()
    if (e instanceof PlatformApiError) {
      console.log(RED(`\n  API Error (${e.status}): ${e.message}`))
      if (e.body) console.log(DIM(`  ${e.body.slice(0, 200)}`))
    } else {
      console.log(RED(`\n  Error: ${e}`))
    }
  } finally {
    isWaiting = false
  }
}

// ── Command dispatcher ───────────────────────────────────────────────

async function handleInput(line: string) {
  const trimmed = line.trim()
  if (!trimmed) {
    prompt()
    return
  }

  if (trimmed.startsWith("/")) {
    const [cmd, ...args] = trimmed.split(/\s+/)
    const arg = args.join(" ")

    switch (cmd) {
      case "/new":
        await createNewSession()
        break
      case "/sessions":
      case "/ls":
        await listSessions()
        break
      case "/switch":
      case "/sw":
        if (!arg) {
          console.log(YELLOW("  Usage: /switch <session-id-prefix>"))
        } else {
          await switchSession(arg)
        }
        break
      case "/delete":
      case "/del":
        if (!arg) {
          console.log(YELLOW("  Usage: /delete <session-id-prefix>"))
        } else {
          await deleteSession(arg)
        }
        break
      case "/history":
      case "/h":
        await showHistory()
        break
      case "/status":
      case "/st":
        await showStatus()
        break
      case "/providers":
      case "/models":
        await showProviders()
        break
      case "/files":
        await showFiles()
        break
      case "/project":
        await showProject()
        break
      case "/vcs":
      case "/git":
        try {
          const vcs = await sdk.vcs()
          console.log(`  ${DIM("Branch:")} ${vcs.branch}`)
        } catch (e) {
          console.log(RED(`  Error: ${e}`))
        }
        break
      case "/tasks":
        await showTasks()
        break

      // ── Backend feature commands ─────────────────────────────
      case "/audit":
        await showAudit(arg || undefined)
        break
      case "/budget":
        if (arg.startsWith("set ")) {
          await showBudget("set", arg.slice(4).trim())
        } else {
          await showBudget(arg || undefined)
        }
        break
      case "/workspaces":
        await showWorkspaces()
        break
      case "/workspace":
        if (arg === "new" || arg === "create") {
          await createWorkspaceInteractive()
        } else if (arg === "switch" || arg === "sw") {
          await switchWorkspaceInteractive()
        } else {
          await showWorkspaces()
        }
        break
      case "/queue":
        await showQueueMetrics()
        break
      case "/orchestrate":
        await startOrchestrationInteractive()
        break
      case "/orchestrations":
        await showOrchestrations()
        break
      case "/parallel":
        if (arg === "list" || arg === "ls") {
          await showParallelExecutions()
        } else {
          await startParallelInteractive()
        }
        break

      case "/clear":
        console.clear()
        console.log(LOGO)
        break
      case "/help":
        console.log(HELP_TEXT)
        break
      case "/quit":
      case "/exit":
      case "/q":
        console.log(DIM("\n  Goodbye!\n"))
        process.exit(0)
      default:
        console.log(YELLOW(`  Unknown command: ${cmd}. Type /help for commands.`))
    }
  } else {
    // Not a command — send as prompt to LLM via SDK
    await sendPrompt(trimmed)
  }

  prompt()
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.clear()
  console.log(LOGO)
  console.log(DIM(`  Connecting to ${PLATFORM_URL} ...`))

  // Check health first
  const healthy = await checkHealth()
  if (!healthy) {
    console.log(RED(`\n  ✗ Cannot reach platform at ${PLATFORM_URL}`))
    console.log(DIM("    Make sure the backend is running: bun run start"))
    console.log(DIM(`    Set KADAVULEY_URL env var if using a different address\n`))
    process.exit(1)
  }

  // Show status on startup
  await showStatus()

  // Auto-load or create a session
  try {
    const sessions = await sdk.listSessions({ limit: 1 })
    if (sessions.length > 0) {
      currentSession = sessions[0]
      console.log()
      console.log(GREEN(`  ✓ Resumed session ${currentSession.id.slice(0, 8)} — "${currentSession.title || "(untitled)"}"`))
    } else {
      await createNewSession()
    }
  } catch {
    await createNewSession()
  }

  console.log(HELP_TEXT)

  rl.on("line", (line) => {
    if (isWaiting) return
    handleInput(line)
  })

  rl.on("close", () => {
    console.log(DIM("\n  Goodbye!\n"))
    process.exit(0)
  })

  prompt()
}

main().catch((err) => {
  console.error(RED("Fatal error:"), err)
  process.exit(1)
})
