#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Thirdwave TUI — Terminal UI for the AI Coding Platform
// ---------------------------------------------------------------------------
// Single unified mode — all messages go through direct vLLM chat for speed.
// OpenCode engine is used for session persistence, agent tools, and project
// context. There is no "direct vs opencode" toggle — just one seamless mode.
// ---------------------------------------------------------------------------

import { PlatformClient } from "../../src/sdk/client"
import { C, Box } from "./theme"
import * as ui from "./ui"
import * as h from "./handlers"
import type { TuiState } from "./handlers"
import * as readline from "readline"
// child_process no longer needed — graceful shutdown uses Bun APIs

// ── Config ───────────────────────────────────────────────────────────

const PLATFORM_URL = process.env.THIRDWAVE_URL ?? "http://localhost:3100"
const API_KEY = process.env.THIRDWAVE_API_KEY ?? undefined

// ── Init SDK ─────────────────────────────────────────────────────────

const sdk = new PlatformClient({
  baseUrl: PLATFORM_URL,
  apiKey: API_KEY,
})

// ── Readline ─────────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: process.stdin.isTTY === true,
  historySize: 200,
  prompt: "> ",
  completer: (line: string) => {
    const commands = [
      "/new", "/sessions", "/switch", "/delete", "/history",
      "/status", "/model",
      "/registry", "/registry refresh",
      "/apikey",
      "/skills", "/skills reload", "/skill",
      "/files", "/project", "/vcs", "/tasks",
      "/agents", "/build", "/plan", "/explore", "/general",
      "/audit", "/audit stats", "/budget", "/budget check", "/budget set",
      "/workspaces", "/workspace new", "/workspace switch",
      "/queue", "/orchestrate", "/orchestrations",
      "/parallel", "/parallel list",
      "/clear", "/help", "/quit",
    ]
    const hits = commands.filter(c => c.startsWith(line))
    return [hits.length ? hits : commands, line]
  },
})

// ── State ────────────────────────────────────────────────────────────

const state: TuiState = {
  sdk,
  currentSession: null,
  currentAgent: "build",
  currentModel: null,
  currentProvider: null,
  rl,
}

let processing = false

// ── Multiline / paste input ───────────────────────────────────────────
// readline fires one 'line' event per \n in the input, including every
// line of a pasted multi-line block.  We collect lines into a debounce
// buffer: if more lines arrive within 80 ms we keep accumulating; once
// 80 ms pass with no new input we submit everything as one message.
//
// This means:
//   • Normal single-line Enter → submitted after 80 ms (imperceptible)
//   • Paste of any size       → all lines collected, one submission
//   • """...""")  block mode   → explicit block, submitted on closing """
//   • line ending with \      → manual continuation (no debounce needed)
let pasteBuffer: string[] = []
let pasteTimer: ReturnType<typeof setTimeout> | null = null
let multilineBuffer: string[] = []
let inMultilineBlock = false
// After a multi-line paste is detected, we wait for one more line (the
// instruction) before submitting.  If no line arrives within 5 seconds
// we submit anyway.
let awaitingInstruction = false
let instructionTimer: ReturnType<typeof setTimeout> | null = null
let pendingPaste = ""

// ── Gateway live status tracking ─────────────────────────────────────
let _lastGatewayOnline: boolean | null = null

/** Poll the registry every 30 s and print a status change if gateway flips. */
function startGatewayStatusPoll() {
  setInterval(async () => {
    if (processing) return  // don't interrupt while AI is responding
    try {
      const reg = await state.sdk.registry().catch(() => null)
      if (!reg) return
      const gw = (reg.local as any[]).find((p: any) => p.isPrimary ?? p.endpoint)
      const isOnline = gw?.status === "online"
      if (_lastGatewayOnline === null) {
        _lastGatewayOnline = isOnline
        return  // skip the very first poll — no "changed" to report
      }
      if (isOnline !== _lastGatewayOnline) {
        _lastGatewayOnline = isOnline
        const models = gw?.models?.length ?? 0
        if (isOnline) {
          console.log(`\n  ${C.success("●")} ${C.muted("Gateway back online")} — ${C.accent(String(models))} model${models !== 1 ? "s" : ""} available`)
        } else {
          console.log(`\n  ${C.error("●")} ${C.muted("Gateway went offline")}`)
        }
        // Re-draw the prompt so the user knows something happened
        if (!processing) showPrompt()
      }
    } catch {}
  }, 30_000)
}

// ── Graceful shutdown ────────────────────────────────────────────────

let isShuttingDown = false

async function gracefulExit(code = 0) {
  if (isShuttingDown) return  // prevent double shutdown
  isShuttingDown = true

  console.log(`\n  ${C.muted("Shutting down...")}`)

  // 1. Close readline first so no more input is processed
  try { rl.close() } catch {}

  // 2. Stop the platform server gracefully (releases port) — only if WE started it.
  //    When the TUI connects to a running systemd service, THIRDWAVE_BACKEND_MANAGED is
  //    not set, so we leave the service alone.
  if (process.env.THIRDWAVE_BACKEND_MANAGED === "1") {
    try {
      const { shutdownPlatform } = await import("../../src/server/index")
      await shutdownPlatform()
      console.log(`  ${C.dim("Platform server stopped")}`)
    } catch {}
  }

  // 3. Stop OpenCode process gracefully (releases port) — only if WE started it.
  if (process.env.THIRDWAVE_OPENCODE_MANAGED === "1") {
    try {
      const { opencode } = await import("../../src/services/opencode-process")
      await opencode.stop()
      console.log(`  ${C.dim("OpenCode stopped")}`)
    } catch {}
  }

  console.log(`  ${C.muted("Goodbye!")}\n`)

  // Give a brief moment for I/O flush, then exit
  setTimeout(() => process.exit(code), 100)
}

process.on("SIGINT", () => { gracefulExit(0) })
process.on("SIGTERM", () => { gracefulExit(0) })

// ── Prompt Setup ─────────────────────────────────────────────────────

function showPrompt() {
  const sid = state.currentSession
    ? state.currentSession.id.slice(0, 8)
    : "none"
  const agent = h.agentLabel(state.currentAgent)
  const modelTag = state.currentModel
    ? C.dim(` ${Box.dot} ${state.currentModel.split("/").pop()}`)
    : ""
  console.log(`\n  ${agent} ${C.dim(Box.v)} ${C.accent(sid)}${modelTag}`)
  rl.setPrompt("  ❯ ")
  rl.prompt()
}

// ── Help Text ────────────────────────────────────────────────────────

function showHelp() {
  const w = (process.stdout.columns || 80) - 4
  console.log()
  console.log(`  ${C.primaryBg("  ◆ Thirdwave  ")}  ${C.muted("Command Reference")}`)
  console.log(`  ${C.dim(Box.h.repeat(w))}`)

  const groups: [string, [string, string][]][] = [
    ["Session & Chat", [
      ["/new",           "Create a new conversation session"],
      ["/sessions",      "List all sessions"],
      ["/switch <id>",   "Switch to a session (use 8-char prefix)"],
      ["/delete <id>",   "Delete a session"],
      ["/history",       "Show conversation in current session"],
      ["/status",        "Platform health + model info"],
      ["/model",         "Select model from available local/cloud models"],
      ["/registry",      "Local vLLM models + Cloud provider catalogue"],
      ["/registry refresh", "Re-probe vLLM endpoints"],
      ["/apikey",        "Set API key for a cloud provider"],
      ["/files",         "List project files"],
      ["/project",       "Project directory and git info"],
      ["/vcs",           "Current git branch"],
      ["/tasks",         "Background task queue"],
    ]],
    ["Agents", [
      ["/agents",        "List available agents (live from OpenCode)"],
      ["/build",         "Switch to Build agent (default, full permissions)"],
      ["/plan",          "Switch to Plan agent (read-only, no edits)"],
      ["/explore",       "Switch to Explore agent (codebase search)"],
      ["/general",       "Switch to General agent (multi-step tasks)"],
    ]],
    ["Skills", [
      ["/skills",          "List all skills grouped by category"],
      ["/skills <query>",  "Search skills by keyword"],
      ["/skill <name>",    "Read full skill content"],
      ["/skills reload",   "Reload skills from disk"],
    ]],
    ["Backend Features", [
      ["/audit",            "Recent audit log entries"],
      ["/audit stats",      "Aggregate audit statistics"],
      ["/budget",           "Token/request usage summary"],
      ["/budget check",     "Check if budget permits requests"],
      ["/budget set <n>",   "Set hourly token limit"],
      ["/policies",         "Security policy status & config"],
      ["/workspaces",       "List workspaces"],
      ["/workspace new",    "Create a workspace (interactive)"],
      ["/workspace switch", "Switch active workspace"],
      ["/queue",            "Queue worker metrics"],
      ["/orchestrate",      "Multi-agent DAG orchestration"],
      ["/orchestrations",   "List orchestrations"],
      ["/parallel",         "Fan-out parallel execution"],
      ["/parallel list",    "List parallel executions"],
    ]],
    ["General", [
      ["/clear",  "Clear terminal"],
      ["/help",   "This help"],
      ["/quit",   "Exit (auto-cleans ports 3100/4096)"],
    ]],
  ]

  for (const [group, cmds] of groups) {
    console.log()
    console.log(`  ${C.textBold(group)}`)
    for (const [cmd, desc] of cmds) {
      const padded = cmd.padEnd(20)
      console.log(`    ${C.accent(padded)} ${C.muted(desc)}`)
    }
  }

  console.log()
  console.log(`  ${C.dim("Type any text to send a prompt to the selected model.")}`)
  console.log(`  ${C.dim('Multiline: paste code → you\'ll be prompted to add an instruction.')}`)
  console.log(`  ${C.dim('Manual: end a line with \\ to continue, or type """ to enter/exit block mode.')}`)
  console.log()
}

// ── Welcome Screen ───────────────────────────────────────────────────

async function showWelcome() {
  const w = (process.stdout.columns || 80) - 4
  console.log()
  console.log(`  ${C.primaryBg("  ◆ Thirdwave  ")}  ${C.muted("AI Coding Platform")}`)
  console.log(`  ${C.dim(Box.h.repeat(w))}`)
  console.log()
  console.log(`  ${C.muted("Connecting to")} ${C.accent(PLATFORM_URL)}`)
  console.log(`  ${C.muted("Agent:")} ${h.agentLabel("build")}  ${C.dim("•")}  ${C.muted("Type anything to chat, /help for commands")}`)
}

// ── Command Dispatch ─────────────────────────────────────────────────

async function handleInput(line: string) {
  const trimmed = line.trim()
  if (!trimmed) return

  if (trimmed.startsWith("/")) {
    const [cmd, ...args] = trimmed.split(/\s+/)
    const arg = args.join(" ")

    switch (cmd) {
      case "/new":
        await h.createNewSession(state)
        break
      case "/sessions": case "/ls":
        await h.listSessions(state)
        break
      case "/switch": case "/sw":
        if (!arg) { ui.warnMsg("Usage: /switch <session-id-prefix>"); break }
        await h.switchSession(state, arg)
        break
      case "/delete": case "/del":
        if (!arg) { ui.warnMsg("Usage: /delete <session-id-prefix>"); break }
        await h.deleteSession(state, arg)
        break
      case "/history": case "/h":
        await h.showHistory(state)
        break
      case "/status": case "/st":
        await h.showStatus(state)
        break
      case "/model":
        await h.showModelSelector(state)
        break
      case "/apikey":
        await h.setApiKey(state)
        break
      case "/files":
        await h.showFiles(state)
        break
      case "/project":
        await h.showProject(state)
        break
      case "/vcs": case "/git":
        await h.showVcs(state)
        break
      case "/tasks":
        await h.showTasks(state)
        break

      case "/agents": case "/agent":
        await h.listAgents(state)
        break
      case "/build":
        await h.switchAgent(state, "build")
        break
      case "/plan":
        await h.switchAgent(state, "plan")
        break
      case "/explore":
        await h.switchAgent(state, "explore")
        break
      case "/general":
        await h.switchAgent(state, "general")
        break

      case "/registry":
        await h.showRegistry(state, arg || undefined)
        break

      case "/skills":
        await h.showSkills(state, arg || undefined)
        break
      case "/skill":
        if (!arg) { ui.warnMsg("Usage: /skill <skill-name>"); break }
        await h.showSkillDetail(state, arg)
        break

      case "/policies":
        await h.showPolicies(state)
        break

      case "/audit":
        await h.showAudit(state, arg || undefined)
        break
      case "/budget":
        if (arg.startsWith("set ")) {
          await h.showBudget(state, "set", arg.slice(4).trim())
        } else {
          await h.showBudget(state, arg || undefined)
        }
        break
      case "/workspaces":
        await h.showWorkspaces(state)
        break
      case "/workspace":
        if (arg === "new" || arg === "create") {
          await h.createWorkspaceInteractive(state)
        } else if (arg === "switch" || arg === "sw") {
          await h.switchWorkspaceInteractive(state)
        } else {
          await h.showWorkspaces(state)
        }
        break
      case "/queue":
        await h.showQueueMetrics(state)
        break
      case "/orchestrate":
        await h.startOrchestrationInteractive(state)
        break
      case "/orchestrations":
        await h.showOrchestrations(state)
        break
      case "/parallel":
        if (arg === "list" || arg === "ls") {
          await h.showParallelExecutions(state)
        } else {
          await h.startParallelInteractive(state)
        }
        break

      case "/clear":
        console.clear()
        await showWelcome()
        break
      case "/help": case "/?":
        showHelp()
        break
      case "/quit": case "/exit": case "/q":
        await gracefulExit(0)
        return
      default:
        ui.warnMsg(`Unknown command: ${cmd}`)
        console.log(`    ${C.dim("Type /help for available commands.")}`)
    }
  } else {
    // ── Send message — unified flow ────────────────────────────
    await h.sendMessage(state, trimmed)
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  process.on("unhandledRejection", (err) => {
    ui.errorMsg(`Unhandled error: ${err}`)
    if (!processing) showPrompt()
  })
  process.on("uncaughtException", (err) => {
    ui.errorMsg(`Unexpected error: ${err?.message ?? err}`)
    if (!processing) showPrompt()
  })

  console.clear()
  await showWelcome()

  // Health check
  const healthy = await h.checkHealth(state)
  if (!healthy) {
    console.log()
    ui.errorMsg(`Cannot reach platform at ${PLATFORM_URL}`)
    console.log(`    ${C.dim("Make sure the backend is running: bun run start")}`)
    console.log(`    ${C.dim("Set THIRDWAVE_URL if using a different address")}\n`)
    process.exit(1)
  }

  // Show system status — our registry (local vLLM + cloud catalogue)
  await h.showStatus(state)

  // Auto-resume or create session (needs OpenCode — graceful if unavailable)
  try {
    const sessions = await sdk.listSessions({ limit: 1 })
    if (sessions.length > 0) {
      state.currentSession = sessions[0]
      console.log()
      ui.successMsg(`Resumed session ${C.accent(state.currentSession.id.slice(0, 8))} — "${C.text(state.currentSession.title || "(untitled)")}"`)
    } else {
      await h.createNewSession(state)
    }
  } catch {
    try {
      await h.createNewSession(state)
    } catch {
      console.log()
      console.log(`  ${C.dim("OpenCode engine unavailable — running in direct chat mode.")}`)
      console.log(`  ${C.dim("Chat works via local vLLM. Session features require OpenCode.")}`)
    }
  }

  // Auto-select the fastest local model
  console.log()
  try {
    const chatModels = await sdk.chatModels()
    const fast = chatModels.models.find(m =>
      m.id.includes("gpt-oss") || m.id.includes("120b")
    ) ?? chatModels.models[0]
    if (fast) {
      state.currentModel = fast.id
      state.currentProvider = fast.provider
      console.log(`  ${C.muted("Model:")} ${C.accent(fast.name)} ${C.dim(`(${fast.providerName})`)}`)
    }
  } catch {
    console.log(`  ${C.dim("No chat models detected — using OpenCode default.")}`)
  }

  console.log()
  ui.footerHints(["/model pick model", "/skills knowledge", "/registry providers", "/apikey cloud keys", "/help commands", "/quit exit"])

  // Start background gateway status poll — notifies when gateway goes up/down
  startGatewayStatusPoll()

  // ── Input loop ───────────────────────────────────────────────

  // ── Submit helper (called by debounce timer or block-mode flush) ──
  async function submitInput(text: string) {
    if (!text.trim()) { showPrompt(); return }
    if (processing) return
    processing = true
    rl.pause()
    try {
      await handleInput(text)
    } catch (e: any) {
      ui.errorMsg(`Error: ${e?.message ?? e}`)
    } finally {
      processing = false
      rl.resume()
      showPrompt()
    }
  }

  rl.on("line", (line) => {
    // ── Awaiting instruction after paste ──────────────────────────
    // If we detected a multi-line paste and are waiting for an instruction
    // line, this incoming line IS that instruction — concatenate and submit.
    if (awaitingInstruction) {
      awaitingInstruction = false
      if (instructionTimer) { clearTimeout(instructionTimer); instructionTimer = null }
      if (line.trim().startsWith("/")) {
        // User typed a command — submit paste as-is, then handle the command
        submitInput(pendingPaste)
        pendingPaste = ""
        // Re-inject the command line for normal processing after paste submission
        // This is tricky since submitInput is async — queue it
        setTimeout(() => {
          pasteBuffer.push(line)
          if (pasteTimer) clearTimeout(pasteTimer)
          pasteTimer = setTimeout(() => {
            pasteTimer = null
            if (processing) { pasteBuffer = []; return }
            const text = pasteBuffer.splice(0).join("\n")
            submitInput(text)
          }, 80)
        }, 50)
        return
      }
      if (line.trim()) {
        // Append the instruction to the pending paste
        submitInput(pendingPaste + "\n" + line)
      } else {
        // Empty line = user just hit Enter → submit paste as-is
        submitInput(pendingPaste)
      }
      pendingPaste = ""
      return
    }

    // ── Block mode: """ ─────────────────────────────────────────────
    if (line.trim() === '"""') {
      // Cancel any in-flight debounce — block mode takes over
      if (pasteTimer) { clearTimeout(pasteTimer); pasteTimer = null; pasteBuffer = [] }
      if (!inMultilineBlock) {
        inMultilineBlock = true
        multilineBuffer = []
        process.stdout.write(`  ${C.dim('  (block mode — type """ alone on a new line to send)')}\n`)
        rl.setPrompt("  … ")
        rl.prompt()
      } else {
        inMultilineBlock = false
        const full = multilineBuffer.join("\n")
        multilineBuffer = []
        submitInput(full)
      }
      return
    }

    // Inside block mode — just accumulate, no debounce
    if (inMultilineBlock) {
      multilineBuffer.push(line)
      rl.setPrompt("  … ")
      rl.prompt()
      return
    }

    // ── \ continuation (manual) ──────────────────────────────────
    if (line.endsWith("\\")) {
      if (pasteTimer) { clearTimeout(pasteTimer); pasteTimer = null }
      multilineBuffer.push(line.slice(0, -1))
      rl.setPrompt("  … ")
      rl.prompt()
      return
    }

    // Flush \ buffer into the paste accumulator
    if (multilineBuffer.length > 0) {
      multilineBuffer.push(line)
      pasteBuffer.push(multilineBuffer.join("\n"))
      multilineBuffer = []
    } else {
      pasteBuffer.push(line)
    }

    // ── Debounce ─────────────────────────────────────────────────
    // Restart the 80 ms timer on every new line.  Pasted code fires all
    // lines within < 5 ms, so they all land in pasteBuffer before the
    // timer ever fires.  Single typed Enter fires once then idles.
    if (pasteTimer) clearTimeout(pasteTimer)
    pasteTimer = setTimeout(() => {
      pasteTimer = null
      if (processing) { pasteBuffer = []; return }  // busy — discard
      const text = pasteBuffer.splice(0).join("\n")

      // ── Multi-line paste detection ──────────────────────────────
      // If text has 3+ lines, it's likely a code paste.  Wait for
      // one more line (the user's instruction like "fix bugs") before
      // submitting.  Show a hint so the user knows to type.
      const lineCount = text.split("\n").length
      if (lineCount >= 3) {
        pendingPaste = text
        awaitingInstruction = true
        process.stdout.write(`\n  ${C.dim("  (paste detected — type your instruction and press Enter, or just Enter to send as-is)")}\n`)
        rl.setPrompt("  ❯ ")
        rl.prompt()
        // Safety timeout: if nothing arrives in 30s, submit paste as-is
        instructionTimer = setTimeout(() => {
          if (awaitingInstruction) {
            awaitingInstruction = false
            instructionTimer = null
            submitInput(pendingPaste)
            pendingPaste = ""
          }
        }, 30_000)
        return
      }

      submitInput(text)
    }, 80)
  })

  rl.on("close", () => gracefulExit(0))

  showPrompt()
}

main().catch((err) => {
  console.error(C.error("Fatal error:"), err)
  process.exit(1)
})
