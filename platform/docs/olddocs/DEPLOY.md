# How to Deploy Thirdwave

This guide is for someone who has never deployed anything before.
Follow each step in order. Copy-paste the commands exactly.

---

## What You Need Before Starting

You need **3 things** already working on your machine:

1. **Bun** — the program that runs Thirdwave (already installed at `~/.bun/bin/bun`)
2. **A GPU server running vLLM** — the AI brain that Thirdwave talks to
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

This is where all of Thirdwave lives.

---

## STEP 2: Install packages

Thirdwave needs some packages to work. Install them:
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
- `PORT=3100` → Thirdwave runs on port 3100. You access it at `http://your-ip:3100`
- `VLLM_BASE_URL` → Where the AI model is running (the GPU server)
- `OPENCODE_DIR` → Where your code project lives

If you need to change anything: `nano platform/.env` (then Ctrl+X to save)

---

## STEP 4: Start Thirdwave

You have **3 ways** to start it. Pick one:

### Way 1: Interactive Mode (easiest — start here)

This opens a chat in your terminal where you can type to the AI:
```bash
~/.bun/bin/bun run platform/scripts/launch.ts
```

You'll see:
```
  ╔══════════════════════════════════════════╗
  ║   ◆  T H I R D W A V E                       ║
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
THIRDWAVE_URL=http://localhost:3100 ~/.bun/bin/bun run start
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
# Health check (should return {"platform":"ok","opencode":"ok","uptime":...})
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

If you want Thirdwave to **start automatically when the machine boots**, and run in the background forever:

**Important: You must be in the project root folder first** (Step 1).
Or use the absolute path so it works from anywhere:

```bash
cd /home/nvidia/AI_Coding_Agent/Kadavuley/AI-Coding-Agent
sudo bash platform/deploy/deploy.sh
```

This does 3 things:
1. Sets up **nginx** (so you can access Thirdwave on port 80 instead of 3100)
2. Creates a **systemd service** (Thirdwave starts on boot, restarts if it crashes)
3. Starts the service immediately

After this:
- `http://172.30.140.142` → Thirdwave dashboard (no need for `:3100`)
- Thirdwave survives reboots

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
The start scripts (`start-all.ts`, `launch.ts`) automatically evict stale processes from the required ports before starting. The systemd service also runs a port cleanup as a pre-start step.

If you still see a port conflict:
```bash
# See what's on the port
lsof -i :3100

# Kill it manually
kill -9 <PID>

# Or use a different port
PORT=3200 ~/.bun/bin/bun run platform/scripts/launch.ts

# Or set a port offset for your user (e.g. user 2 → port 3110)
THIRDWAVE_PORT_OFFSET=10 ~/.bun/bin/bun run platform/scripts/launch.ts
```
For multi-user machines each user should set a unique `THIRDWAVE_PORT_OFFSET` so ports never collide.

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
THIRDWAVE_URL=http://localhost:3100 ~/.bun/bin/bun run platform/tui/src/main.ts
```

### Dashboard shows but no models appear
Check that `VLLM_BASE_URL` in `platform/.env` points to a running vLLM server.

---

## Quick Command Cheat Sheet

| I want to... | Run this |
|---------------|---------|
| Start everything (chat mode) | `bun run platform/scripts/launch.ts` |
| Start server only (background) | `bun run platform/scripts/start-all.ts` |
| Start TUI only (connect to running server) | `cd platform/tui && THIRDWAVE_URL=http://localhost:3100 bun run start` |
| Open dashboard | Go to `http://172.30.140.142:3100` in browser |
| Check health | `curl http://localhost:3100/health` |
| Send a chat message | `curl -X POST http://localhost:3100/api/chat -H "Content-Type: application/json" -d '{"message":"hello"}'` |
| Install as background service | `cd /home/nvidia/AI_Coding_Agent/Kadavuley/AI-Coding-Agent && sudo bash platform/deploy/deploy.sh` |
| Stop the service | `cd /home/nvidia/AI_Coding_Agent/Kadavuley/AI-Coding-Agent && sudo bash platform/deploy/deploy.sh --stop` |

(`bun` = `~/.bun/bin/bun` — use the full path if `bun` is not in your PATH)

---

## How Users Use Thirdwave (After Deployment)

Once Thirdwave is deployed, your users do NOT need the project folder or the server IP.
They install a lightweight CLI and use it from anywhere on the network.

---

### Install the Thirdwave CLI (recommended — one command)

Run this on any machine that can reach the server:
```bash
curl -fsSL http://172.30.140.142/api/install | bash
```

This downloads the `thirdwave` command to `~/.local/bin/` and sets up your shell.
After install, **open a new terminal** (or `source ~/.bashrc`) and you're ready.

**What gets installed:**
- `~/.local/bin/art` — a single bash script (~15 KB)
- No project folder, no Node.js, no Bun needed. Just `bash`, `curl`, and `python3`.

---

### Use the CLI

**Ask the AI to write code (auto-saves files):**
```bash
art "Write a Python function that reverses a string"
```
This sends your question, shows the AI's response, and **auto-saves any code as files** in your current directory:
```
  ✓ reverse_string.py
  ✓ reverse_string_2.py
```

**Interactive chat mode:**
```bash
art chat
```
Type questions, get answers. Code is saved after each response.
Commands: `/models` `/health` `/save` `/nosave` `/clear` `/quit`

**Other commands:**
```bash
art health                          # check server status
art models                          # list all AI models
art --model gpt-oss-120b "question" # use a specific model
art --no-save "explain X"           # don't auto-save code files
```

**Disable auto-save globally:**
```bash
export THIRDWAVE_SAVE=false
art "explain Docker"    # response shown, no files saved
```

---

### Manual install (if curl-pipe-bash doesn't work)

```bash
# Download the CLI script
curl -o ~/.local/bin/art http://172.30.140.142/api/client
chmod +x ~/.local/bin/art

# Make sure ~/.local/bin is in your PATH
export PATH="$HOME/.local/bin:$PATH"

# Test it
art health
```

---

### Use directly from code (no CLI needed)

#### Python
```python
import requests

response = requests.post("http://172.30.140.142/api/chat", json={
    "message": "Write a function to sort a list in Python"
})
print(response.json()["text"])
```

#### JavaScript / Node
```javascript
const res = await fetch("http://172.30.140.142/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "Explain async/await" })
});
const data = await res.json();
console.log(data.text);
```

#### curl (raw API)
```bash
curl -X POST http://172.30.140.142/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is a Docker container? Explain simply."}'
```

---

### Use from a browser

Open **http://172.30.140.142** → Thirdwave dashboard.

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
| `/api/queue` | POST | Queue a background task | `curl -X POST http://172.30.140.142/api/queue -H "Content-Type: application/json" -d '{"prompt":"..."}'` |
| `/api/queue` | GET | List queued/running tasks | `curl http://172.30.140.142/api/queue` |
| `/api/queue/:id` | GET | Get a specific task | `curl http://172.30.140.142/api/queue/<id>` |
| `/api/queue/:id/abort` | POST | Abort a running task | `curl -X POST http://172.30.140.142/api/queue/<id>/abort` |
| `/api/queue/metrics` | GET | Queue stats | `curl http://172.30.140.142/api/queue/metrics` |
| `/api/tasks` | GET | List all tasks | `curl http://172.30.140.142/api/tasks` |
| `/api/skills` | GET | List AI skills | `curl http://172.30.140.142/api/skills` |
| `/api/skills/match` | POST | Find skill for a question | `curl -X POST http://172.30.140.142/api/skills/match -H "Content-Type: application/json" -d '{"query":"how to write tests"}'` |

