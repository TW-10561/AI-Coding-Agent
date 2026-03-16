// ---------------------------------------------------------------------------
// handlers.ts — All command handlers for the Thirdwave TUI
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
  currentModel: string | null // selected model ID (null = use provider default)
  currentProvider: string | null // selected provider ID (null = use default vllm)
  rl: readline.Interface
}

// ── Health & Status ──────────────────────────────────────────────────

export async function checkHealth(state: TuiState): Promise<boolean> {
  try {
    const health = await state.sdk.health()
    // Platform running is enough — OpenCode being down is degraded, not fatal
    return health.platform === "ok"
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

  // ── Local vLLM models + Cloud providers (from our registry) ──
  try {
    const reg = await state.sdk.registry()
    if (reg) {
      const modelLines: string[] = []

      // Fleet status summary — count models, not providers
      let onlineModelCnt = 0
      let offlineModelCnt = 0
      for (const p of reg.local as any[]) {
        const modelCount = (p.models as any[])?.length ?? 0
        if (p.status === "online") onlineModelCnt += modelCount
        else offlineModelCnt += modelCount
      }
      const cloudCnt   = (reg.cloud as any[]).filter((p: any) => p.configured).length
      const activeModelName = state.currentModel ? state.currentModel.split("/").pop() : null
      modelLines.push(`${C.muted("Fleet:")} ${C.success(String(onlineModelCnt) + " up")} ${offlineModelCnt > 0 ? C.error(String(offlineModelCnt) + " down") : C.dim("0 down")} ${C.dim(String(cloudCnt) + " cloud")}${activeModelName ? `  ${C.muted("Active:")} ${C.accent(activeModelName)}` : ""}`)
      modelLines.push("")

      // ── Local models — flat list with server shown per model ──
      if (reg.local && reg.local.length > 0) {
        modelLines.push(C.textBold("Local Models"))

        // Collect all models from all local providers into a flat list
        const allModels: Array<{ name: string; id: string; ctx: number; out: number; endpoint: string; online: boolean; latencyMs?: number }> = []
        for (const p of reg.local as any[]) {
          const isOnline = p.status === "online"
          for (const m of (p.models as any[])) {
            allModels.push({
              name: m.name ?? m.id,
              id: m.id,
              ctx: m.contextLimit ?? 0,
              out: m.outputLimit ?? 0,
              endpoint: p.endpoint,
              online: isOnline,
              latencyMs: p.latencyMs,
            })
          }
        }

        // Deduplicate by model name (same model on multiple endpoints → show first online)
        const seen = new Set<string>()
        const unique: typeof allModels = []
        for (const m of allModels) {
          if (!seen.has(m.name)) {
            seen.add(m.name)
            unique.push(m)
          }
        }

        for (const m of unique) {
          const dot = m.online ? C.success("●") : C.error("●")
          const ctx = m.ctx ? C.dim(` ctx:${(m.ctx / 1000).toFixed(0)}k`) : ""
          const out = m.out ? C.dim(` out:${m.out}`) : ""
          const active = m.id === state.currentModel ? C.success(" ◀ active") : ""
          const latency = m.online && m.latencyMs ? C.dim(` ${m.latencyMs}ms`) : ""
          modelLines.push(`  ${dot} ${C.text(m.name)}${ctx}${out}${latency}${active}`)
          // Show the server endpoint under each model
          modelLines.push(`    ${C.dim(m.endpoint)}`)
        }
      }

      // Cloud providers — just show configured status
      if (reg.cloud && reg.cloud.length > 0) {
        modelLines.push("")
        modelLines.push(C.textBold("Cloud Providers"))
        for (const p of reg.cloud as any[]) {
          const icon = p.configured ? C.success(Box.check) : C.dim(Box.diamond)
          const note = p.configured ? C.success("ready") : C.dim(`/apikey to configure`)
          modelLines.push(`  ${icon} ${C.text(p.name)} — ${note}`)
        }
      }

      if (modelLines.length > 0) {
        ui.panel({
          title: C.textBold("Models & Providers"),
          body: modelLines,
          color: C.dim,
        })
      }
    }
  } catch {
    // Registry is optional — health panel already shown above
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
  // We only support these 4 agents — OpenCode may return extras (triage, docs,
  // duplicate-pr) that are part of the OpenCode project itself, not our platform.
  const SUPPORTED = new Set(["build", "plan", "explore", "general"])
  const agents = await fetchAgents(state)
  const toShow = agents.filter(a => SUPPORTED.has(a.id))

  // Fallback: if API is down and fetchAgents returned hardcoded list, use that
  const finalList = toShow.length > 0 ? toShow : agents.filter(a =>
    (a.mode === "primary" || a.mode === "all")
  )

  const lines: string[] = []
  for (const a of finalList) {
    const isActive = a.id === state.currentAgent
    const active = isActive ? C.success(" ◀ active") : ""
    const color = agentColor(a.id)
    const modeTag = a.mode && a.mode !== "primary" ? C.dim(` [${a.mode}]`) : ""
    lines.push(`${color(Box.dot)} ${C.textBold(a.name)}${active}`)
    if (a.description) lines.push(`  ${C.muted(a.description.slice(0, 78))}`)
  }

  console.log()
  ui.panel({ title: C.textBold("Agents"), body: lines, color: C.dim })

  // Show switch hints based on what's actually available
  const switchHints = finalList.slice(0, 4).map(a => `/${a.id}`).join("  ")
  console.log(`  ${C.dim("Switch with:")} ${C.dim(switchHints)}`)
}

export async function switchAgent(state: TuiState, agentID: string) {
  // Only allow our 4 supported agents
  const SUPPORTED = new Set(["build", "plan", "explore", "general"])
  if (!SUPPORTED.has(agentID)) {
    ui.warnMsg(`Unknown agent: ${agentID}. Available: ${[...SUPPORTED].join(", ")}`)
    return
  }

  // Validate against live agent list
  const agents = await fetchAgents(state)
  const match = agents.find(a => a.id === agentID || a.name === agentID)

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
    _chatHistory = []  // Clear chat history for the new session
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
    _chatHistory = []  // Clear chat history for the new session context
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
        if (part.type === "text" && part.text && !(part as any).synthetic) {
          text += part.text
        } else if (part.type === "reasoning" && part.text) {
          reasoning += part.text
        }
        // skip tool, step-start, step-finish, patch, snapshot, etc.
      }

      if (text) {
        if (role === "user") {
          ui.userMessage(text.trim())
        } else {
          const msgError2 = (msg as any).info?.error
          if (msgError2) {
            ui.errorMsg(`${msgError2.name ?? "Error"}: ${msgError2.data?.message ?? msgError2.message ?? ""}`)
          } else {
            if (reasoning) ui.reasoningBlock(reasoning)
            ui.assistantMessage(text, undefined)
          }
        }
      }
    }
  } catch (e) {
    ui.errorMsg(`Error: ${e}`)
  }
}

// ── Unified Chat — direct vLLM for speed ─────────────────────────────

/** In-memory chat history for multi-turn (kept per TUI session) */
let _chatHistory: Array<{ role: "user" | "assistant"; content: string }> = []

/**
 * Heuristic: does the message look like it needs coding tools (bash, files)?
 * Simple conversational messages get routed without tools for speed.
 */
function needsTools(message: string): boolean {
  const toolPatterns = /\b(run|exec|execute|install|build|test|create|write|edit|modify|fix|debug|implement|code|file|directory|folder|git|npm|pip|bun|docker|compile|deploy|lint|format|refactor|delete|remove|rename|move|copy|search|grep|find|curl|wget|fetch|api|endpoint|server|port|script|command|terminal|shell|bash|make)\b/i
  // If it matches coding/tool keywords → use tools
  if (toolPatterns.test(message)) return true
  // Short conversational messages typically don't need tools
  if (message.trim().split(/\s+/).length <= 8) return false
  // Default: use tools for longer messages (they're likely task requests)
  return true
}

/**
 * Send a user message through the direct vLLM chat route.
 * This is the ONLY chat path — no dual mode.
 * Automatically searches for a relevant skill and injects it as context.
 */
export async function sendMessage(state: TuiState, content: string): Promise<void> {
  ui.userMessage(content)
  const useTools = needsTools(content)
  ui.startSpinner(useTools ? "Thinking (with tools)..." : "Thinking...")

  try {
    _chatHistory.push({ role: "user", content })
    // Keep last 10 turns to stay within context limits
    if (_chatHistory.length > 20) _chatHistory = _chatHistory.slice(-20)

    // Auto-inject relevant skill context (RAG-lite)
    // Only activate for substantive messages — skip greetings and short queries.
    // The server-side findRelevantSkill uses a 0.75 threshold; we mirror that
    // here by requiring a high relevance score to avoid false positives
    // (e.g. "hi" matching "architecture" via substring).
    let systemPrompt: string | undefined
    try {
      if (content.trim().length >= 8) {
        const skillResults = await state.sdk.searchSkills(content)
        if (skillResults.length > 0 && skillResults[0]!.relevance >= 0.75) {
          const topSkill = await state.sdk.getSkill(skillResults[0]!.skill.id)
          if (topSkill?.content) {
            systemPrompt = `You have access to the following reference material about "${topSkill.displayName}":\n\n${topSkill.content}\n\nUse this knowledge when relevant to the user's question. If the question is unrelated to this material, ignore it and answer normally.`
            console.log(`  ${C.dim(`📚 Using skill: ${topSkill.displayName} (${(skillResults[0]!.relevance * 100).toFixed(0)}% match)`)}`)
          }
        }
      }
    } catch {
      // Skill search failed — proceed without context
    }

    const TIMEOUT_MS = useTools ? 300_000 : 180_000  // 5 min with tools, 3 min without
    const result = await Promise.race([
      state.sdk.directChat({
        message: content,
        system: systemPrompt,
        modelID: state.currentModel || undefined,
        providerID: state.currentProvider || undefined,
        maxTokens: 8192,          // Higher for reasoning models (thinking consumes tokens)
        temperature: 0.3,
        tools: useTools,
        history: _chatHistory.slice(0, -1),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(
          useTools
            ? `Chat timed out after ${TIMEOUT_MS / 1000}s. Try a simpler prompt or the model may be under heavy load.`
            : `Chat timed out after ${TIMEOUT_MS / 1000}s. The model may be under heavy load.`
        )), TIMEOUT_MS)
      ),
    ])
    ui.stopSpinner()

    // Show tool usage summary if tools were called
    if (result.toolCalls && result.toolCalls.length > 0) {
      const toolSummary = result.toolCalls.map((tc: any) => {
        const icon = tc.success ? C.success("✓") : C.error("✗")
        const name = C.accent(tc.tool)
        const argStr = tc.tool === "bash"
          ? C.dim(` ${(tc.args?.command ?? "").slice(0, 60)}`)
          : tc.tool === "read_file" || tc.tool === "write_file"
            ? C.dim(` ${tc.args?.path ?? ""}`)
            : tc.tool === "grep_search"
              ? C.dim(` "${tc.args?.pattern ?? ""}"`)
              : ""
        return `    ${icon} ${name}${argStr}`
      })
      console.log(`\n  ${C.muted(`Tools used (${result.toolCalls.length}):`)}`)
      for (const line of toolSummary) console.log(line)
      console.log()
    }

    if (result.reasoning) {
      ui.reasoningBlock(result.reasoning)
    }

    _chatHistory.push({ role: "assistant", content: result.text })

    const tokenStr = result.tokens?.output
      ? `${result.tokens.output.toLocaleString()} tokens · ${result.latencyMs}ms`
      : `${result.latencyMs}ms`
    ui.assistantMessage(result.text, tokenStr)
  } catch (e) {
    ui.stopSpinner()
    if (e instanceof PlatformApiError) {
      ui.errorMsg(`Chat error (${e.status})`, e.message)
    } else {
      ui.errorMsg(`${e}`)
    }
  }
}

// ── Cloud API Key Management ─────────────────────────────────────────

/**
 * Interactive prompt for users to enter API keys for cloud providers.
 * Shows the cloud provider catalogue from our registry and lets them configure.
 */
export async function setApiKey(state: TuiState): Promise<void> {
  try {
    const reg = await state.sdk.registry()
    if (!reg || !reg.cloud || reg.cloud.length === 0) {
      ui.warnMsg("No cloud providers in registry.")
      return
    }

    console.log()
    const lines: string[] = []
    for (let i = 0; i < reg.cloud.length; i++) {
      const p = reg.cloud[i] as any
      const icon = p.configured ? C.success(Box.check) : C.muted(Box.diamond)
      const status = p.configured ? C.success("configured") : C.dim("not set")
      lines.push(`  ${C.accent(String(i + 1).padStart(2))}. ${icon} ${C.textBold(p.name)}  ${status}  ${C.dim(p.keyEnvVar || "")}`)
    }
    ui.panel({ title: C.textBold("Cloud Providers — API Key Setup"), body: lines, color: C.dim })

    return new Promise<void>((resolve) => {
      state.rl.question(`\n  ${C.muted("Enter number (or empty to cancel):")} `, (answer) => {
        const num = parseInt(answer.trim())
        if (isNaN(num) || num < 1 || num > reg.cloud.length) {
          if (answer.trim()) ui.warnMsg("Invalid selection.")
          resolve()
          return
        }
        const provider = reg.cloud[num - 1] as any
        console.log()
        console.log(`  ${C.muted("Provider:")} ${C.textBold(provider.name)}`)
        console.log(`  ${C.dim("The key will be stored as")} ${C.accent(provider.keyEnvVar || provider.id + "_API_KEY")}`)
        state.rl.question(`  ${C.muted("API Key:")} `, async (key) => {
          if (!key.trim()) { ui.warnMsg("Cancelled."); resolve(); return }
          try {
            // Store the key in the platform backend
            await state.sdk.setCloudApiKey(provider.id, key.trim())
            ui.successMsg(`API key set for ${C.accent(provider.name)}`)
            console.log(`    ${C.dim("Use /registry refresh to verify the provider is active.")}`) 
          } catch (e: any) {
            ui.errorMsg(`Failed to set key: ${e?.message ?? e}`)
            console.log(`    ${C.dim("Tip: You can also set")} ${C.accent(provider.keyEnvVar || "")} ${C.dim("in your .env file and restart.")}`) 
          }
          resolve()
        })
      })
    })
  } catch (e) {
    ui.errorMsg(`API key setup error: ${e}`)
  }
}

// ── Send Prompt (through OpenCode — tools, agents, full IDE) ─────────

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
        modelID: state.currentModel || undefined,
        providerID: state.currentProvider || undefined,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT")), PROMPT_TIMEOUT_MS)
      ),
    ])
    ui.stopSpinner()

    // ── Check for errors returned in info.error (e.g. ContextOverflowError) ──
    const msgError = (response as any).info?.error
    if (msgError) {
      const errName: string = msgError.name ?? "UnknownError"
      const errMsg: string = msgError.data?.message ?? msgError.message ?? JSON.stringify(msgError)
      if (errName === "ContextOverflowError") {
        ui.errorMsg(`Context overflow — session history is too long for the model.`)
        console.log(`    ${C.dim("Creating a fresh session automatically...")}`)        
        await createNewSession(state)
      } else {
        ui.errorMsg(`${errName}: ${errMsg}`)
      }
      return
    }

    // ── Extract parts from OpenCode MessageV2 format ──────────────────────
    let text = ""
    let reasoning = ""
    const toolCalls: string[] = []
    const parts = (response as any).parts ?? []

    let tokens: number = (response as any).info?.tokens?.output ?? 0
    for (const part of parts) {
      if (part.type === "text" && part.text && !part.synthetic) {
        text += part.text
      } else if (part.type === "reasoning" && part.text) {
        reasoning += part.text
      } else if (part.type === "tool") {
        const status = (part as any).state?.status ?? ""
        const name = (part as any).tool ?? "tool"
        if (status === "completed") {
          toolCalls.push(`${name} ${Box.arrow} done`)
        } else if (status === "error") {
          toolCalls.push(`${name} ${Box.arrow} error`)
        } else {
          toolCalls.push(name)
        }
      } else if (part.type === "step-finish") {
        const stepTokens = (part as any).tokens?.output ?? 0
        if (stepTokens > tokens) tokens = stepTokens
      } else if (part.type === "retry") {
        const retryErr = (part as any).error
        if (retryErr) console.log(`  ${C.warning(Box.warning_sign)} ${C.muted(`Retry: ${retryErr.message ?? retryErr.name ?? "unknown error"}`)}`)        
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
      // Model returned only reasoning — show reasoning as the response
      ui.assistantMessage(reasoning, undefined)
    } else if (toolCalls.length > 0) {
      ui.emptyState("(agent ran tools — no text reply)")
    } else {
      ui.emptyState("(empty response — check OpenCode and vLLM logs)")
    }

  } catch (e) {
    ui.stopSpinner()
    if (e instanceof PlatformApiError) {
      ui.errorMsg(`API Error (${e.status})`, e.message)
      if (e.body) console.log(`    ${C.dim(e.body.slice(0, 200))}`)
    } else if (e instanceof Error && e.message === "TIMEOUT") {
      ui.warnMsg("OpenCode request timed out after 120s.")
      console.log(`    ${C.dim("Tip: Use /chat for faster direct responses (no tools).")}`)
      console.log(`    ${C.dim("     Or check vLLM logs for the slow model.")}`)
    } else {
      ui.errorMsg(`${e}`)
    }
  }
}

// ── Model Selection (dropdown-style picker) ─────────────────────────

export async function showModelSelector(state: TuiState): Promise<void> {
  try {
    const reg = await state.sdk.registry()
    if (!reg) { ui.warnMsg("Registry not available."); return }

    // Build a flat list of all available models from local + cloud
    interface ModelEntry {
      idx: number
      id: string
      name: string
      provider: string
      providerName: string
      source: "local" | "cloud"
      ctx: number
      out: number
      status?: string
    }
    const models: ModelEntry[] = []
    let idx = 1

    // Local vLLM models
    for (const p of reg.local) {
      if (p.status !== "online") continue
      for (const m of p.models) {
        models.push({
          idx: idx++,
          id: m.id,
          name: m.name ?? m.id,
          provider: p.id,
          providerName: p.name,
          source: "local",
          ctx: m.contextLimit,
          out: m.outputLimit,
          status: p.status,
        })
      }
    }

    // Cloud models (only if the provider is configured)  
    for (const p of reg.cloud) {
      if (!p.configured) continue
      for (const m of p.models) {
        models.push({
          idx: idx++,
          id: m.id,
          name: m.name ?? m.id,
          provider: p.id,
          providerName: p.name,
          source: "cloud",
          ctx: m.contextLimit,
          out: m.outputLimit,
        })
      }
    }

    if (models.length === 0) {
      ui.warnMsg("No models available. Check vLLM status or add cloud API keys.")
      return
    }

    // Display the model list
    console.log()
    const lines: string[] = []
    let lastSource = ""
    for (const m of models) {
      if (m.source !== lastSource) {
        if (lastSource) lines.push("")
        lines.push(m.source === "local" ? C.textBold("  Local vLLM") : C.textBold("  Cloud"))
        lastSource = m.source
      }
      const isActive = m.id === state.currentModel && m.provider === state.currentProvider
      const active = isActive ? C.success(" ◀ active") : ""
      const ctxStr = m.ctx ? C.dim(` ctx:${(m.ctx / 1000).toFixed(0)}k`) : ""
      const outStr = m.out ? C.dim(` out:${m.out}`) : ""
      lines.push(`  ${C.accent(String(m.idx).padStart(2))}. ${C.text(m.name)}${ctxStr}${outStr}  ${C.muted(m.providerName)}${active}`)
    }
    ui.panel({ title: C.textBold("Select Model"), body: lines, color: C.dim })

    // Prompt for selection
    return new Promise<void>((resolve) => {
      state.rl.question(`\n  ${C.muted("Enter number (or empty to keep current):")} `, (answer) => {
        const num = parseInt(answer.trim())
        if (isNaN(num) || num < 1 || num > models.length) {
          if (answer.trim()) ui.warnMsg("Invalid selection.")
          resolve()
          return
        }
        const selected = models[num - 1]!
        state.currentModel = selected.id
        state.currentProvider = selected.provider
        ui.successMsg(`Model: ${C.accent(selected.name)} ${C.dim(`(${selected.providerName})`)}`)
        resolve()
      })
    })
  } catch (e) {
    ui.errorMsg(`Model selection error: ${e}`)
  }
}

// ── Provider Registry (Thirdwave model catalogue) ─────────────────────

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
      body: cloudLines.length ? cloudLines : [C.muted("No cloud providers configured."), C.dim("Use /apikey to set API keys for cloud providers.")],
      color: C.dim,
    })

    console.log(`  ${C.dim("Active model:")} ${C.accent(reg.activeModel)}`)
    let onlineN = 0, offlineN = 0
    for (const p of reg.local as any[]) {
      const mc = (p.models as any[])?.length ?? 0
      if (p.status === "online") onlineN += mc; else offlineN += mc
    }
    const cloudN   = (reg.cloud as any[]).filter((p: any) => p.configured).length
    console.log(`  ${C.dim("Fleet:")} ${C.success(String(onlineN) + " online")}  ${offlineN > 0 ? C.error(String(offlineN) + " offline") : C.dim("0 offline")}  ${C.dim(String(cloudN) + " cloud configured")}`)
    console.log(`  ${C.dim("Last probed:")} ${C.dim(reg.generatedAt ? new Date(reg.generatedAt).toLocaleTimeString() : "unknown")}`)
    console.log(`  ${C.dim("Use /registry refresh to re-probe vLLM endpoints.")}`)
    console.log(`  ${C.dim("Use /apikey to configure cloud provider keys.")}`)
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
        const meta = typeof e.metadata === "string" ? JSON.parse(e.metadata) : (e.metadata || {})
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
          ...(result.reason ? [`${C.warning(Box.warning_sign)} ${result.reason}`] : []),
          ...(result.remaining ? Object.entries(result.remaining).filter(([_, v]) => v != null).map(([k, v]) => `${C.muted(k + ":")} ${v}`) : []),
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

// ── Skills ───────────────────────────────────────────────────────────

export async function showSkills(state: TuiState, sub?: string) {
  try {
    if (sub === "reload") {
      ui.startSpinner("Reloading skills from disk...")
      const result = await state.sdk.reloadSkills()
      ui.stopSpinner()
      ui.successMsg(`Reloaded ${result.count} skills`)
      return
    }

    if (sub && sub !== "list") {
      // Treat sub as a search query
      const results = await state.sdk.searchSkills(sub)
      if (results.length === 0) {
        ui.emptyState(`No skills match "${sub}".`, "Use /skills to see all available skills.")
        return
      }

      console.log()
      const lines: string[] = []
      for (const r of results.slice(0, 10)) {
        const s = r.skill
        const rel = Math.round(r.relevance * 100)
        lines.push(`${s.icon} ${C.textBold(s.displayName)}  ${C.dim(`[${s.category}]`)}  ${C.muted(rel + "% match")}`)
        lines.push(`  ${C.muted(s.description)}`)
        lines.push(`  ${C.dim(s.tags.map(t => `#${t}`).join(" "))}`)
      }
      ui.panel({ title: C.textBold(`Skills matching "${sub}"`), body: lines, color: C.dim })
      console.log(`  ${C.dim("Use /skill <name> to read full content.")}`)
      return
    }

    // List all skills grouped by category
    const categories = await state.sdk.skillsByCategory()
    const catKeys = Object.keys(categories).sort()

    if (catKeys.length === 0) {
      ui.emptyState("No skills installed.", "Add SKILL.md files to platform/skills/installed/")
      return
    }

    console.log()
    const lines: string[] = []
    let total = 0
    for (const cat of catKeys) {
      const skills = categories[cat]!
      total += skills.length
      lines.push(C.textBold(`${cat} (${skills.length})`))
      for (const s of skills) {
        lines.push(`  ${s.icon} ${C.accent(s.id.padEnd(30))} ${C.muted(s.description.slice(0, 50))}`)
      }
      lines.push("")
    }
    ui.panel({ title: C.textBold(`Skills (${total})`), body: lines, color: C.dim })
    console.log(`  ${C.dim("Use /skills <query> to search, /skill <name> to read.")}`)
  } catch (e) {
    ui.errorMsg(`Error: ${e}`)
  }
}

export async function showSkillDetail(state: TuiState, id: string) {
  try {
    const skill = await state.sdk.getSkill(id)
    if (!skill) {
      ui.errorMsg(`Skill not found: ${id}`)
      return
    }

    console.log()
    console.log(`  ${skill.icon} ${C.primaryBg(`  ${skill.displayName}  `)}  ${C.dim(`[${skill.category}]`)}`)
    console.log(`  ${C.muted(skill.description)}`)
    console.log(`  ${C.dim(skill.tags.map((t: string) => `#${t}`).join(" "))}`)
    console.log(`  ${C.dim(Box.h.repeat(Math.max(1, TERM_WIDTH() - 4)))}`)
    console.log()

    // Print the skill content with basic formatting
    const lines = skill.content.split("\n")
    for (const line of lines) {
      if (line.startsWith("# ")) {
        console.log(`  ${C.textBold(line.slice(2))}`)
      } else if (line.startsWith("## ")) {
        console.log(`\n  ${C.accent(line.slice(3))}`)
      } else if (line.startsWith("### ")) {
        console.log(`  ${C.highlight(line.slice(4))}`)
      } else if (line.startsWith("- ")) {
        console.log(`    ${C.muted("•")} ${C.text(line.slice(2))}`)
      } else if (line.startsWith("  - ")) {
        console.log(`      ${C.dim("◦")} ${C.text(line.slice(4))}`)
      } else if (line.trim() === "") {
        console.log()
      } else {
        console.log(`  ${C.text(line)}`)
      }
    }
  } catch (e: any) {
    if (e?.status === 404) {
      ui.errorMsg(`Skill not found: ${id}. Use /skills to list all.`)
    } else {
      ui.errorMsg(`Error: ${e}`)
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (!s) return ""
  return s.length > max ? s.slice(0, max - 1) + "…" : s
}

// ── Security Policies ────────────────────────────────────────────────

export async function showPolicies(state: TuiState) {
  try {
    const status = await state.sdk.policyStatus()
    const lines: string[] = []

    lines.push(`${C.muted("Enabled:")}          ${status.enabled ? C.success("yes") : C.error("no")}`)
    lines.push(`${C.muted("Execution Mode:")}   ${C.text(status.executionMode)}`)
    lines.push(`${C.muted("Risk Thresholds:")}  ${C.text(`deny ≥ ${status.riskThresholds.deny}, ask ≥ ${status.riskThresholds.ask}`)}`)
    lines.push(`${C.muted("Network Mode:")}     ${C.text(status.networkMode)}`)
    lines.push("")

    const fIcon = status.sensitiveFiles.enabled ? C.success(Box.check) : C.dim(Box.diamond)
    lines.push(`  ${fIcon} ${C.textBold("Sensitive File Guard")}  ${C.dim(`(${status.sensitiveFiles.patternCount} patterns)`)}`)

    const dIcon = status.destructiveGuard.enabled ? C.success(Box.check) : C.dim(Box.diamond)
    lines.push(`  ${dIcon} ${C.textBold("Destructive Command Guard")}`)

    const lIcon = status.loopDetection.enabled ? C.success(Box.check) : C.dim(Box.diamond)
    lines.push(`  ${lIcon} ${C.textBold("Loop Detection")}  ${C.dim(`score: ${status.loopDetection.currentScore}`)}`)

    lines.push(`  ${C.success(Box.check)} ${C.textBold("Skill Trust")}  ${C.dim(`${status.skillTrust.registered} registered, default: ${status.skillTrust.defaultLevel}`)}`)

    lines.push(`  ${C.success(Box.check)} ${C.textBold("RBAC")}  ${C.dim(`roles: ${status.rbac.roles.join(", ")}`)}`)

    lines.push(`  ${C.success(Box.check)} ${C.textBold("Autonomy Control")}  ${C.dim(`default: ${status.autonomy.defaultMode}`)}`)
    for (const a of status.autonomy.agents) {
      lines.push(`    ${C.dim(Box.arrow)} ${C.text(a.name)}: ${C.accent(a.mode)}`)
    }

    ui.panel({
      title: C.textBold("Security Policies"),
      body: lines,
      color: C.dim,
    })
  } catch (e) {
    ui.errorMsg(`Policy status error: ${e}`)
  }
}

export async function checkCommandPolicy(state: TuiState, command: string) {
  try {
    const result = await state.sdk.checkCommand(command)
    if (result.destructive) {
      ui.warnMsg(`Destructive command detected (${result.severity})`)
      console.log(`  ${C.dim("Reason:")} ${C.text(result.reason ?? "unknown")}`)
    } else {
      ui.successMsg("Command is safe")
    }
  } catch (e) {
    ui.errorMsg(`Check failed: ${e}`)
  }
}
