# Thirdwave AI — VS Code Extension

AI coding assistant powered by the Thirdwave platform — chat, tool calling, multi-agent orchestration, and skill-based knowledge.

## Features

- **AI Chat Panel** — sidebar chat with tool-call display, reasoning blocks, copy-code buttons, and lightweight markdown rendering
- **Model Selector** — browse and switch between local vLLM and cloud models via the sidebar tree or status bar
- **Session Manager** — create, switch, and delete conversation sessions
- **Skills Browser** — browse, search, and view installed agent skills by category
- **Agent Modes** — switch between `build`, `plan`, `explore`, and `general` agent modes
- **Info Panels** — view model registry, budget, audit log, and security policies

## Prerequisites

1. **Thirdwave Platform** running (default: `http://localhost:3100`)
2. **Node.js ≥ 18** or **Bun** for building
3. **VS Code ≥ 1.85.0**

## Quick Start

### 1. Install dependencies

```bash
cd platform/vscode-extension
npm install
```

### 2. Compile

```bash
npm run compile
```

### 3. Launch in VS Code (Extension Development Host)

**Option A — From the terminal:**

```bash
code --extensionDevelopmentPath="$(pwd)"
```

This opens a new VS Code window with the extension loaded. The Thirdwave icon appears in the activity bar.

**Option B — From VS Code:**

1. Open the `platform/vscode-extension` folder in VS Code
2. Press `F5` (or `Run > Start Debugging`)
3. Select "VS Code Extension Development" if prompted
4. A new VS Code window opens with the extension active

### 4. Configure

Open VS Code settings and search for `thirdwave`:

| Setting | Default | Description |
|---------|---------|-------------|
| `thirdwave.platformUrl` | `http://localhost:3100` | URL of the Thirdwave platform backend |
| `thirdwave.apiKey` | (empty) | API key for authentication (optional) |
| `thirdwave.defaultModel` | (auto) | Default model ID for chat |
| `thirdwave.defaultAgent` | `build` | Default agent mode |
| `thirdwave.maxTokens` | `8192` | Maximum output tokens per request |
| `thirdwave.temperature` | `0.3` | Temperature (0.0 – 1.0) |
| `thirdwave.enableTools` | `true` | Enable tool calling for agentic responses |

### 5. Watch mode (for development)

```bash
npm run watch
```

This recompiles on every save. Reload the Extension Development Host window (`Ctrl+Shift+P` → "Developer: Reload Window") to pick up changes.

## Usage

### Chat

1. Click the **Thirdwave** icon in the activity bar (left sidebar)
2. The **Chat** panel opens — type your message and press Enter
3. Assistant responses include:
   - **Reasoning blocks** (collapsible) for chain-of-thought
   - **Tool calls** (expandable) showing tool name, arguments, and result
   - **Code blocks** with a **Copy** button
   - **Token usage** (input/output counts)

### Select a Model

- Click the model badge in the status bar, or
- Run `Thirdwave: Select Model` from the command palette (`Ctrl+Shift+P`)
- Or click any model in the **Models** tree view

### Switch Agent Mode

- Click the agent badge in the status bar, or
- Run `Thirdwave: Select Agent` from the command palette

### Browse Skills

- Open the **Skills** tree view in the Thirdwave sidebar
- Skills are organized by category
- Click a skill to view its full content in a panel
- Use the search icon to search skills by keyword

### Commands

| Command | Description |
|---------|-------------|
| `Thirdwave: Open Chat` | Focus the chat panel |
| `Thirdwave: New Session` | Create a new conversation session |
| `Thirdwave: Select Model` | Pick a model from all available providers |
| `Thirdwave: Select Agent` | Switch agent mode |
| `Thirdwave: Search Skills` | Search installed skills by keyword |
| `Thirdwave: Show Model Registry` | View all providers and models |
| `Thirdwave: Show Budget` | View budget/token usage summary |
| `Thirdwave: Show Audit Log` | View recent API audit entries |
| `Thirdwave: Show Security Policies` | View active security policies |

## Architecture

```
vscode-extension/
├── package.json            # Extension manifest (commands, views, config)
├── tsconfig.json           # TypeScript config (CommonJS for VS Code)
├── src/
│   ├── extension.ts        # Entry point — registers all providers & commands
│   ├── chat/
│   │   └── ChatViewProvider.ts   # Webview panel for AI chat
│   ├── providers/
│   │   ├── SessionTreeProvider.ts  # Session tree view
│   │   ├── ModelTreeProvider.ts    # Model/provider tree view
│   │   └── SkillsTreeProvider.ts   # Skills browser tree view
│   └── sdk/
│       └── ThirdwaveClient.ts  # HTTP client for Thirdwave platform API
└── out/                    # Compiled JS output
```

## Packaging (VSIX)

To package the extension for distribution:

```bash
npm install -g @vscode/vsce
cd platform/vscode-extension
vsce package
```

This produces `thirdwave-ai-0.1.0.vsix`. Install it in VS Code:

```bash
code --install-extension thirdwave-ai-0.1.0.vsix
```
