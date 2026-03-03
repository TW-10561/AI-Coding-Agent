// ---------------------------------------------------------------------------
// handlers.ts — All command handlers for the Artemis TUI
// Each function is self-contained and uses ui.ts for rendering
// ---------------------------------------------------------------------------

import { PlatformClient, PlatformApiError } from "../../src/sdk/client"
import type { SessionInfo } from "../../src/types"
import { C, Box, TERM_WIDTH } from "./theme"
import * as ui from "./ui"
import * as readline from "readline"

// ── Types ────────────────────────────────────────────────────────────

export interface TuiState {
  sdk: PlatformClient
  currentSession: SessionInfo | null
  currentAgent: string        // active agent mode (default: "build")
  rl: readline.Interface
}

// ── Health & Status ──────────────────────────────────────────────────

export async function checkHealth(state: TuiState): Promise<boolean> {
  try {
    const health = await state.sdk.health()
    return health.platform === "ok" && health.opencode === "ok"
  } catch {
    return false
  }
}

export async function showStatus(state: TuiState) {
  // ── Health ───────────────────────────────────────────────────────
  let health: any
  try {
    health = await state.sdk.health()
  } catch (e) {
    ui.errorMsg(`Cannot reach platform: ${e}`)
    return
  }

  const lines: string[] = []
  lines.push(`${ui.statusDot(health.platform === "ok")} ${C.muted("Platform")}   ${health.platform === "ok" ? C.success("connected") : C.error("down")}`)
  lines.push(`${ui.statusDot(health.opencode === "ok")} ${C.muted("OpenCode")}   ${health.opencode === "ok" ? C.success("connected") : C.error("down")}`)
  lines.push(`${C.muted("  Uptime")}      ${C.text(health.uptime != null ? Math.floor(health.uptime / 1000) + "s" : "?")}`)
  lines.push(`${C.muted("  Version")}     ${C.text(health.version ?? "?")}`)

  ui.panel({
    title: C.textBold("System Status"),
    body: lines,
    color: C.dim,
  })

  // ── Providers & Models (separate catch so health panel always shows) ──
  try {
    const providers = await state.sdk.listProviders()
    const allProviders = (providers as any).all ?? []
    if (allProviders.length > 0) {
      const provLines: string[] = []
      provLines.push(`${C.muted("Connected:")} ${C.accent(providers.connected.join(", ") || "none")}`)
      for (const p of allProviders) {
        provLines.push("")
        provLines.push(`${C.success(Box.dot)} ${C.textBold(p.name)} ${C.dim(`(${p.id})`)}`)
        const models = p.models ?? {}
        for (const [k, m] of Object.entries(models) as any[]) {
          const name = m.name ?? k
          const ctx = m.limit?.context ?? "?"
          const out = m.limit?.output ?? "?"
          provLines.push(`  ${C.accent(Box.arrow)} ${C.text(name)}  ${C.muted(`ctx:${ctx}  out:${out}`)}`)
        }
      }
      ui.panel({
        title: C.textBold("LLM Providers"),
        body: provLines,
        color: C.dim,
      })
    }
  } catch {
    // Provider list is optional — health panel already shown above
  }
}

// ── Agent Management ─────────────────────────────────────────────────

// OpenCode natively defines agents with mode = "primary" | "subagent" | "all".
// Primary agents are user-facing (build, plan). Subagents are called internally
// by the orchestrator (explore, general, etc.) — we show "all" and "primary".
// We never hardcode the list: it comes live from GET :4096/agent via the SDK.

/** Round-robin color palette for agents not matching a known name */
const PALETTE: ReadonlyArray<(s: string) => string> = [
  C.success, C.info, C.accent, C.warning, C.primary, C.primaryDim, C.highlight,
]

/** Well-known agent colors (OpenCode native agents) */
const KNOWN_COLORS: Record<string, (s: string) => string> = {
  build:   C.success,
  plan:    C.info,
  general: C.accent,
  explore: C.warning,
  summary: C.muted,
  title:   C.muted,
}

/** Return a deterministic color for any agent ID */
function agentColor(agentID: string): (s: string) => string {
  if (KNOWN_COLORS[agentID]) return KNOWN_COLORS[agentID]!
  // stable but arbitrary: hash the string to a palette index
  let h = 0
  for (let i = 0; i < agentID.length; i++) h = (h * 31 + agentID.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]!
}

export function agentLabel(agentID: string): string {
  const color = agentColor(agentID)
  const name = agentID.charAt(0).toUpperCase() + agentID.slice(1)
  return color(name)
}

/** Cache live agents so repeated calls don't hammer the API */
let _agentCache: Array<{ id: string; name: string; description?: string; mode: string; native?: boolean }> | null = null
let _agentCacheTs = 0
const AGENT_CACHE_TTL_MS = 30_000   // 30 seconds

async function fetchAgents(state: TuiState) {
  const now = Date.now()
  if (_agentCache && now - _agentCacheTs < AGENT_CACHE_TTL_MS) return _agentCache
  try {
    const raw = await state.sdk.listAgents() as any[]
    _agentCache = raw.map(a => ({
      id:          a.id ?? a.name,     // OpenCode returns { name, mode, native, ... }
      name:        a.name ?? a.id,
      description: a.description,
      mode:        a.mode ?? "primary",
      native:      a.native ?? false,
    }))
    _agentCacheTs = now
    return _agentCache
  } catch {
    // Return hardcoded minimum so the TUI never breaks if OpenCode is down
    return [
      { id: "build",   name: "build",   description: "Default agent — full read/write/execute",  mode: "primary", native: true },
      { id: "plan",    name: "plan",    description: "Plan mode — read-only, no file edits",      mode: "primary", native: true },
      { id: "explore", name: "explore", description: "Explore mode — codebase search & analysis", mode: "all",     native: true },
      { id: "general", name: "general", description: "General agent — multi-step reasoning",       mode: "all",     native: true },
    ]
  }
}

export async function listAgents(state: TuiState) {
  const agents = await fetchAgents(state)
  // Show primary + all mode agents; hide internal-only ones (mode=subagent, hidden)
  // OpenCode marks hidden agents like 'title', 'summary', 'compaction' — skip those.
  const HIDDEN = new Set(["title", "summary", "compaction"])
  const visible = agents.filter(a =>
    (a.mode === "primary" || a.mode === "all") && !HIDDEN.has(a.id)
  )
  // If nothing passes (e.g. old OpenCode without mode field), show everything
  const toShow = visible.length > 0 ? visible : agents

  const lines: string[] = []
  for (const a of toShow) {
    const isActive = a.id === state.currentAgent
    const active = isActive ? C.success(" ◀ active") : ""
    const color = agentColor(a.id)
    const modeTag = a.mode && a.mode !== "primary" ? C.dim(` [${a.mode}]`) : ""
    const nativeTag = a.native ? C.dim(" ◆") : ""
    lines.push(`${color(Box.dot)} ${C.textBold(a.name)}${nativeTag}${modeTag}${active}`)
    if (a.description) lines.push(`  ${C.muted(a.description.slice(0, 78))}`)
  }

  console.log()
  ui.panel({ title: C.textBold("Agents"), body: lines, color: C.dim })

  // Show switch hints based on what's actually available
  const switchHints = toShow.slice(0, 4).map(a => `/${a.id}`).join("  ")
  console.log(`  ${C.dim("Switch with:")} ${C.dim(switchHints)}`)
}

export async function switchAgent(state: TuiState, agentID: string) {
  // Validate against live agent list; allow anyway if API is down (non-blocking)
  const agents = await fetchAgents(state)
  const match = agents.find(a => a.id === agentID || a.name === agentID)
  if (!match && agents.length > 0) {
    const validIDs = agents.map(a => a.id).join(", ")
    ui.warnMsg(`Unknown agent: ${agentID}. Available: ${validIDs}`)
    return
  }

  const prev = state.currentAgent
  const resolvedID = match?.id ?? agentID   // prefer canonical id from API
  state.currentAgent = resolvedID

  try {
    ui.startSpinner(`Switching to ${resolvedID} agent...`)
    const session = await state.sdk.createSession({ agentID: resolvedID })
    ui.stopSpinner()
    state.currentSession = session
    ui.successMsg(`Agent: ${agentLabel(prev)} ${Box.arrow} ${agentLabel(resolvedID)}`)
    console.log(`    ${C.muted("New session:")} ${C.accent(session.id.slice(0, 8))}`)
  } catch (e) {
    ui.stopSpinner()
    // Keep the agent switch even if session creation fails
    ui.successMsg(`Agent: ${agentLabel(prev)} ${Box.arrow} ${agentLabel(resolvedID)}`)
    ui.warnMsg(`Could not create session for agent (${e}). Use /new to create one.`)
  }
}

// ── Session Management ───────────────────────────────────────────────

export async function createNewSession(state: TuiState): Promise<SessionInfo | null> {
  try {
    ui.startSpinner("Creating session...")
    const session = await state.sdk.createSession({
      agentID: state.currentAgent || undefined,
    })
    ui.stopSpinner()
    state.currentSession = session
    ui.successMsg(`Session created: ${C.accent(session.id.slice(0, 8))}`)
    console.log(`    ${C.muted("Agent:")} ${agentLabel(state.currentAgent)}`)
    return session
  } catch (e) {
    ui.stopSpinner()
    ui.errorMsg(`Failed to create session: ${e}`)
    return null
  }
}

export async function listSessions(state: TuiState) {
  try {
    const sessions = await state.sdk.listSessions({ limit: 20 })
    if (sessions.length === 0) {
      ui.emptyState("No sessions yet.", "Use /new to start one.")
      return
    }

    const rows: string[][] = []
    for (const s of sessions) {
      const active = state.currentSession?.id === s.id ? C.success(" ◀") : ""
      const ts = s.updatedAt ?? s.createdAt
      const date = ts
        ? (typeof ts === "number" && ts > 1e12 ? new Date(ts) : new Date(ts as any)).toLocaleDateString("en-US", { month: "short", day: "numeric" })
        : "?"
      rows.push([
        C.accent(s.id.slice(0, 8)),
        C.text(truncate(s.title || "(untitled)", 32)),
        C.muted(date),
        active,
      ])
    }
    console.log()
    ui.panel({
      title: C.textBold(`Sessions (${sessions.length})`),
      body: rows.map(r => `${r[0]}  ${r[1]}  ${r[2]}${r[3]}`),
      color: C.dim,
    })
  } catch (e) {
    ui.errorMsg(`Error: ${e}`)
  }
}

export async function switchSession(state: TuiState, id: string) {
  try {
    const sessions = await state.sdk.listSessions({ limit: 100 })
    const match = sessions.find(s => s.id.startsWith(id) || s.id === id)
    if (!match) {
      ui.errorMsg(`Session not found: ${id}`)
      return
    }
    state.currentSession = match
    ui.successMsg(`Switched to session ${C.accent(match.id.slice(0, 8))}`)
    console.log(`    ${C.muted("Title:")} ${C.text(match.title || "(untitled)")}`)
  } catch (e) {
    ui.errorMsg(`Error: ${e}`)
  }
}

export async function deleteSession(state: TuiState, id: string) {
  try {
    const sessions = await state.sdk.listSessions({ limit: 100 })
    const match = sessions.find(s => s.id.startsWith(id) || s.id === id)
    if (!match) {
      ui.errorMsg(`Session not found: ${id}`)
      return
    }
    await state.sdk.deleteSession(match.id)
    ui.successMsg(`Deleted session ${C.accent(match.id.slice(0, 8))}`)
    if (state.currentSession?.id === match.id) {
      state.currentSession = null
    }
  } catch (e) {
    ui.errorMsg(`Error: ${e}`)
  }
}

// ── Chat History ─────────────────────────────────────────────────────

export async function showHistory(state: TuiState) {
  if (!state.currentSession) {
    ui.warnMsg("No active session. Use /new or /switch <id>")
    return
  }
  try {
    const messages = await state.sdk.listMessages(state.currentSession.id, { limit: 50 })
    if (messages.length === 0) {
      ui.emptyState("No messages yet.", "Type something to start chatting.")
      return
    }

    console.log()
    console.log(`  ${C.textBold("Conversation")} ${C.muted("— session " + state.currentSession.id.slice(0, 8))}`)
    console.log(`  ${C.dim(Box.h.repeat(Math.max(1, TERM_WIDTH() - 4)))}`)

    for (const msg of messages) {
      const role = msg.info?.role ?? (msg as any).role ?? "unknown"
      const parts = msg.parts ?? (msg as any).message?.parts ?? []

      let text = ""
      let reasoning = ""
      for (const part of parts) {
        if (part.type === "text" && (part.text ?? part.content)) {
          text += part.text ?? part.content
        } else if (part.type === "reasoning" && part.text) {
          reasoning += part.text
        } else if (part.type === "tool-invocation" || part.type === "tool-result") {
          // Skip in history view for cleanliness
        }
      }

      if (text) {
        if (role === "user") {
          ui.userMessage(text.trim())
        } else {
          if (reasoning) ui.reasoningBlock(reasoning)
          ui.assistantMessage(text, undefined)
        }
      }
    }
  } catch (e) {
    ui.errorMsg(`Error: ${e}`)
  }
}

// ── Send Prompt ──────────────────────────────────────────────────────

export async function sendPrompt(state: TuiState, content: string): Promise<void> {
  if (!state.currentSession) {
    console.log(`  ${C.muted("No active session — creating one...")}`)
    await createNewSession(state)
    if (!state.currentSession) return
  }

  // Show user message
  ui.userMessage(content)

  ui.startSpinner("Thinking...")

  try {
    // Race the API call against a 120-second timeout so the TUI never hangs
    const PROMPT_TIMEOUT_MS = 120_000
    const response = await Promise.race([
      state.sdk.prompt(state.currentSession!.id, {
        content,
        agentID: state.currentAgent || undefined,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LLM request timed out after 120 s — is vLLM running?")), PROMPT_TIMEOUT_MS)
      ),
    ])
    ui.stopSpinner()

    // Check for server-side error in the response (e.g. vLLM unreachable)
    const respError = (response as any).info?.error
    if (respError) {
      const errMsg = respError.data?.message ?? respError.name ?? String(respError)
      if (respError.name === "ContextOverflowError" || errMsg.toLowerCase().includes("context length")) {
        ui.errorMsg("Session context is full.")
        console.log(`    ${C.dim("Use /new to start a fresh session, or /delete this one.")}`)
      } else if (errMsg.toLowerCase().includes("connect") || errMsg.toLowerCase().includes("url")) {
        ui.errorMsg(`Cannot reach model: ${errMsg}`)
        console.log(`    ${C.dim("Check VLLM_BASE_URL in .env and make sure vLLM is running.")}`)
      } else {
        ui.errorMsg(`Model error: ${errMsg}`)
      }
      return
    }

    // Extract parts
    let text = ""
    let reasoning = ""
    const toolCalls: string[] = []
    const parts = response.parts ?? (response as any).message?.parts ?? []

    // Token info
    let tokens = 0
    for (const part of parts) {
      if (part.type === "text" && (part.text ?? part.content)) {
        text += part.text ?? part.content
      } else if (part.type === "reasoning" && part.text) {
        reasoning += part.text
      } else if (part.type === "tool-invocation") {
        toolCalls.push((part as any).toolName ?? "tool")
      } else if (part.type === "tool-result") {
        toolCalls.push(`${(part as any).toolName ?? "tool"} ${Box.arrow} result`)
      } else if (part.type === "step-finish") {
        tokens = (part as any).tokens?.output ?? (part as any).tokens?.total ?? 0
      }
    }

    // Show reasoning if present
    if (reasoning) {
      ui.reasoningBlock(reasoning)
    }

    // Show tool calls if any
    if (toolCalls.length > 0) {
      console.log()
      console.log(`  ${C.muted("Tools used:")}`)
      for (const tc of toolCalls) {
        ui.toolCallLine(tc)
      }
    }

    // Show assistant response
    if (text) {
      const tokenStr = tokens > 0 ? `${tokens.toLocaleString()} tokens` : undefined
      ui.assistantMessage(text, tokenStr)
    } else if (reasoning && toolCalls.length === 0) {
      // Model returned reasoning only (no separate text part).
      // Show the last meaningful line as a summary so the user isn't left with nothing.
      const lastLine = reasoning.trim().split("\n").filter(l => l.trim()).pop() ?? ""
      ui.assistantMessage(lastLine || "(model returned reasoning only — no text response)", undefined)
    } else if (toolCalls.length === 0) {
      ui.emptyState("(empty response)")
    }

  } catch (e) {
    ui.stopSpinner()
    if (e instanceof PlatformApiError) {
      ui.errorMsg(`API Error (${e.status})`, e.message)
      if (e.body) console.log(`    ${C.dim(e.body.slice(0, 200))}`)
    } else {
      ui.errorMsg(`${e}`)
    }
  }
}

// ── Provider Registry (Artemis model catalogue) ─────────────────────

export async function showRegistry(state: TuiState, sub?: string) {
  try {
    const isRefresh = sub === "refresh"
    if (isRefresh) {
      ui.startSpinner("Probing all vLLM endpoints...")
      await state.sdk.refreshRegistry()
      ui.stopSpinner()
    }

    const reg = await state.sdk.registry()
    if (!reg) {
      ui.warnMsg("Registry not available — upgrade the platform backend.")
      return
    }

    console.log()

    // ── Local vLLM providers ──────────────────────────────────────
    const localLines: string[] = []
    for (const p of reg.local as any[]) {
      const statusColor = p.status === "online" ? C.success :
                          p.status === "offline" ? C.error : C.muted
      const statusText = p.status === "online"
        ? `${C.success("●")} online${p.latencyMs ? C.muted(` ${p.latencyMs}ms`) : ""}`
        : p.status === "offline" ? `${C.error("●")} offline` : `${C.muted("●")} unknown`

      const primary = p.isPrimary ? C.dim(" ⬡ primary") : ""
      localLines.push(`${statusColor(Box.dot)} ${C.textBold(p.name)}${primary}  ${statusText}`)
      localLines.push(`  ${C.muted("endpoint:")} ${C.dim(p.endpoint)}`)
      for (const m of (p.models as any[]).slice(0, 5)) {
        const ctx = m.contextLimit ? C.dim(` ctx:${(m.contextLimit / 1000).toFixed(0)}k`) : ""
        const out = m.outputLimit  ? C.dim(` out:${m.outputLimit}`) : ""
        localLines.push(`    ${C.accent(Box.arrow)} ${C.text(m.name ?? m.id)}${ctx}${out}`)
      }
      if (p.models.length > 5) localLines.push(`  ${C.dim(`… +${p.models.length - 5} more models`)}`)
    }
    ui.panel({ title: C.textBold("Local vLLM Providers"), body: localLines.length ? localLines : [C.muted("No vLLM endpoints configured.")], color: C.dim })

    // ── Cloud providers ───────────────────────────────────────────
    const cloudLines: string[] = []
    for (const p of reg.cloud as any[]) {
      const icon = p.configured ? C.success(Box.check) : C.muted(Box.diamond)
      const keyNote = p.configured
        ? C.success("  key configured")
        : C.muted(`  set ${p.keyEnvVar} to enable`)
      cloudLines.push(`${icon} ${C.textBold(p.name)}${keyNote}`)
      if (p.configured) {
        for (const m of (p.models as any[]).slice(0, 3)) {
          const cost = `$${m.costIn}/$${m.costOut} per M tokens`
          cloudLines.push(`  ${C.accent(Box.arrow)} ${C.text(m.name)}  ${C.dim(cost)}`)
        }
        if (p.models.length > 3) cloudLines.push(`  ${C.dim(`… +${p.models.length - 3} more`)}`)
      }
    }
    ui.panel({
      title: C.textBold("Cloud Providers"),
      body: cloudLines.length ? cloudLines : [C.muted("No cloud providers configured."), C.dim("Add API keys to .env and restart the platform.")],
      color: C.dim,
    })

    console.log(`  ${C.dim("Active model:")} ${C.accent(reg.activeModel)}`)
    console.log(`  ${C.dim("Use /registry refresh to re-probe vLLM endpoints.")}`)
    console.log(`  ${C.dim("Add cloud API keys to .env then restart the platform.")}`)
  } catch (e) {
    ui.errorMsg(`Registry error: ${e}`)
  }
}

// ── Providers ────────────────────────────────────────────────────────

export async function showProviders(state: TuiState) {
  try {
    const providers = await state.sdk.listProviders()
    const allProviders = (providers as any).all ?? []
    const lines: string[] = []

    for (const p of allProviders) {
      lines.push(`${C.success(Box.dot)} ${C.textBold(p.name)} ${C.dim(`(${p.id})`)}  ${C.dim(`source: ${p.source ?? "?"}`)}`)
      const models = p.models ?? {}
      for (const [k, m] of Object.entries(models) as any[]) {
        lines.push(`  ${C.accent(Box.arrow)} ${C.text(m.name ?? k)}`)
        lines.push(`    ${C.muted("id:")} ${C.dim(m.api?.id ?? m.id)}  ${C.muted("ctx:")} ${C.dim(String(m.limit?.context ?? "?"))}  ${C.muted("out:")} ${C.dim(String(m.limit?.output ?? "?"))}`)
      }
    }

    if (lines.length === 0) {
      ui.emptyState("No providers configured.")
      return
    }

    console.log()
    ui.panel({
      title: C.textBold("Providers & Models"),
      body: lines,
      color: C.dim,
    })
    console.log(`  ${C.muted("Connected:")} ${C.accent(providers.connected.join(", ") || "none")}`)
  } catch (e) {
    ui.errorMsg(`Error: ${e}`)
  }
}

// ── Files ────────────────────────────────────────────────────────────

export async function showFiles(state: TuiState) {
  try {
    const files = await state.sdk.listFiles()
    const items = Array.isArray(files) ? files : []
    const lines: string[] = []
    for (const f of items.slice(0, 40)) {
      const icon = f.type === "directory" ? C.accent(">") : C.muted(" ")
      lines.push(`${icon} ${C.text(f.name ?? f.path)}`)
    }
    if (items.length > 40) {
      lines.push(C.dim(`… and ${items.length - 40} more`))
    }

    console.log()
    ui.panel({
      title: C.textBold(`Files (${items.length})`),
      body: lines.length > 0 ? lines : [C.muted("No files found.")],
      color: C.dim,
    })
  } catch (e) {
    ui.errorMsg(`Error: ${e}`)
  }
}

// ── Project & VCS ────────────────────────────────────────────────────

export async function showProject(state: TuiState) {
  try {
    const project = await state.sdk.currentProject()
    const vcs = await state.sdk.vcs()
    console.log()
    ui.panel({
      title: C.textBold("Project"),
      body: [
        `${C.muted("Name:")}      ${C.text(project.name ?? "?")}`,
        `${C.muted("Directory:")} ${C.text(project.directory ?? "?")}`,
        `${C.muted("Branch:")}    ${C.accent(vcs.branch ?? "?")}`,
      ],
      color: C.dim,
    })
  } catch (e) {
    ui.errorMsg(`Error: ${e}`)
  }
}

export async function showVcs(state: TuiState) {
  try {
    const vcs = await state.sdk.vcs()
    console.log(`  ${C.muted("Branch:")} ${C.accent(vcs.branch)}`)
  } catch (e) {
    ui.errorMsg(`Error: ${e}`)
  }
}

// ── Tasks ────────────────────────────────────────────────────────────

export async function showTasks(state: TuiState) {
  try {
    const tasks = await state.sdk.listTasks()
    if (tasks.length === 0) {
      ui.emptyState("No tasks in queue.")
      return
    }

    const lines: string[] = []
    for (const t of tasks) {
      lines.push(`${ui.statusIcon(t.status)} ${C.accent(t.id.slice(0, 8))} ${C.muted(t.status)} ${C.dim("—")} ${C.text(truncate(t.prompt, 50))}`)
    }

    console.log()
    ui.panel({
      title: C.textBold(`Tasks (${tasks.length})`),
      body: lines,
      color: C.dim,
    })
  } catch (e) {
    ui.errorMsg(`Error: ${e}`)
  }
}

// ── Audit ────────────────────────────────────────────────────────────

export async function showAudit(state: TuiState, sub?: string) {
  try {
    if (sub === "stats") {
      const stats = await state.sdk.auditStats() as any
      console.log()
      ui.panel({
        title: C.textBold("Audit Statistics"),
        body: [
          `${C.muted("Total requests:")}  ${C.textBold(String(stats.total ?? 0))}`,
          `${C.muted("Errors:")}          ${(stats.errors ?? 0) > 0 ? C.error(String(stats.errors)) : C.success("0")}`,
          `${C.muted("Avg duration:")}    ${C.text((stats.avgDuration ?? 0) + "ms")}`,
          ...(stats.byAction ? [
            "",
            C.muted("By Action:"),
            ...Object.entries(stats.byAction).map(([action, count]) =>
              `  ${C.accent(action)}: ${count}`
            )
          ] : []),
        ],
        color: C.dim,
      })
    } else {
      const entries = await state.sdk.queryAudit({ limit: 15 }) as any[]
      console.log()
      if (!entries.length) {
        ui.emptyState("No audit entries yet.")
        return
      }

      const lines: string[] = []
      for (const e of entries) {
        const time = new Date(e.timestamp).toLocaleTimeString()
        const status = e.success ? C.success(Box.check) : C.error(Box.cross_mark)
        const meta = e.metadata ? JSON.parse(e.metadata) : {}
        lines.push(`${status} ${C.muted(time)}  ${C.accent(e.action)}  ${C.dim(meta.method ?? "")} ${C.dim(meta.path ?? "")}`)
      }

      ui.panel({
        title: C.textBold(`Audit Logs (${entries.length})`),
        body: lines,
        color: C.dim,
      })
    }
  } catch (e) {
    ui.errorMsg(`Error: ${e}`)
  }
}

// ── Budget ───────────────────────────────────────────────────────────

export async function showBudget(state: TuiState, sub?: string, arg?: string) {
  try {
    if (sub === "check") {
      const result = await state.sdk.budgetCheck("default", 1000) as any
      console.log()
      ui.panel({
        title: C.textBold("Budget Check"),
        body: [
          `${C.muted("Allowed:")}  ${result.allowed ? C.success("YES") : C.error("NO")}`,
          ...(result.warnings?.length > 0 ? result.warnings.map((w: string) => `${C.warning(Box.warning_sign)} ${w}`) : []),
          ...(result.remaining ? Object.entries(result.remaining).map(([k, v]) => `${C.muted(k + ":")} ${v}`) : []),
        ],
        color: C.dim,
      })
    } else if (sub === "set" && arg) {
      const tokens = parseInt(arg)
      if (isNaN(tokens)) {
        ui.warnMsg("Usage: /budget set <max-tokens-per-hour>")
        return
      }
      await state.sdk.setBudgetLimits({ window: "hour", maxTokens: tokens, hardLimit: true })
      ui.successMsg(`Hourly token limit set to ${C.accent(tokens.toLocaleString())}`)
    } else {
      const summary = await state.sdk.budgetSummary("default") as any
      const lines: string[] = []
      for (const window of ["hour", "day", "month"]) {
        const w = summary[window]
        if (w) {
          lines.push(`${C.textBold(window.charAt(0).toUpperCase() + window.slice(1))}`)
          lines.push(`  ${C.muted("Tokens:")}   ${C.text(String(w.tokensUsed ?? 0).padStart(8))}`)
          lines.push(`  ${C.muted("Requests:")} ${C.text(String(w.requestCount ?? 0).padStart(8))}`)
          lines.push(`  ${C.muted("Cost ¢:")}   ${C.text(String(w.costCents ?? 0).padStart(8))}`)
        }
      }

      console.log()
      ui.panel({
        title: C.textBold("Budget Usage"),
        body: lines,
        color: C.dim,
      })
    }
  } catch (e) {
    ui.errorMsg(`Error: ${e}`)
  }
}

// ── Workspaces ───────────────────────────────────────────────────────

export async function showWorkspaces(state: TuiState) {
  try {
    const list = await state.sdk.listWorkspaces() as any[]
    if (list.length === 0) {
      ui.emptyState("No workspaces.", "Use /workspace new to create one.")
      return
    }

    const lines: string[] = []
    for (const ws of list) {
      const active = ws.active ? C.success(" ◀ active") : ""
      const tags = ws.tags?.length > 0 ? C.dim(` [${ws.tags.join(", ")}]`) : ""
      lines.push(`${ws.active ? C.success(Box.dot) : C.dim(Box.dotEmpty)} ${C.textBold(ws.name)} ${C.dim(ws.id.slice(0, 8))}${tags}${active}`)
      lines.push(`  ${C.dim(ws.directory)}`)
    }

    console.log()
    ui.panel({
      title: C.textBold(`Workspaces (${list.length})`),
      body: lines,
      color: C.dim,
    })
  } catch (e) {
    ui.errorMsg(`Error: ${e}`)
  }
}

export async function createWorkspaceInteractive(state: TuiState): Promise<void> {
  return new Promise<void>((resolve) => {
    state.rl.question(`  ${C.muted("Workspace name:")} `, (name) => {
      if (!name.trim()) { ui.warnMsg("Cancelled."); resolve(); return }
      state.rl.question(`  ${C.muted("Directory path:")} `, async (dir) => {
        if (!dir.trim()) { ui.warnMsg("Cancelled."); resolve(); return }
        state.rl.question(`  ${C.muted("Tags (comma-separated, or empty):")} `, async (tagsStr) => {
          try {
            const tags = tagsStr.trim() ? tagsStr.split(",").map(t => t.trim()) : []
            const ws = await state.sdk.createWorkspace({ name: name.trim(), directory: dir.trim(), tags }) as any
            ui.successMsg(`Workspace created: ${C.accent(ws.name)} ${C.dim(`(${ws.id.slice(0, 8)})`)}`)
          } catch (e: any) {
            ui.errorMsg(e.message ?? String(e))
          }
          resolve()
        })
      })
    })
  })
}

export async function switchWorkspaceInteractive(state: TuiState): Promise<void> {
  try {
    const list = await state.sdk.listWorkspaces() as any[]
    if (list.length === 0) {
      ui.emptyState("No workspaces.", "Use /workspace new first.")
      return
    }
    console.log()
    for (let i = 0; i < list.length; i++) {
      const ws = list[i]
      const active = ws.active ? C.success(" ◀") : ""
      console.log(`  ${C.accent(String(i + 1))}. ${C.text(ws.name)} ${C.dim(ws.directory)}${active}`)
    }
    return new Promise<void>((resolve) => {
      state.rl.question(`\n  ${C.muted("Enter number to switch:")} `, async (num) => {
        const idx = parseInt(num) - 1
        if (isNaN(idx) || idx < 0 || idx >= list.length) {
          ui.warnMsg("Cancelled.")
          resolve(); return
        }
        try {
          await state.sdk.switchWorkspace(list[idx].id)
          ui.successMsg(`Switched to ${C.accent(list[idx].name)}`)
        } catch (e: any) {
          ui.errorMsg(e.message ?? String(e))
        }
        resolve()
      })
    })
  } catch (e) {
    ui.errorMsg(`Error: ${e}`)
  }
}

// ── Queue ────────────────────────────────────────────────────────────

export async function showQueueMetrics(state: TuiState) {
  try {
    const m = await state.sdk.queueMetrics() as any
    const lines: string[] = [
      `${C.muted("Running workers:")}   ${C.textBold(String(m.running ?? 0))}`,
      `${C.muted("Queued tasks:")}      ${C.text(String(m.queued ?? 0))}`,
      `${C.muted("Concurrency limit:")} ${C.text(String(m.concurrencyLimit ?? 0))}`,
      `${C.muted("Queue depth limit:")} ${C.text(String(m.queueDepthLimit ?? 0))}`,
    ]

    if (m.stats) {
      lines.push("")
      lines.push(C.muted("Task States:"))
      for (const [s, count] of Object.entries(m.stats)) {
        if (s === "total") continue
        lines.push(`  ${ui.statusIcon(s)} ${C.text(s)}: ${count}`)
      }
      lines.push(`  ${C.textBold("total")}: ${m.stats.total ?? 0}`)
    }

    console.log()
    ui.panel({
      title: C.textBold("Queue Metrics"),
      body: lines,
      color: C.dim,
    })
  } catch (e) {
    ui.errorMsg(`Error: ${e}`)
  }
}

// ── Orchestrations ───────────────────────────────────────────────────

export async function showOrchestrations(state: TuiState) {
  try {
    const list = await state.sdk.listOrchestrations() as any[]
    if (list.length === 0) {
      ui.emptyState("No orchestrations yet.", "Use /orchestrate to start one.")
      return
    }

    console.log()
    for (const o of list) {
      const tasks = o.tasks ?? []
      const done = tasks.filter((t: any) => t.status === "completed").length

      ui.panel({
        title: `${ui.statusIcon(o.status)} ${C.textBold(o.name)}`,
        titleRight: C.muted(`${done}/${tasks.length} tasks`),
        body: tasks.map((t: any) =>
          `${ui.statusIcon(t.status)} ${C.text(t.label)} ${C.dim(t.status)}`
        ),
        color: C.dim,
      })
    }
  } catch (e) {
    ui.errorMsg(`Error: ${e}`)
  }
}

export async function startOrchestrationInteractive(state: TuiState): Promise<void> {
  return new Promise<void>((resolve) => {
    state.rl.question(`  ${C.muted("Orchestration name:")} `, (name) => {
      if (!name.trim()) { ui.warnMsg("Cancelled."); resolve(); return }

      const tasks: { label: string; prompt: string; dependsOn?: string[] }[] = []

      const addTask = () => {
        state.rl.question(`  ${C.muted(`Task ${tasks.length + 1} label (empty to finish):`)} `, (label) => {
          if (!label.trim()) {
            if (tasks.length === 0) {
              ui.warnMsg("Need at least 1 task. Cancelled.")
              resolve(); return
            }
            // Submit
            (async () => {
              try {
                ui.startSpinner("Starting orchestration...")
                const result = await state.sdk.startOrchestration({ name: name.trim(), tasks, maxConcurrency: 3 }) as any
                ui.stopSpinner()
                ui.successMsg(`Orchestration started: ${C.accent(result.id?.slice(0, 8) ?? "?")} — ${tasks.length} tasks`)
                console.log(`    ${C.dim("Use /orchestrations to monitor progress")}`)
              } catch (e: any) {
                ui.stopSpinner()
                ui.errorMsg(e.message ?? String(e))
              }
              resolve()
            })()
            return
          }
          state.rl.question(`    ${C.muted("Prompt:")} `, (prompt) => {
            if (!prompt.trim()) { ui.warnMsg("Skipped."); addTask(); return }
            state.rl.question(`    ${C.muted("Depends on (comma-separated labels, or empty):")} `, (deps) => {
              const dependsOn = deps.trim() ? deps.split(",").map(d => d.trim()) : undefined
              tasks.push({ label: label.trim(), prompt: prompt.trim(), dependsOn })
              ui.successMsg(`Added task: ${C.accent(label.trim())}`)
              addTask()
            })
          })
        })
      }
      addTask()
    })
  })
}

// ── Parallel Executions ──────────────────────────────────────────────

export async function showParallelExecutions(state: TuiState) {
  try {
    const list = await state.sdk.listParallelExecutions() as any[]
    if (list.length === 0) {
      ui.emptyState("No parallel executions yet.", "Use /parallel to start one.")
      return
    }

    console.log()
    for (const exec of list) {
      const tasks = exec.tasks ?? []
      const done = tasks.filter((t: any) => t.status === "completed").length

      const body = tasks.map((t: any) =>
        `${ui.statusIcon(t.status)} ${C.text(t.label)} ${C.dim(t.status)}`
      )
      if (exec.aggregatedResult) {
        body.push("")
        body.push(`${C.primary(Box.diamond)} ${C.muted("Fan-in:")} ${C.text(truncate(exec.aggregatedResult, 80))}`)
      }

      ui.panel({
        title: `${ui.statusIcon(exec.status)} ${C.textBold(exec.name)}`,
        titleRight: C.muted(`${done}/${tasks.length} tasks`),
        body,
        color: C.dim,
      })
    }
  } catch (e) {
    ui.errorMsg(`Error: ${e}`)
  }
}

export async function startParallelInteractive(state: TuiState): Promise<void> {
  return new Promise<void>((resolve) => {
    state.rl.question(`  ${C.muted("Execution name:")} `, (name) => {
      if (!name.trim()) { ui.warnMsg("Cancelled."); resolve(); return }

      const tasks: { label: string; prompt: string }[] = []

      const addTask = () => {
        state.rl.question(`  ${C.muted(`Task ${tasks.length + 1} label (empty to finish):`)} `, (label) => {
          if (!label.trim()) {
            if (tasks.length === 0) {
              ui.warnMsg("Need at least 1 task. Cancelled.")
              resolve(); return
            }
            state.rl.question(`  ${C.muted("Fan-in prompt (empty to skip):")} `, async (fanIn) => {
              try {
                ui.startSpinner("Starting parallel execution...")
                const result = await state.sdk.executeParallel({
                  name: name.trim(),
                  concurrency: 3,
                  timeoutMs: 120000,
                  fanInPrompt: fanIn.trim() || undefined,
                  tasks,
                }) as any
                ui.stopSpinner()
                ui.successMsg(`Parallel execution started: ${C.accent(result.id?.slice(0, 8) ?? "?")} — ${tasks.length} tasks`)
                console.log(`    ${C.dim("Use /parallel list to monitor progress")}`)
              } catch (e: any) {
                ui.stopSpinner()
                ui.errorMsg(e.message ?? String(e))
              }
              resolve()
            })
            return
          }
          state.rl.question(`    ${C.muted("Prompt:")} `, (prompt) => {
            if (!prompt.trim()) { ui.warnMsg("Skipped."); addTask(); return }
            tasks.push({ label: label.trim(), prompt: prompt.trim() })
            ui.successMsg(`Added task: ${C.accent(label.trim())}`)
            addTask()
          })
        })
      }
      addTask()
    })
  })
}

// ── Helpers ──────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (!s) return ""
  return s.length > max ? s.slice(0, max - 1) + "…" : s
}
