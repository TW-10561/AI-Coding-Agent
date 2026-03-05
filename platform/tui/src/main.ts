#!/usr/bin/env bun
// ---------------------------------------------------------------------------
// Artemis TUI — Terminal UI for the AI Coding Platform
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

// ── Graceful shutdown ────────────────────────────────────────────────

let isShuttingDown = false

async function gracefulExit(code = 0) {
  if (isShuttingDown) return  // prevent double shutdown
  isShuttingDown = true

  console.log(`\n  ${C.muted("Shutting down...")}`)

  // 1. Close readline first so no more input is processed
  try { rl.close() } catch {}

  // 2. Stop the platform server gracefully (releases port 3100)
  try {
    const { shutdownPlatform } = await import("../../src/server/index")
    await shutdownPlatform()
    console.log(`  ${C.dim("Platform server stopped")}`)
  } catch {}

  // 3. Stop OpenCode process gracefully (releases port 4096)
  try {
    const { opencode } = await import("../../src/services/opencode-process")
    await opencode.stop()
    console.log(`  ${C.dim("OpenCode stopped")}`)
  } catch {}

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
    console.log(`    ${C.dim("Set ARTEMIS_URL if using a different address")}\n`)
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

  // ── Input loop ───────────────────────────────────────────────

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

  rl.on("close", () => gracefulExit(0))

  showPrompt()
}

main().catch((err) => {
  console.error(C.error("Fatal error:"), err)
  process.exit(1)
})
