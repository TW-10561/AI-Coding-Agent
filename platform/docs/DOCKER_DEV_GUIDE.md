# Thirdwave AI — Docker Development Guide

This guide explains how to set up, run, and develop the Thirdwave AI Coding Platform using Docker so any team member can get started quickly.

---

## Table of Contents

1. [Docker Concepts (Quick Primer)](#docker-concepts)
2. [Project Architecture](#project-architecture)
3. [Prerequisites](#prerequisites)
4. [Quick Start](#quick-start)
5. [Environment Configuration](#environment-configuration)
6. [Development Workflow](#development-workflow)
7. [VS Code Extension Development](#vscode-extension-development)
8. [Sandbox Execution (Docker-in-Docker)](#sandbox-execution)
9. [Troubleshooting](#troubleshooting)

---

## Docker Concepts

### What is Docker?

Docker packages your application and all its dependencies (runtime, libraries, config files) into a portable **container**. Think of it like a lightweight virtual machine, but much faster — containers share the host OS kernel and start in seconds.

### Key Terms

| Term | What It Is |
|------|-----------|
| **Image** | A read-only blueprint/template. Built from a `Dockerfile`. Like a snapshot of an OS with your app installed. |
| **Container** | A running instance of an image. You can start, stop, and delete containers. Each container is isolated. |
| **Dockerfile** | A text file with build instructions: base OS, install commands, copy files, set environment vars, define startup command. |
| **docker-compose.yml** | Defines multi-container setups. Instead of running `docker run` with 20 flags, you write a YAML file and run `docker compose up`. |
| **Volume** | Persistent storage that survives container restarts. Without volumes, data inside a container is lost when it stops. |
| **Port mapping** | `-p 3100:3100` maps host port 3100 → container port 3100. Your browser/extension connects to the host port. |
| **Build context** | The directory Docker sends to the build engine. Files in `.dockerignore` are excluded to speed up builds. |

### How It Works for Thirdwave

```
┌─────────────────────────────────────────────────────────────┐
│  Your Machine (Host)                                        │
│                                                             │
│  ┌──────────────────────┐    ┌──────────────────────────┐   │
│  │  VS Code +            │    │  Docker Container         │   │
│  │  Thirdwave Extension  │───▶│  (thirdwave-dev)          │   │
│  │                       │    │                           │   │
│  │  Connects to          │    │  ┌─────────────────────┐  │   │
│  │  localhost:3100       │    │  │ Platform Server     │  │   │
│  │                       │    │  │ (Hono, port 3100)   │  │   │
│  └──────────────────────┘    │  └────────┬────────────┘  │   │
│                               │           │               │   │
│                               │  ┌────────▼────────────┐  │   │
│                               │  │ OpenCode Engine     │  │   │
│                               │  │ (port 4096)         │  │   │
│                               │  └────────┬────────────┘  │   │
│                               │           │               │   │
│                               └───────────┼───────────────┘   │
│                                           │                   │
│                      ┌────────────────────▼────────────┐      │
│                      │  GPU Inference Gateway           │      │
│                      │  (APISIX @ 172.30.140.63:9080)  │      │
│                      │  Models: MiniMax, Qwen, etc.     │      │
│                      └─────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

The VS Code extension runs on your machine and talks to the platform server over HTTP. The platform server can run locally (with `bun`) OR inside Docker. The gateway is a shared GPU inference cluster.

---

## Project Architecture

```
AI-Coding-Agent/
├── platform/                 # Backend platform (Hono + Bun)
│   ├── src/
│   │   ├── server/           # HTTP routes (/api/chat, /health, /registry)
│   │   ├── services/         # Provider registry, chat service
│   │   ├── config/           # Environment config
│   │   └── types/            # TypeScript types
│   ├── HITL/                 # Human-in-the-Loop safety guards
│   ├── scripts/              # Startup scripts
│   ├── skills/               # Skill manifests + installed skills
│   ├── tui/                  # Terminal UI client
│   ├── util/                 # Logging utilities
│   └── vscode-extension/     # VS Code extension (sidebar UI)
│       ├── src/              # Extension TypeScript source
│       └── media/            # Webview assets (chat.js, chat.css)
├── Dockerfile.dev            # Development Docker image
├── docker-compose.dev.yml    # Development compose config
└── platform/docker/          # Production Docker configs
    ├── Dockerfile
    └── docker-compose.yml
```

---

## Prerequisites

1. **Docker Desktop** (Mac/Windows) or **Docker Engine** (Linux)
   ```bash
   # Linux (Ubuntu/Debian):
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   # Log out and back in for group to take effect

   # Verify:
   docker --version
   docker compose version
   ```

2. **VS Code** with the Thirdwave AI extension installed (for UI development)

3. **Access to the GPU gateway** (ask the infra team for the gateway URL and API key)

---

## Quick Start

### 1. Clone the repo

```bash
git clone <repo-url> AI-Coding-Agent
cd AI-Coding-Agent
```

### 2. Create your environment file

```bash
cp platform/.env .env.dev
```

Edit `.env.dev` with your gateway credentials:

```env
# Required: GPU inference gateway
VLLM_GATEWAY_URL=http://172.30.140.63:9080/v1
VLLM_GATEWAY_KEY=your-gateway-key-here

# Optional: Cloud provider keys
# OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Build and start

```bash
# Build the image and start the container
docker compose -f docker-compose.dev.yml up --build

# Or run in background (detached mode):
docker compose -f docker-compose.dev.yml up --build -d
```

### 4. Verify it's running

```bash
# Check health endpoint
curl http://localhost:3100/health/ready

# Check available models
curl http://localhost:3100/api/registry
```

### 5. Connect VS Code extension

In VS Code, open the Thirdwave AI sidebar. The extension connects to `http://localhost:3100` by default. If you changed the port, update the extension settings:

VS Code Settings → `thirdwave.serverUrl` → `http://localhost:<your-port>`

---

## Environment Configuration

### Required Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Platform server port | `3100` |
| `VLLM_GATEWAY_URL` | GPU inference gateway URL | `http://172.30.140.63:9080/v1` |
| `VLLM_GATEWAY_KEY` | Gateway API key | *(ask infra team)* |

### Optional Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Log verbosity: `debug`, `info`, `warn`, `error` | `debug` |
| `OPENAI_API_KEY` | OpenAI key for cloud models | *(empty)* |
| `ANTHROPIC_API_KEY` | Anthropic key for Claude models | *(empty)* |
| `GROQ_API_KEY` | Groq key for fast inference | *(empty)* |

Env vars can be set in a `.env.dev` file and referenced by docker-compose, or passed inline:

```bash
VLLM_GATEWAY_KEY=my-key docker compose -f docker-compose.dev.yml up
```

---

## Development Workflow

### Rebuilding after code changes

The platform source is mounted as a read-only volume, so changes to `platform/src/`, `platform/scripts/`, `platform/HITL/`, and `platform/util/` are reflected immediately inside the container. Restart the container to pick them up:

```bash
# Restart without rebuilding the image (fast — uses volume mounts)
docker compose -f docker-compose.dev.yml restart

# Full rebuild (needed if you change package.json or Dockerfile)
docker compose -f docker-compose.dev.yml up --build
```

### Viewing logs

```bash
# Follow live logs
docker compose -f docker-compose.dev.yml logs -f

# View logs from the last 100 lines
docker compose -f docker-compose.dev.yml logs --tail 100

# Filter by service
docker compose -f docker-compose.dev.yml logs -f platform
```

### Entering the container (debugging)

```bash
# Open a shell inside the running container
docker exec -it thirdwave-dev sh

# Run a one-off command
docker exec thirdwave-dev curl http://localhost:3100/health/ready
```

### Stopping

```bash
# Stop and remove containers (keeps volumes/data)
docker compose -f docker-compose.dev.yml down

# Stop and remove everything including volumes
docker compose -f docker-compose.dev.yml down -v
```

### Running tests

```bash
# Run tests inside the container
docker exec thirdwave-dev bun test

# Run a specific test file
docker exec thirdwave-dev bun test tests/integration.test.ts
```

---

## VS Code Extension Development

The VS Code extension runs locally on your machine (not inside Docker). It communicates with the platform server via HTTP.

### Building the extension

```bash
cd platform/vscode-extension
npm install     # or: bun install
npm run compile # or: npx tsc -p tsconfig.json
```

### Testing changes

1. Open `platform/vscode-extension/` in VS Code
2. Press **F5** to launch the Extension Development Host
3. The extension sidebar will appear in the new VS Code window
4. The extension connects to `http://localhost:3100` (the Docker container)

### Key files

| File | Purpose |
|------|---------|
| `src/chat/ChatViewProvider.ts` | Main extension logic — handles messages, API calls, streaming |
| `media/chat.js` | Webview UI script — renders chat, settings, model list |
| `media/chat.css` | Webview styles |
| `src/extension.ts` | Extension activation, command registration |

---

## Sandbox Execution

The platform includes a sandbox system for running user code safely. It uses Docker containers to isolate command execution:

### How it works

The `SandboxRunner` (in `platform/HITL/sandboxRunner.ts`) has two modes:

- **Host mode**: Commands run directly on the host OS (default for development)
- **Sandbox mode**: Commands run inside isolated Docker containers with:
  - No network access (`--network=none`)
  - Limited memory (512MB)
  - Limited CPU (1 core)
  - Read-only workspace mount

### Testing the sandbox

```bash
# Check if Docker is available for sandbox
docker exec thirdwave-dev docker --version

# The platform auto-detects Docker availability.
# If Docker is available inside the container, sandbox mode is enabled.
# For Docker-in-Docker, mount the Docker socket:
#   volumes:
#     - /var/run/docker.sock:/var/run/docker.sock
```

To test sandbox execution programmatically:

```typescript
import { DockerRunner } from "./HITL/sandboxRunner"

// Check availability
const available = await DockerRunner.isAvailable()
console.log("Docker sandbox available:", available)

// Run a sandboxed command
if (available) {
  const runner = new DockerRunner()
  const result = await runner.runBash("echo hello && ls /workspace")
  console.log("stdout:", result.stdout)
  console.log("exitCode:", result.exitCode)
  console.log("executedIn:", result.executedIn) // "sandbox"
}
```

> **Note**: For sandbox to work inside the Docker dev container, you need to mount the Docker socket. Add this to `docker-compose.dev.yml` under `volumes`:
> ```yaml
> - /var/run/docker.sock:/var/run/docker.sock
> ```
> This enables Docker-in-Docker for the sandbox runner.

---

## Troubleshooting

### Container won't start

```bash
# Check build logs
docker compose -f docker-compose.dev.yml build --no-cache 2>&1 | tail -50

# Check container status
docker ps -a | grep thirdwave

# View crash logs
docker logs thirdwave-dev
```

### Port already in use

```bash
# Find what's using port 3100
lsof -i :3100

# Use a different port
PORT=3200 docker compose -f docker-compose.dev.yml up
```

### Gateway connection issues (502/503 errors)

The platform server needs network access to the GPU gateway. Common fixes:

```bash
# Test gateway connectivity from inside container
docker exec thirdwave-dev curl -s -o /dev/null -w "%{http_code}" \
  http://172.30.140.63:9080/v1/models \
  -H "Authorization: Bearer $VLLM_GATEWAY_KEY"

# If gateway is on the host network (Linux only):
# Add to docker-compose.dev.yml:
#   network_mode: host
```

### Extension can't connect to platform

1. Verify the platform is running: `curl http://localhost:3100/health/ready`
2. Check VS Code settings: `thirdwave.serverUrl` should be `http://localhost:3100`
3. If using a non-default port, update both the compose file and VS Code settings

### Module not found errors

```bash
# Rebuild with fresh dependencies
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up --build
```

---

## Common Docker Commands Cheat Sheet

```bash
# Build image
docker compose -f docker-compose.dev.yml build

# Start/stop
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml down

# Logs
docker compose -f docker-compose.dev.yml logs -f

# Shell access
docker exec -it thirdwave-dev sh

# Cleanup (removes all stopped containers and unused images)
docker system prune -f

# Check disk usage
docker system df
```
