# How to Deploy Artemis

This guide is for someone who has never deployed anything before.
Follow each step in order. Copy-paste the commands exactly.

---

## What You Need Before Starting

You need **3 things** already working on your machine:

1. **Bun** — the program that runs Artemis (already installed at `~/.bun/bin/bun`)
2. **A GPU server running vLLM** — the AI brain that Artemis talks to
3. **Terminal access** — you need to be able to open a terminal and type commands

To check if you have Bun:
```bash
~/.bun/bin/bun --version
```
If you see a version number like `1.3.x`, you're good.

To check if vLLM is running:
```bash
curl http://172.30.140.91:8000/v1/models
```
If you see JSON with model names, vLLM is running.

---

## STEP 1: Go to the project folder

Open a terminal and type:
```bash
cd /home/nvidia/AI_Coding_Agent/Kadavuley/AI-Coding-Agent
```

This is where all of Artemis lives.

---

## STEP 2: Install packages

Artemis needs some packages to work. Install them:
```bash
cd platform
~/.bun/bin/bun install
```

Then install TUI (the terminal interface) packages:
```bash
cd tui
~/.bun/bin/bun install
cd ..
```

You should see "installed" messages. No errors = good.

Now go back to the project root:
```bash
cd /home/nvidia/AI_Coding_Agent/Kadavuley/AI-Coding-Agent
```

---

## STEP 3: Check the config file

The config is already set up. But let's make sure it looks right:
```bash
cat platform/.env
```

You should see something like:
```
PORT=3100
VLLM_BASE_URL=http://172.30.140.91:8000/v1
OPENCODE_DIR=/home/nvidia/AI_Coding_Agent/Kadavuley/AI-Coding-Agent
```

**What these mean:**
- `PORT=3100` → Artemis runs on port 3100. You access it at `http://your-ip:3100`
- `VLLM_BASE_URL` → Where the AI model is running (the GPU server)
- `OPENCODE_DIR` → Where your code project lives

If you need to change anything: `nano platform/.env` (then Ctrl+X to save)

---

## STEP 4: Start Artemis

You have **3 ways** to start it. Pick one:

### Way 1: Interactive Mode (easiest — start here)

This opens a chat in your terminal where you can type to the AI:
```bash
~/.bun/bin/bun run platform/scripts/launch.ts
```

You'll see:
```
  ╔══════════════════════════════════════════╗
  ║   ◆  A R T E M I S                       ║
  ║   AI Coding Platform — Local & Private   ║
  ╚══════════════════════════════════════════╝
```

Then a prompt appears. Type any question and press Enter.
Type `/help` to see all commands. Type `/quit` to exit.

### Way 2: Server Only (no chat UI — for running in background)

This just starts the backend server. Good for leaving it running:
```bash
~/.bun/bin/bun run platform/scripts/start-all.ts
```

The server keeps running in the terminal. Press Ctrl+C to stop it.

To connect to it from another terminal:
```bash
cd /home/nvidia/AI_Coding_Agent/Kadavuley/AI-Coding-Agent/platform/tui
ARTEMIS_URL=http://localhost:3100 ~/.bun/bin/bun run start
```

### Way 3: Just the API Server (minimal — no OpenCode engine)

If you only want the chat API:
```bash
~/.bun/bin/bun run platform/src/server/index.ts
```

This gives you the REST API and dashboard, but no OpenCode sessions.

---

## STEP 5: Check that it's working

### In the browser:
Open this URL: **http://172.30.140.142:3100**

You should see a dark dashboard page showing:
- ✅ Platform: Running on :3100
- ✅ OpenCode Engine: Connected (or Unreachable — that's OK)
- ✅ LLM Provider: Shows your vLLM models

### From the command line:
```bash
# Health check (should return {"ok": true})
curl http://localhost:3100/health

# Send a test message (should return AI response)
curl -X POST http://localhost:3100/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Say hello in one sentence"}'

# See available models
curl http://localhost:3100/api/registry
```

---

## STEP 6 (Optional): Run as a system service

If you want Artemis to **start automatically when the machine boots**, and run in the background forever:

**Important: You must be in the project root folder first** (Step 1).
Or use the absolute path so it works from anywhere:

```bash
cd /home/nvidia/AI_Coding_Agent/Kadavuley/AI-Coding-Agent
sudo bash platform/deploy/deploy.sh
```

This does 3 things:
1. Sets up **nginx** (so you can access Artemis on port 80 instead of 3100)
2. Creates a **systemd service** (Artemis starts on boot, restarts if it crashes)
3. Starts the service immediately

After this:
- `http://172.30.140.142` → Artemis dashboard (no need for `:3100`)
- Artemis survives reboots

### Managing the service:
```bash
cd /home/nvidia/AI_Coding_Agent/Kadavuley/AI-Coding-Agent

# See if it's running
sudo bash platform/deploy/deploy.sh --status

# Stop it
sudo bash platform/deploy/deploy.sh --stop

# Start it again
sudo bash platform/deploy/deploy.sh --full

# Remove everything (undo step 6)
sudo bash platform/deploy/deploy.sh --uninstall
```

---

## Common Problems

### "No online vLLM provider found"
The AI model server is not reachable. Check:
```bash
curl http://172.30.140.91:8000/v1/models
```
If that fails, vLLM is down. Start it on the GPU node.

### "Port 3100 already in use"
Artemis now has **AUTO_PORT=true** by default, so it finds a free port automatically.
If you still see this error, you can:
```bash
# Kill whatever is on port 3100
fuser -k 3100/tcp

# Or use a different port manually
PORT=3200 ~/.bun/bin/bun run platform/scripts/launch.ts

# Or set a port offset for your user (e.g. user 2 uses offset 10 → port 3110)
ARTEMIS_PORT_OFFSET=10 ~/.bun/bin/bun run platform/scripts/launch.ts
```
With AUTO_PORT on, each user can just run `launch.ts` and it'll pick the next free port.

### "Module not found" or "Cannot find package"
You forgot to install packages. Run:
```bash
cd /home/nvidia/AI_Coding_Agent/Kadavuley/AI-Coding-Agent/platform
~/.bun/bin/bun install
cd tui && ~/.bun/bin/bun install
```

### TUI can't connect to server
Make sure the server is running first, then set the URL:
```bash
ARTEMIS_URL=http://localhost:3100 ~/.bun/bin/bun run platform/tui/src/main.ts
```

### Dashboard shows but no models appear
Check that `VLLM_BASE_URL` in `platform/.env` points to a running vLLM server.

---

## Quick Command Cheat Sheet

| I want to... | Run this |
|---------------|---------|
| Start everything (chat mode) | `bun run platform/scripts/launch.ts` |
| Start server only (background) | `bun run platform/scripts/start-all.ts` |
| Start TUI only (connect to running server) | `cd platform/tui && ARTEMIS_URL=http://localhost:3100 bun run start` |
| Open dashboard | Go to `http://172.30.140.142:3100` in browser |
| Check health | `curl http://localhost:3100/health` |
| Send a chat message | `curl -X POST http://localhost:3100/api/chat -H "Content-Type: application/json" -d '{"message":"hello"}'` |
| Install as background service | `cd /home/nvidia/AI_Coding_Agent/Kadavuley/AI-Coding-Agent && sudo bash platform/deploy/deploy.sh` |
| Stop the service | `cd /home/nvidia/AI_Coding_Agent/Kadavuley/AI-Coding-Agent && sudo bash platform/deploy/deploy.sh --stop` |

(`bun` = `~/.bun/bin/bun` — use the full path if `bun` is not in your PATH)

---

## How Users Use Artemis (After Deployment)

Once Artemis is deployed, your users do NOT need the project folder. They just need the server IP.

The server is already running as a background service at: **http://172.30.140.142**

---

### Talk to the AI (curl examples — copy-paste these)

**Ask a simple question:**
```bash
curl -X POST http://172.30.140.142/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is a Docker container? Explain simply."}'
```

**Ask it to write code:**
```bash
curl -X POST http://172.30.140.142/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Write a Python function that reverses a string"}'
```

**Ask with a specific model:**
```bash
curl -X POST http://172.30.140.142/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Explain recursion", "modelID": "plezan/MiniMax-M2.1-REAP-50-W4A16"}'
```

**What you get back (example):**
```json
{
  "text": "A Docker container is like a lightweight box...",
  "model": "MiniMax M2.1 REAP 50 W4A16",
  "provider": "Local vLLM — 172.30.140.91:8000",
  "tokens": { "input": 1818, "output": 122 },
  "latencyMs": 2104
}
```
The `text` field is the AI's answer.

---

### Use from a browser

Open **http://172.30.140.142** in any browser → you see the Artemis dashboard.

---

### Use from Python

```python
import requests

response = requests.post("http://172.30.140.142/api/chat", json={
    "message": "Write a function to sort a list in Python"
})
print(response.json()["text"])
```

---

### Use from JavaScript/Node

```javascript
const res = await fetch("http://172.30.140.142/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "Explain async/await" })
});
const data = await res.json();
console.log(data.text);
```

---

### Check what models are available

```bash
curl http://172.30.140.142/api/registry
```

### Check if the server is up

```bash
curl http://172.30.140.142/health
```
Should return: `{"platform":"ok","opencode":"ok"}`

---

### For admins only: Terminal chat (TUI)

This is for **admins who have access to the server machine**, not end users:
```bash
cd /home/nvidia/AI_Coding_Agent/Kadavuley/AI-Coding-Agent
~/.bun/bin/bun run platform/scripts/launch.ts
```
Commands inside TUI:
- `/help` — see all commands
- `/models` — see available AI models
- `/model <name>` — switch model
- `/clear` — clear history
- `/quit` — exit

---

### API Endpoints Reference

| Endpoint | Method | What it does | Example |
|----------|--------|-------------|---------|
| `/health` | GET | Check server status | `curl http://172.30.140.142/health` |
| `/api/chat` | POST | Send message, get AI response | See examples above |
| `/api/chat/direct` | POST | Fast response (no tool loop) | Same as `/api/chat` |
| `/api/chat/tools` | GET | List available AI tools | `curl http://172.30.140.142/api/chat/tools` |
| `/api/registry` | GET | List AI models & status | `curl http://172.30.140.142/api/registry` |
| `/api/budget/check` | GET | Check token budget | `curl http://172.30.140.142/api/budget/check` |
| `/api/budget/summary` | GET | Budget usage stats | `curl http://172.30.140.142/api/budget/summary` |
| `/api/queue/enqueue` | POST | Queue a background task | `curl -X POST http://172.30.140.142/api/queue/enqueue -H "Content-Type: application/json" -d '{"prompt":"...", "userID":"user1"}'` |
| `/api/queue/metrics` | GET | Queue stats | `curl http://172.30.140.142/api/queue/metrics` |
| `/api/tasks` | GET | List all tasks | `curl http://172.30.140.142/api/tasks` |
| `/api/skills` | GET | List AI skills | `curl http://172.30.140.142/api/skills` |
| `/api/skills/match` | POST | Find skill for a question | `curl -X POST http://172.30.140.142/api/skills/match -H "Content-Type: application/json" -d '{"query":"how to write tests"}'` |

