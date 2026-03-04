#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Artemis TUI — Terminal UI for the AI Coding Platform
// ---------------------------------------------------------------------------
// Modular architecture:
//   theme.ts    → Color palette, box drawing, constants
//   ui.ts       → Reusable rendering primitives (panels, tables, spinners)
//   handlers.ts → All command handler functions
//   main.ts     → Entry point, readline loop, command dispatch (this file)
// ---------------------------------------------------------------------------

import { PlatformClient } from "../../src/sdk/client"
import { C, Box } from "./theme"
import * as ui from "./ui"
import * as h from "./handlers"
import type { TuiState } from "./handlers"
import * as readline from "readline"

// ── Config ───────────────────────────────────────────────────────────

const PLATFORM_URL = process.env.ARTEMIS_URL ?? "http://localhost:3100"
const API_KEY = process.env.ARTEMIS_API_KEY ?? undefined

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
      "/status", "/providers", "/model",
      "/registry", "/registry refresh",
      "/chat", "/direct",
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
let directMode = false  // when true, plain text goes through direct-chat (no OpenCode)

// ── Prompt Setup ─────────────────────────────────────────────────────
// We split prompt display into two parts:
//   1. A decorated status prefix (printed to stdout, NOT part of readline prompt)
//   2. A plain-text readline prompt (so character echo + cursor positioning works)

function showPrompt() {
  const sid = state.currentSession
    ? state.currentSession.id.slice(0, 8)
    : "none"
  const agent = h.agentLabel(state.currentAgent)
  const mode = directMode ? C.warning("direct") : ""
  const modelTag = state.currentModel ? C.dim(` ${Box.dot} ${state.currentModel.split("/").pop()}`) : ""
  console.log(`\n  ${agent} ${C.dim(Box.v)} ${C.accent(sid)}${modelTag}${mode ? ` ${C.dim(Box.v)} ${mode}` : ""}`)
  rl.setPrompt("  ❯ ")
  rl.prompt()
}

// ── Help Text ────────────────────────────────────────────────────────

function showHelp() {
  const w = (process.stdout.columns || 80) - 4
  console.log()
  console.log(`  ${C.primaryBg("  ◆ Artemis  ")}  ${C.muted("Command Reference")}`)  
  console.log(`  ${C.dim(Box.h.repeat(w))}`)

  const groups: [string, [string, string][]][] = [
    ["Session & Chat", [
      ["/new",           "Create a new conversation session"],
      ["/sessions",      "List all sessions"],
      ["/switch <id>",   "Switch to a session (use 8-char prefix)"],
      ["/delete <id>",   "Delete a session"],
      ["/history",       "Show conversation in current session"],
      ["/status",        "Platform health + model info"],
      ["/providers",     "List LLM providers (from OpenCode)"],      ["/model",         "Select model from available local/cloud models"],      ["/registry",      "Artemis model catalogue — local vLLM + cloud"],
      ["/registry refresh", "Re-probe vLLM endpoints"],
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
    ["Backend Features", [
      ["/audit",            "Recent audit log entries"],
      ["/audit stats",      "Aggregate audit statistics"],
      ["/budget",           "Token/request usage summary"],
      ["/budget check",     "Check if budget permits requests"],
      ["/budget set <n>",   "Set hourly token limit"],
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
      ["/quit",   "Exit"],
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
  console.log(`  ${C.dim("Type any text to send a prompt to your local vLLM model.")}`)
  console.log()
}

// ── Welcome Screen ───────────────────────────────────────────────────

async function showWelcome() {
  const w = (process.stdout.columns || 80) - 4
  console.log()
  console.log(`  ${C.primaryBg("  ◆ Artemis  ")}  ${C.muted("AI Coding Platform")}`)
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
      // ── Session & Chat ───────────────────────────────────────
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
      case "/providers": case "/models":
        await h.showProviders(state)
        break
      case "/model":
        await h.showModelSelector(state)
        break
      case "/chat":
        if (!arg) { ui.warnMsg("Usage: /chat <message>"); break }
        await h.sendDirectChat(state, arg)
        break
      case "/direct":
        directMode = !directMode
        if (directMode) {
          // In direct mode, prefer the fast local model (gpt-oss-120b at localhost)
          // unless user already picked a model
          if (!state.currentModel) {
            try {
              const chatModels = await state.sdk.chatModels()
              // Find gpt-oss-120b or any secondary fast model
              const fast = chatModels.models.find(m =>
                m.id.includes("gpt-oss") || m.id.includes("120b")
              ) ?? chatModels.models[0]
              if (fast) {
                state.currentModel = fast.id
                state.currentProvider = fast.provider
                console.log(`  ${C.dim(`Auto-selected: ${fast.name} (${fast.providerName})`)}`)
              }
            } catch {}
          }
          ui.successMsg("Direct chat mode ON — messages go straight to vLLM (no tools/agents)")
          console.log(`    ${C.dim("Use /direct again to switch back to OpenCode mode.")}`)
        } else {
          // Reset model selection to let OpenCode use its default (MiniMax)
          state.currentModel = null
          state.currentProvider = null
          ui.successMsg("OpenCode mode ON — full agent + tool support")
        }
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

      // ── Agents ───────────────────────────────────────────────
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

      // ── Registry ─────────────────────────────────────────
      case "/registry":
        await h.showRegistry(state, arg || undefined)
        break

      // ── Backend Features ─────────────────────────────────────
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

      // ── General ──────────────────────────────────────────────
      case "/clear":
        console.clear()
        await showWelcome()
        break
      case "/help": case "/?":
        showHelp()
        break
      case "/quit": case "/exit": case "/q":
        console.log(`\n  ${C.muted("Goodbye!")}\n`)
        process.exit(0)
      default:
        ui.warnMsg(`Unknown command: ${cmd}`)
        console.log(`    ${C.dim("Type /help for available commands.")}`)
    }
  } else {
    // Send as prompt to LLM
    if (directMode) {
      await h.sendDirectChat(state, trimmed)
    } else {
      await h.sendPrompt(state, trimmed)
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  // ── Global safety net ─────────────────────────────────────────
  // Catch stray promise rejections so they don't kill the process.
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
    console.log(`    ${C.dim("Set ARTEMIS_URL if using a different address")}\n`)
    process.exit(1)
  }

  // Show system status
  await h.showStatus(state)

  // Auto-resume or create session
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
    await h.createNewSession(state)
  }

  // Show quick hints
  console.log()

  // Auto-select fast local model for direct chat
  try {
    const chatModels = await sdk.chatModels()
    const fast = chatModels.models.find(m =>
      m.id.includes("gpt-oss") || m.id.includes("120b")
    ) ?? chatModels.models[0]
    if (fast) {
      state.currentModel = fast.id
      state.currentProvider = fast.provider
      directMode = true
      console.log(`  ${C.muted("Mode:")} ${C.warning("direct")} ${C.dim("|")} ${C.muted("Model:")} ${C.accent(fast.name)}`)
      console.log(`  ${C.dim("Direct chat (fast, no tools). Use /direct to toggle OpenCode mode.")}`)
    }
  } catch {
    console.log(`  ${C.dim("Direct chat models unavailable, using OpenCode mode.")}`)
  }

  console.log()
  ui.footerHints(["/model pick model", "/direct toggle mode", "/help commands", "/quit exit"])

  // ── Input loop ───────────────────────────────────────────────
  // Key design: we PAUSE readline while processing a command so that
  // (a) no input piles up, (b) the prompt is only shown when ready,
  // and (c) any async error is caught here, not as an orphaned rejection.

  rl.on("line", async (line) => {
    if (processing) return
    processing = true
    rl.pause()
    try {
      await handleInput(line)
    } catch (e: any) {
      ui.errorMsg(`Error: ${e?.message ?? e}`)
    } finally {
      processing = false
      rl.resume()
      showPrompt()
    }
  })

  rl.on("close", () => {
    // Ctrl+D or stdin EOF — exit gracefully
    console.log(`\n  ${C.muted("Goodbye!")}\n`)
    process.exit(0)
  })

  showPrompt()
}

main().catch((err) => {
  console.error(C.error("Fatal error:"), err)
  process.exit(1)
})
