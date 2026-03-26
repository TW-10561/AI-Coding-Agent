# Thirdwave AI — VS Code Extension Development

**Platform:** Thirdwave AI Coding Platform  
**Extension Publisher:** thirdwave-platform  
**Extension ID:** thirdwave-ai  
**VS Code Engine:** `^1.93.0`  
**Language:** TypeScript 5.x  
**Version:** 0.1.0  

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Objective](#2-objective)
3. [System Architecture](#3-system-architecture)
4. [Tech Stack](#4-tech-stack)
5. [Extension Features](#5-extension-features)
6. [Security & HITL Integration](#6-security--hitl-integration)
7. [Developer Guide](#7-developer-guide)
8. [Future Enhancements](#8-future-enhancements)
9. [Conclusion](#9-conclusion)

---

## 1. Introduction

Modern software development increasingly relies on AI coding assistants embedded directly inside the developer's editor. Existing solutions — GitHub Copilot, Cursor, Cline — typically send code and prompts to remote cloud servers, raising concerns about data privacy, latency, cost, and vendor lock-in.

The **Thirdwave VS Code Extension** is the editor-side component of the Thirdwave AI Coding Platform: a fully self-hosted, GPU-powered AI assistant that runs entirely on a local network. By integrating directly into VS Code — the most widely used code editor in the world — the extension brings AI-powered chat, tool-calling, multi-agent orchestration, and a curated knowledge skill library to developers without their code ever leaving the organisation's infrastructure.

The extension was developed as the primary user interface for the Thirdwave platform, complementing the existing Terminal UI (TUI) client for developers who prefer a graphical, context-aware experience inside their editor. It communicates with the Thirdwave backend platform server over a local HTTP connection, delegating all AI inference, tool execution, audit logging, and security policy enforcement to the platform layer.

### Background

The Thirdwave platform began as a backend-first system: a Hono/Bun REST API server that wraps the OpenCode engine and exposes a clean, production-grade interface — authentication, rate limiting, budget controls, audit trails, multi-agent orchestration, and a model registry. The TUI provided a terminal-based client. However, a terminal client lacks the rich, contextual integration that developers expect: seeing code side-by-side with the assistant, attaching the current file with one keypress, or having the assistant display tool call results inline. The VS Code extension was built to fill this gap.

---

## 2. Objective

The core objectives driving the VS Code extension development are:

### 2.1 Privacy-First AI Coding Assistant

Provide a VS Code–native AI coding assistant that routes all requests to a local Thirdwave platform server. No source code, prompts, or context is ever sent to a third-party cloud service unless the developer explicitly configures an optional cloud provider fallback in the model registry.

### 2.2 Full Platform Surface Access

Expose the entire Thirdwave platform API from within VS Code — not just chat, but also:
- Model registry with live online/offline status
- Session management (create, switch, delete conversations)
- Skills knowledge library (31+ curated engineering skills)
- Budget dashboard (token usage and quota)
- Audit log viewer (every API call, decision, and tool invocation)
- Security policy panel (RBAC rules, active guardrails)
- Human-in-the-Loop (HITL) approval panel

### 2.3 Deep Editor Integration

Use VS Code's native APIs to make the assistant workspace-aware:
- Automatically include the active file or selection as context
- Track open editors, recent saves, and file changes
- Pull live diagnostics (errors and warnings) from the language server
- Provide file attachment with one click

### 2.4 Dual Integration Paths

Operate in two modes simultaneously:
1. **Custom Sidebar Webview** — a full-featured React-style chat panel in the activity bar, giving maximum screen real estate and advanced UI features.
2. **Native VS Code Chat Participant** — register as `@thirdwave` in VS Code's built-in Chat panel, so users can interact using the same `@mention` convention used by GitHub Copilot Participants.

### 2.5 Agentic Tool-Calling Loop

Allow the AI to do more than generate text — enable it to execute bash commands, read and write files, list directories, search code, and fetch URLs — all within the platform's security guardrails, with the full tool call chain visible to the developer inside the chat panel.

---

## 3. System Architecture

### 3.1 Overall Architecture

The VS Code extension sits at the outermost layer of the Thirdwave stack. Below is the full layered architecture from developer to GPU:

```
┌───────────────────────────────────────────────────────────────┐
│                    VS Code Editor                             │
│                                                               │
│  ┌─────────────────────────┐  ┌──────────────────────────┐   │
│  │  Thirdwave Sidebar      │  │  @thirdwave Chat         │   │
│  │  (WebviewView)          │  │  Participant              │   │
│  │  - Chat panel           │  │  - /explain /fix         │   │
│  │  - Model selector       │  │  - /test /review         │   │
│  │  - Session manager      │  │  - /models /skills       │   │
│  │  - Skills browser       │  │                          │   │
│  │  - HITL panel           │  └──────────┬───────────────┘   │
│  │  - Audit / Budget       │             │                    │
│  └────────────┬────────────┘             │                    │
│               │                          │                    │
│  ┌────────────▼──────────────────────────▼────────────────┐  │
│  │              ThirdwaveClient (SDK)                     │  │
│  │  HTTP wrapper: chat, registry, sessions, skills,       │  │
│  │  budget, audit, HITL, workspace, providers             │  │
│  └────────────────────────┬───────────────────────────────┘  │
│                           │                                   │
│  ┌────────────────────────▼───────────────────────────────┐  │
│  │            WorkspaceManager                            │  │
│  │  File tracking, diagnostics, attachments, context     │  │
│  └────────────────────────────────────────────────────────┘  │
└───────────────────────────┬───────────────────────────────────┘
                            │ HTTP :3100
                            ▼
┌───────────────────────────────────────────────────────────────┐
│               Thirdwave Platform Server (Hono/Bun)            │
│                                                               │
│  Middleware: Auth → Rate Limit → Logger → Audit               │
│                                                               │
│  /api/chat          AI agentic loop (up to 15 tool rounds)   │
│  /api/sessions      Session CRUD via OpenCode engine          │
│  /api/registry      Model registry (local + cloud)            │
│  /api/skills        Knowledge skill library (31+ skills)      │
│  /api/budget        Token quota and cost tracking             │
│  /api/audit         SQLite audit log queries                  │
│  /api/hitl          HITL approval request lifecycle           │
│  /api/policies      Security policy engine rules              │
│  /api/queue         Scalable task queue                       │
│  /api/orchestrations Multi-agent DAG orchestration            │
│  /api/parallel      Fan-out / fan-in parallel execution       │
│  /api/workspaces    Multi-project workspace management        │
│                                                               │
│  Services:                                                    │
│  ├── OpenCodeClient → OpenCode Engine (:4096)                 │
│  ├── ProviderRegistry (vLLM local + 9 cloud providers)        │
│  ├── SkillManager (31 curated skills)                         │
│  ├── PolicyEngine (10 security rules)                         │
│  ├── HITLService (approval lifecycle)                         │
│  ├── BudgetManager (SQLite quotas)                            │
│  ├── AuditLogger (SQLite WAL)                                 │
│  ├── SubagentOrchestrator (DAG fan-out/fan-in)                │
│  ├── ParallelExecutionManager (concurrent tasks)              │
│  └── ScalableQueue (priority + retry, SQLite-backed)          │
└───────────────────────────┬───────────────────────────────────┘
                            │ HTTP :4096
                            ▼
┌───────────────────────────────────────────────────────────────┐
│               OpenCode Engine                                 │
│  Sessions, Agents, Tools, MCP, LSP, File Ops, SQLite, SSE    │
└───────────────────────────┬───────────────────────────────────┘
                            │
      ┌─────────────────────┼──────────────────────┐
      ▼                     ▼                       ▼
┌──────────┐         ┌──────────┐          ┌──────────────────┐
│  vLLM #1 │         │  vLLM #2 │          │  Cloud APIs      │
│  :8000   │         │  :31254  │          │  OpenAI · Groq   │
│  MiniMax │         │  Qwen    │          │  Anthropic ·Google│
└──────────┘         └──────────┘          └──────────────────┘
```

### 3.2 Extension Source Structure

```
platform/vscode-extension/
├── src/
│   ├── extension.ts              ← Activation entry point
│   ├── chat/
│   │   ├── ChatViewProvider.ts   ← Sidebar webview panel
│   │   └── ChatParticipant.ts    ← @thirdwave native chat participant
│   ├── sdk/
│   │   └── ThirdwaveClient.ts    ← HTTP SDK wrapper
│   ├── workspace/
│   │   └── WorkspaceManager.ts   ← Editor context tracking
│   └── providers/                ← Inline completion providers (future)
├── media/
│   └── (webview CSS/assets)
├── images/
│   └── agent-logo.png
├─ package.json                  ← Extension manifest
└── tsconfig.json
```

### 3.3 Key Design Patterns

**Message-passing webview architecture.** The sidebar chat panel is a `WebviewView` that renders HTML/CSS/JavaScript in a sandboxed iframe. Communication between the extension host (Node.js) and the webview happens exclusively through `postMessage` calls. This is VS Code's mandated security boundary — no direct DOM access, no shared memory.

**Client-server separation.** The extension is intentionally thin. It does not run any AI inference, manage any databases, or own any persistent state beyond session history. All intelligence lives in the platform server. The extension is a UI shell.

**Dual interface strategy.** The `ChatViewProvider` owns the full sidebar experience (models, skills, HITL, audit), while `ChatParticipant` provides a focused integration into VS Code's built-in Chat panel for developers who prefer that surface. Both share the same `ThirdwaveClient` instance.

**WorkspaceManager as a context bus.** Rather than reading editor state inside chat message handlers (which would couple the chat to VS Code's editor API), `WorkspaceManager` tracks editor state continuously and exposes a `getContext()` snapshot. This decouples workspace awareness from the chat flow.

---

## 4. Tech Stack

### 4.1 Extension Runtime

| Technology | Version | Role |
|------------|---------|------|
| **TypeScript** | 5.4+ | Primary language — all source files |
| **VS Code API** | `^1.93.0` | Editor integration, webview, commands, chat |
| **Node.js** | 20+ | Extension host runtime |
| **marked** | 15.x | Markdown-to-HTML rendering in the webview |

### 4.2 Platform Backend (consumed by the extension)

| Technology | Version | Role |
|------------|---------|------|
| **Bun** | 1.3+ | JavaScript runtime for the platform server |
| **Hono** | 4.10.7 | HTTP web framework powering the REST API |
| **SQLite** (bun:sqlite) | WAL mode | Audit logs, budget records, task state |
| **OpenCode** | 1.2.17 | AI coding engine (tools, sessions, agents) |
| **vLLM** | Latest | Local GPU inference server (OpenAI-compatible API) |
| **Ollama** | Latest | Additional local model server |
| **Zod** | 3.x | Schema validation on all API request bodies |

### 4.3 Build and Tooling

| Tool | Role |
|------|------|
| **tsc** (TypeScript Compiler) | Compiles `src/` → `out/` |
| **ESLint** | Linting for TypeScript source |
| **turbo** | Monorepo task runner (shared with platform) |
| **npm** | Package management for the extension |

### 4.4 VS Code Extension APIs Used

| API | Usage |
|-----|-------|
| `vscode.chat` | Register `@thirdwave` chat participant with slash commands |
| `vscode.window.registerWebviewViewProvider` | Mount sidebar chat panel |
| `vscode.commands.registerCommand` | 15+ commands (openChat, selectModel, selectAgent, etc.) |
| `vscode.window.createStatusBarItem` | Model and agent indicator in the status bar |
| `vscode.workspace.getConfiguration` | Read/write extension settings |
| `vscode.window.showQuickPick` | Interactive model/agent selection dialogs |
| `vscode.languages.createDiagnosticCollection` | (Future) Inline error surfacing |
| `vscode.window.onDidChangeActiveTextEditor` | Track active file for context |
| `vscode.workspace.onDidSaveTextDocument` | Track recent file changes |
| `vscode.env.openExternal` | Open skill documentation links |
| `ExtensionContext.globalState` | Persist sessions and chat history |
| `ExtensionContext.workspaceState` | Persist skill selections per workspace |

### 4.5 Security Model

The extension follows VS Code's Content Security Policy requirements for webviews: all script execution is restricted to content with a matching nonce, external resource loading is blocked, and the webview's `localResourceRoots` is scoped to `extensionUri`. All inter-process communication uses the message-passing API rather than `eval` or arbitrary DOM injection.

---

## 5. Extension Features

### 5.1 Sidebar Chat Panel

The centrepiece of the extension is a unified sidebar webview registered under the `thirdwave` activity bar container. It renders a multi-tab chat interface with the following sections:

**Chat Tab**
- Full conversation history rendered with markdown (code blocks, bold, headings, lists)
- Code blocks include a copy-to-clipboard button
- Tool call results are collapsed under an expandable "Tool calls" section showing the tool name, arguments as JSON, and the result
- Reasoning blocks (for reasoning models like MiniMax) are shown in a collapsible "Reasoning" section
- Token usage and latency are displayed below each assistant message
- A loading indicator with animated dots appears during AI inference
- Auto-session titling: the first user message becomes the session title
- Session history is persisted in `ExtensionContext.globalState` — chat survives reloads

**Models Tab**
- Lists all local vLLM/Ollama models from the provider registry with live online/offline status badges
- Lists all configured cloud providers (OpenAI, Groq, Anthropic, Google, Together, Fireworks, Mistral, DeepSeek, OpenRouter) with per-model context window, output limit, and cost per million tokens
- One-click model selection updates `thirdwave.defaultModel` and posts a status update to the webview
- An inline API key input allows configuring cloud providers without leaving VS Code

**Skills Tab**
- Displays all installed skills from the platform's skill library (31+ curated engineering skills across categories: debugging, testing, API design, CI/CD, security, performance, etc.)
- Each skill shows its name, category, version, and description
- Skills can be toggled on/off per workspace; enabled skills are injected into the system prompt as additional context
- A search box filters skills by name or description
- "View Skill" opens a dedicated VS Code panel showing the full skill content (SKILL.md)

**Sessions Tab**
- Shows all conversation sessions with timestamps and auto-generated titles
- One-click session switching loads the persisted message history into the chat view
- Individual sessions can be deleted
- New sessions are created automatically on first message or via the "New Session" button

**HITL Tab (Human-in-the-Loop)**
- Displays pending approval requests from the AI agent: bash commands, file writes, network requests, and other flagged actions
- Each request shows the action description, risk score, risk level (critical/high/medium/low), and the reasons the policy engine flagged it
- Approve or Deny buttons send the decision back to the platform via the HITL API
- Resolved decisions (approved/denied/expired) are shown in a history log

### 5.2 Native Chat Participant (`@thirdwave`)

Registered with VS Code's Chat API as `thirdwave.chat.participant`, this integration allows users to type `@thirdwave` inside VS Code's built-in Chat panel (the Ctrl+Alt+I panel).

**Slash Commands:**

| Command | Behaviour |
|---------|-----------|
| `@thirdwave /explain` | Explains selected code or the visible range of the active file |
| `@thirdwave /fix` | Identifies and fixes issues in the selected code |
| `@thirdwave /test` | Generates unit tests for the selected code |
| `@thirdwave /review` | Reviews code for bugs, security issues, and improvements |
| `@thirdwave /models` | Lists all available local and cloud models with status |
| `@thirdwave /skills` | Lists or searches the installed skill library |

**Context injection.** Before sending user messages to the platform, the participant automatically appends the active editor context: if text is selected, the selection is included; if no selection, the visible screen range is used. The file path and language ID are included to give the model full awareness of what the developer is looking at.

**Skill hints.** The participant extracts keywords from the user prompt and queries the `GET /api/skills/search` endpoint. If relevant skills are found, they are shown as bold markdown above the response — surfacing useful codified knowledge at the right moment.

**Conversation history.** VS Code passes the full `ChatContext` history to the participant handler. The extension reconstructs `{ role, content }` pairs and forwards them to the platform's `/api/chat` endpoint so the AI maintains full context across turns.

### 5.3 ThirdwaveClient SDK

`src/sdk/ThirdwaveClient.ts` is a lightweight HTTP client — a thin wrapper around `fetch` — that encapsulates all platform API calls. It handles:

- Bearer token authentication (if `apiKey` is configured)
- Streaming SSE responses for real-time token delivery
- Typed request/response interfaces for all endpoints
- Health checks on extension activation

**Endpoints wrapped:**

| Method | Endpoint | Client Method |
|--------|----------|---------------|
| `POST` | `/api/chat` | `chat()` (streaming SSE) |
| `GET` | `/api/registry` | `registry()` |
| `GET/POST/DELETE` | `/api/sessions` | `listSessions()`, `createSession()`, `deleteSession()` |
| `GET` | `/api/skills` | `listSkills()` |
| `GET` | `/api/skills/search` | `searchSkills(query)` |
| `GET` | `/api/skills/:id` | `getSkill(id)` |
| `GET` | `/api/budget` | `budget()` |
| `GET` | `/api/audit` | `auditLogs()` |
| `GET/POST` | `/api/hitl/pending` | `hitlPending()`, `resolveHitl()` |
| `GET` | `/api/hitl/stats` | `hitlStats()` |
| `GET` | `/api/hitl/resolved` | `hitlResolved()` |
| `GET` | `/api/policies` | `policies()` |
| `POST` | `/api/registry/cloud/:id/key` | `setCloudProviderKey()` |
| `GET` | `/health` | `health()` |

### 5.4 WorkspaceManager

`src/workspace/WorkspaceManager.ts` is an independent service (no OpenCode dependency) that continuously monitors the VS Code workspace and provides context snapshots at any point in time.

**Tracked state:**

| Signal | Details |
|--------|---------|
| Active file | Relative path and language ID of the file in focus |
| Selection | Selected text (up to 500 characters) |
| Open editors | Up to 10 recently opened file paths |
| Recent saves | Up to 10 recently saved files (LRU list) |
| Workspace roots | All folder roots in the workspace |
| Diagnostics | Error and warning counts, top 5 entries grouped by file |
| Attached files | Files explicitly dragged into the chat for context |

When the user sends a chat message, the context snapshot (`WorkspaceContext`) is serialised and injected into the system prompt, giving the AI a live picture of the developer's state — active file, recent changes, existing errors — without the user having to manually describe it.

**File attachment.** Developers can attach files explicitly via:
- "Pick Files" — opens a VS Code file picker dialog
- "Attach Active File" — instantly attaches the current editor's content
- "Remove Attachment" — drops an attached file from the context

### 5.5 Commands

The extension contributes 15 registered commands accessible from the Command Palette (`Ctrl+Shift+P`):

| Command | Action |
|---------|--------|
| `Thirdwave: Open Chat` | Focus the sidebar chat panel |
| `Thirdwave: New Session` | Create a new conversation session |
| `Thirdwave: Select Model` | QuickPick model chooser from registry |
| `Thirdwave: Select Agent` | QuickPick agent mode chooser |
| `Thirdwave: Show Model Registry` | Open model registry info panel |
| `Thirdwave: Show Budget` | Open budget dashboard panel |
| `Thirdwave: Show Audit Log` | Open audit log viewer panel |
| `Thirdwave: Show Security Policies` | Open security policy panel |
| `Thirdwave: Search Skills` | Search skill library by keyword |
| `Thirdwave: View Skill` | Open a skill's full content panel |
| `Thirdwave: Refresh Skills` | Force-reload the skill library |
| `Thirdwave: Refresh Sessions` | Reload the sessions list |
| `Thirdwave: Refresh Model Registry` | Re-poll all model providers for status |
| `Thirdwave: Select Model By ID` | Programmatically select a model |
| `Thirdwave: Delete Session` | Delete a session (with confirmation dialog) |

### 5.6 Status Bar

Two persistent status bar items appear in the editor's bottom bar:

- **Model indicator** (`$(server) <model-name>`) — left-aligned, clicking opens the model QuickPick. Shows `gateway default` when no model is explicitly selected.
- **Agent indicator** (`$(tools) build`) — left-aligned next to the model, clicking opens the agent QuickPick. Icon changes with mode: `$(tools)` for build, `$(book)` for plan, `$(search)` for explore, `$(lightbulb)` for general.

Both update immediately on model/agent changes from either the sidebar or the command palette.

### 5.7 Agent Modes

Four agent modes mirror the agents defined in the OpenCode engine:

| Mode | Icon | Capability |
|------|------|-----------|
| `build` | `$(tools)` | Full read/write/execute — can run bash, write files, fetch URLs. Default for coding tasks. |
| `plan` | `$(book)` | Read-only planning and analysis — no code execution or file writes |
| `explore` | `$(search)` | Codebase exploration and search — navigates the project structure |
| `general` | `$(lightbulb)` | Multi-step reasoning and general tasks — no project-specific tools |

### 5.8 Configuration Settings

All settings are under the `thirdwave` namespace and configurable via VS Code settings UI or `settings.json`:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `thirdwave.platformUrl` | string | `http://localhost:3100` | Platform backend URL |
| `thirdwave.apiKey` | string | `""` | Optional API key for auth |
| `thirdwave.defaultModel` | string | `""` | Default model ID (empty = auto) |
| `thirdwave.defaultAgent` | enum | `build` | Default agent mode |
| `thirdwave.maxTokens` | number | `8192` | Max output tokens per request |
| `thirdwave.temperature` | number | `0.3` | Temperature (0.0–1.0) |
| `thirdwave.enableTools` | boolean | `true` | Enable tool-calling agentic loop |

Configuration changes are watched live — updating `platformUrl` or `apiKey` instantly rebuilds the `ThirdwaveClient` without requiring a window reload.

---

## 6. Security & HITL Integration

The VS Code extension is the human-facing endpoint of the platform's multi-layer security architecture.

### 6.1 The Security Pipeline

Every AI-initiated action passes through the following layers before execution:

```
AI Agent decides to run a bash command / write a file / fetch a URL
                        │
                        ▼
              ┌─────────────────────┐
              │  PolicyEngine       │
              │  - 10 security rules│
              │  - Path traversal   │
              │  - Secret file guard│
              │  - Command injection│
              └──────────┬──────────┘
                         │
                         ▼
              ┌─────────────────────┐
              │  RiskEngine         │
              │  - Score 0–100      │
              │  - < 40 → allow     │
              │  - 40–79 → ask HITL │
              │  - ≥ 80 → deny      │
              └──────────┬──────────┘
                         │
              if score 40–79:
                         ▼
              ┌─────────────────────┐
              │  HITLService        │
              │  - Create approval  │
              │  - SSE push to UI   │
              │  - Await decision   │
              └──────────┬──────────┘
                         │
              User sees request in HITL panel:
              Approve ──→ action proceeds
              Deny ────→ action blocked + logged
                         │
                         ▼
              ┌─────────────────────┐
              │  AuditLogger        │
              │  SQLite WAL         │
              │  Every decision     │
              └─────────────────────┘
```

### 6.2 RiskEngine

The `RiskEngine` (`platform/HITL/riskEngine.ts`) computes a numeric risk score (0–100) for every AI action based on context factors:

| Factor | Risk Points |
|--------|------------|
| Critical destructive command (e.g. `rm -rf`) | 95 |
| High destructive command (e.g. `dd if=...`) | 85 |
| Medium destructive command (e.g. `chmod 777`) | 60 |
| References sensitive files (`.env`, `.key`, `.pem`, secrets) | 70 |
| Package installation (`npm install`, `pip install`) | 40 |
| External network request (`curl`, `wget`) | 30 |
| Large file diff (> 10,000 bytes) | 50 |
| Repeated command (loop detection) | 30 |
| Excessive iteration count | 20 |

### 6.3 RBAC (Role-Based Access Control)

The `RBACEngine` (`platform/HITL/rbac.ts`) defines per-role permission policies enforced before the risk engine:

| Role | Bash | Edit | Read | Web Fetch | Doom Loop |
|------|------|------|------|-----------|-----------|
| `admin` | allow | allow | allow | allow | allow |
| `developer` | ask | allow | allow | ask | ask |
| `readonly` | deny | deny | allow | deny | deny |
| `autonomous_agent` | allow | allow | allow | allow | ask |

### 6.4 HITL Panel in VS Code

The HITL tab in the sidebar webview displays:

- **Pending approvals** — each with action type, command or file path, risk score badge (colour-coded), risk level label, and the list of policy reasons that triggered the request
- **Approve / Deny buttons** — submitting either calls `client.resolveHitl(requestId, decision)` → `POST /api/hitl/:id/resolve`, which the platform uses to unblock the agent or terminate the action
- **Resolved history** — shows recent approved/denied decisions with timestamps and the agent name that triggered them
- **Expiry** — requests auto-expire after 5 minutes if not resolved

### 6.5 Audit Log Viewer

The "Show Audit Log" command opens a VS Code panel rendering the latest audit log entries from `GET /api/audit`. Each entry shows:
- Timestamp
- HTTP method and route
- User/API key identifier
- Response status code
- Latency in milliseconds
- Token usage (if an AI call)

---

## 7. Developer Guide

### 7.1 Prerequisites

- **Node.js ≥ 18** or **Bun** for building
- **VS Code ≥ 1.93.0**
- **Thirdwave platform server** running on `http://localhost:3100`

### 7.2 Build

```bash
cd platform/vscode-extension

# Install dependencies
npm install

# One-time compile
npm run compile

# Watch mode (recompiles on save)
npm run watch
```

### 7.3 Run in Development

**Option A — from terminal:**
```bash
code --extensionDevelopmentPath="$(pwd)"
```

**Option B — from VS Code:**
1. Open `platform/vscode-extension` in VS Code
2. Press `F5` → "VS Code Extension Development" launch config
3. A new Extension Development Host window opens with the extension active

After modifying source files (in watch mode), press `Ctrl+Shift+P` → "Developer: Reload Window" in the Extension Development Host to pick up changes.

### 7.4 Configuration (Development)

In the Extension Development Host, open Settings (`Ctrl+,`) and search for `thirdwave`:

```json
{
  "thirdwave.platformUrl": "http://localhost:3100",
  "thirdwave.defaultAgent": "build",
  "thirdwave.maxTokens": 8192,
  "thirdwave.temperature": 0.3,
  "thirdwave.enableTools": true
}
```

### 7.5 Package for Distribution

```bash
npm install -g @vscode/vsce
vsce package
```

This produces a `.vsix` file that can be installed with:
```bash
code --install-extension thirdwave-ai-0.1.0.vsix
```

### 7.6 Adding a New API Endpoint to the Extension

1. Add the new method to `ThirdwaveClient.ts` following the existing pattern:
   ```typescript
   async myNewEndpoint(): Promise<MyResponseType> {
     return this._get<MyResponseType>("/api/my-route");
   }
   ```
2. Call it in `ChatViewProvider.ts` inside the `resolveWebviewView` message handler or a dedicated `_loadXxx()` method.
3. Post the result to the webview with `this._post({ type: "myNewData", data: result })`.
4. Handle `myNewData` in the webview HTML/JS to render it.

---

## 8. Future Enhancements

The current extension provides a strong foundation. The following enhancements are identified for future development iterations:

### 8.1 Streaming Chat Responses (Token-by-Token)

**Current state:** The extension calls `/api/chat` which is an SSE streaming endpoint, but the current webview implementation accumulates the full response before rendering.

**Target:** Implement true token-by-token streaming in the webview — display each token as it arrives, exactly like ChatGPT or Copilot Chat, using the existing SSE stream from `ThirdwaveClient`.

**Why:** Streaming dramatically improves perceived performance for long responses. With reasoning models (like MiniMax) taking 60–180 seconds per inference call, showing progressive output is essential for a good UX.

### 8.2 Inline Code Completion (Ghost Text)

**Current state:** The extension provides chat-based assistance. There is no inline code completion.

**Target:** Register a `vscode.languages.registerInlineCompletionItemProvider` for all supported languages. When the developer pauses typing for ~500ms, send the current file prefix (and optionally suffix) to `/api/chat` with a completion-focused system prompt, and render the suggestion as VS Code ghost text.

**Considerations:** Needs debouncing to avoid flooding the platform with requests, and a dedicated fast model (e.g. a small 7B parameter local model) for sub-500ms response times.

### 8.3 Inline Diagnostics and Quick Fixes

**Current state:** `WorkspaceManager` collects diagnostic data (errors and warnings) but only includes it in the chat system prompt as text.

**Target:** Register a `vscode.languages.registerCodeActionsProvider` that offers "Fix with Thirdwave AI" as a quick fix action on any error squiggle. Invoking the action sends the error + surrounding code to the platform and opens the chat panel with the fix response pre-populated.

### 8.4 Editor Diff Preview for AI Edits

**Current state:** When the AI writes a file via a tool call, the change is applied immediately. The result appears in the chat as a tool call log entry.

**Target:** Before applying any AI-initiated file write, compute a diff and display it using VS Code's native diff editor (`vscode.commands.executeCommand("vscode.diff", ...)`). The developer can accept, reject, or edit the proposed change before it is committed to disk — similar to how Copilot Edits works.

### 8.5 Multi-File Edit Sessions (Agent Mode)

**Target:** A dedicated "Agent" mode in the sidebar where the developer describes a task ("Refactor the authentication module to use JWT"), and the extension enters an agentic loop: the AI reads files, proposes edits, the developer approves diffs, and the agent iterates. This would use the platform's `/api/orchestrations` endpoint to decompose the task into subtasks.

### 8.6 Real-Time Collaboration

**Target:** Multiple developers can share a Thirdwave session. One developer's chat session is reflected in real-time in their colleague's VS Code window, using the platform's SSE event bus (`/api/events`). Useful for pair programming with AI assistance.

### 8.7 Git Integration

**Target:** The extension reads the current git diff (`git diff HEAD`) and staged changes, automatically including them as context when the user asks about recent changes or requests a commit message. Add a dedicated command "Generate Commit Message" that produces a conventional commit message from the staged diff.

### 8.8 Terminal Integration

**Target:** When the AI suggests a bash command in the chat, a "Run in Terminal" button executes it in the VS Code integrated terminal rather than through the platform's bash tool. This gives the developer full visibility and control over command execution.

### 8.9 Extension Marketplace Publication

**Target:** Publish the extension to the Visual Studio Marketplace and the Open VSX Registry, making it installable by any VS Code or VSCodium user pointing to their own Thirdwave platform server.

**Requirements before publication:**
- Icon and branding assets
- Comprehensive README with screenshots
- Automated CI/CD pipeline (GitHub Actions) for packaging and publishing
- Semantic versioning and a changelog
- End-to-end test suite using `@vscode/test-electron`

### 8.10 MCP (Model Context Protocol) Tool Integration

**Target:** Expose the VS Code extension's workspace context (files, diagnostics, git status) as MCP tools that the platform's AI can call directly — instead of the AI having to use bash to inspect the workspace. This would make tool calls faster and more reliable.

### 8.11 Notebook Support

**Target:** A dedicated notebook kernel (`NotebookController`) that allows running individual cells through the Thirdwave AI. Each cell's output is the AI's response, supporting iterative exploration in `.ipynb` notebooks.

---

## 9. Conclusion

The Thirdwave VS Code Extension represents the final user-facing layer of a complete, self-hosted AI coding platform. It achieves the key engineering goals of the Thirdwave project:

**Privacy and control.** By routing all AI inference through a local platform server backed by local GPU inference (vLLM), the extension ensures that no code or developer context leaves the organisation's network — a critical requirement for organisations handling sensitive intellectual property.

**Deep editor integration.** Through VS Code's rich extension API, the extension provides a context-aware experience that goes beyond a simple chat window: it tracks the active file, editor selection, recent changes, and live diagnostics, injecting this awareness automatically into every AI interaction.

**Two complementary interfaces.** The custom sidebar webview provides a comprehensive platform dashboard (chat, models, skills, HITL, audit, budget), while the native `@thirdwave` chat participant provides a focused, friction-free entry point for quick questions and code-centric slash commands. Developers can use whichever surface fits their workflow.

**Security by design.** The HITL panel brings the platform's multi-layer security system (PolicyEngine + RiskEngine + RBAC + AuditLogger) to the developer's attention in real time. Flagged AI actions surface as approval requests the developer can review and decide on, keeping humans in control of consequential operations.

**Extensibility.** The clear separation between the extension's three layers — WebviewView (UI), ThirdwaveClient (API), WorkspaceManager (context) — makes adding new features straightforward. The planned enhancements (streaming, inline completion, diff preview, git integration) can each be implemented independently without restructuring the existing codebase.

The Thirdwave VS Code Extension is a working, deployable AI coding assistant today, and a strong foundation for the richer, more deeply integrated developer experience outlined in the future enhancements above.

---

*Document prepared for the Thirdwave AI Coding Platform.*  
*Last updated: 2026-03-19*
