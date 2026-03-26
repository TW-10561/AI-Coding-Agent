# Thirdwave AI — Beginner Testing Guide

> **Who this is for:** Developers building or evaluating the Thirdwave extension who want to test it hands-on — no prior experience with OpenCode or the platform internals required.

---

## Table of Contents

1. [How Thirdwave creates files — where do they go?](#1-how-thirdwave-creates-files)
2. [Starting the platform and pointing it at a local repo](#2-starting--pointing-at-a-repo)
3. [Testing workspace reading](#3-testing-workspace-reading)
4. [Testing file handling (create, edit, delete)](#4-testing-file-handling)
5. [Checking tool calls in the logs](#5-checking-tool-calls)
6. [Understanding and testing HITL from the user side](#6-hitl-from-the-user-side)
7. [Log file reference](#7-log-file-reference)
8. [Quick test checklist](#8-quick-test-checklist)

---

## 1. How Thirdwave Creates Files

When the agent generates or modifies a file, the output goes to the **workspace directory** — the folder you pointed OpenCode at. There is no hidden scratch space.

```
Project repo you give to the agent
  └── src/
  │     └── (files agent edits or creates land here)
  └── .thirdwave/              ← created automatically
        ├── logs/
        │     ├── tool-calls.jsonl   ← every tool call the agent makes
        │     └── file-ops.jsonl     ← every file operation
        └── .opencode/
              └── audit/
                    └── audit.log.jsonl   ← tamper-evident HITL audit trail
```

The platform also keeps a SQLite audit database at:
```
<platform-dir>/data/audit.db
```

**Rule of thumb:** If you ask the agent to create a file, check the repo root first. If it made an intermediate temp file, it will be somewhere inside the same workspace tree.

---

## 2. Starting & Pointing at a Repo

### Prerequisites
```bash
# Check that bun and opencode are installed
bun --version
opencode --version
```

### Clone or pick a test repo

```bash
# Option A — use the project itself as a test target
cd /home/nvidia/AI_Coding_Agent/Kadavuley/AI-Coding-Agent

# Option B — clone a small public repo
git clone https://github.com/sindresorhus/is.git /tmp/test-repo
cd /tmp/test-repo
```

### Start the platform pointed at that repo

The `OPENCODE_DIR` environment variable tells the platform which folder the agent should treat as the workspace root.

```bash
# From the platform directory
cd /home/nvidia/AI_Coding_Agent/Kadavuley/AI-Coding-Agent/platform

# Start with a specific workspace dir
OPENCODE_DIR=/tmp/test-repo bun run scripts/launch.ts

# Or headless (no TUI, good for automated testing)
OPENCODE_DIR=/tmp/test-repo bun run scripts/start-all.ts --headless
```

You should see:
```
[platform] Listening on http://0.0.0.0:3100
[opencode]  Listening on http://127.0.0.1:4096
```

### Connect the VS Code extension

1. Open VS Code settings (`Ctrl+,`).
2. Search for `thirdwave`.
3. Set **Platform URL** → `http://localhost:3100`.
4. Set **API Key** → value of `PLATFORM_API_KEY` in your `.env` (or leave blank if not set).
5. Click the Thirdwave icon in the sidebar — the status bar should show the active model.

---

## 3. Testing Workspace Reading

Open the Thirdwave sidebar chat and try each of these prompts in order. Each one exercises a different part of file reading.

### 3.1 — Basic file listing

**Prompt:**
```
List all files in this workspace.
```

**What to expect:**
- Agent calls the `list` or `bash: ls -R` tool.
- Response shows a directory tree.
- Check `.thirdwave/logs/tool-calls.jsonl` — you should see entries with `"toolName": "bash"` or `"toolName": "list"`.

### 3.2 — Read a specific file

**Prompt:**
```
Read the contents of README.md and summarize it in 3 bullet points.
```

**What to expect:**
- Agent reads `README.md`.
- `.thirdwave/logs/file-ops.jsonl` gains a new `"operation": "read"` entry.

### 3.3 — Understand project structure

**Prompt:**
```
Explain the architecture of this project based on the source files.
```

**What to expect:**
- Agent reads several files across the repo.
- Multiple `file-ops.jsonl` entries with `"operation": "read"`.
- Response includes references to actual code.

### 3.4 — Test with a real GitHub repo (read-only)

```bash
git clone https://github.com/tiangolo/fastapi.git /tmp/fastapi-test
OPENCODE_DIR=/tmp/fastapi-test bun run scripts/start-all.ts --headless
```

**Prompt:**
```
What HTTP framework does this project use? Show me the main entry point.
```

**What to verify:**
- Agent correctly identifies FastAPI patterns.
- No files outside `/tmp/fastapi-test/` appear in `file-ops.jsonl`.

---

## 4. Testing File Handling

> **Safety tip:** Use `/tmp/` or a throwaway repo for destructive tests so your real work is not touched.

### 4.1 — File Creation

**Prompt:**
```
Create a new file called hello_world.py that prints "Hello from Thirdwave!" and run it.
```

**What to expect:**
1. `hello_world.py` appears in the workspace root.
2. `tool-calls.jsonl` shows `"toolName": "edit"` or `"toolName": "bash"`.
3. `file-ops.jsonl` shows `"operation": "create"` with `"path": ".../hello_world.py"`.
4. The bash output shows `Hello from Thirdwave!`.

### 4.2 — File Editing

**Prompt (after 4.1):**
```
Modify hello_world.py to also print the current date and time.
```

**What to expect:**
- `file-ops.jsonl` shows `"operation": "write"` for `hello_world.py`.
- The file content on disk is updated.

### 4.3 — File Deletion (triggers HITL)

**Prompt:**
```
Delete hello_world.py.
```

**What to expect:**
- The risk engine scores delete operations (`+40` risk points).
- Depending on your autonomy mode you may see a VS Code notification asking for approval.
- After approval, `file-ops.jsonl` shows `"operation": "delete"`.

### 4.4 — Listing and stat

**Prompt:**
```
How many Python files are in this project and what is the largest one?
```

**What to expect:**
- `file-ops.jsonl` shows several `"operation": "list"` and `"operation": "stat"` entries.

### 4.5 — Verify nothing escaped the workspace

```bash
# After any test, confirm the agent only touched workspace files
grep '"path"' .thirdwave/logs/file-ops.jsonl | grep -v "$(pwd)"
# This should return no lines if the sandbox is correct
```

---

## 5. Checking Tool Calls

### 5.1 — Live tail (recommended)

Open a second terminal before sending any prompts:
```bash
cd /tmp/test-repo   # or wherever your workspace is
tail -f .thirdwave/logs/tool-calls.jsonl | python3 -m json.tool --no-ensure-ascii 2>/dev/null || \
tail -f .thirdwave/logs/tool-calls.jsonl
```

Each tool call appears as one line of JSON immediately when the agent invokes it:
```json
{
  "id": "tc_m5k2_001a",
  "timestamp": "2026-03-23T10:41:05.123Z",
  "sessionId": "session-abc123",
  "toolName": "bash",
  "toolInput": { "command": "ls -la" },
  "toolOutput": "total 48\n-rw-r--r-- 1 ...",
  "durationMs": 87,
  "hitlApproved": true,
  "riskScore": 5
}
```

### 5.2 — Pretty-print last N tool calls

```bash
tail -n 20 .thirdwave/logs/tool-calls.jsonl | while IFS= read -r line; do
  echo "$line" | python3 -m json.tool
  echo "---"
done
```

### 5.3 — Filter by tool name

```bash
# Show only bash commands
grep '"toolName":"bash"' .thirdwave/logs/tool-calls.jsonl

# Show only file edits
grep '"toolName":"edit"' .thirdwave/logs/tool-calls.jsonl

# Show calls that were HITL-denied
grep '"hitlApproved":false' .thirdwave/logs/tool-calls.jsonl
```

### 5.4 — Check tool call durations (performance)

```bash
python3 - <<'EOF'
import json, sys
records = []
with open(".thirdwave/logs/tool-calls.jsonl") as f:
    for line in f:
        try: records.append(json.loads(line))
        except: pass
records.sort(key=lambda r: r.get("durationMs", 0), reverse=True)
for r in records[:5]:
    print(f"{r.get('durationMs', '?'):>6}ms  {r['toolName']:<20} {str(r.get('toolInput',''))[:60]}")
EOF
```

### 5.5 — Check the platform HTTP logs

The platform logs every HTTP request. To see what calls the extension is making:
```bash
# Start with debug logging
LOG_LEVEL=debug OPENCODE_DIR=/tmp/test-repo bun run scripts/start-all.ts --headless
```

---

## 6. HITL from the User Side

**HITL = Human-in-the-Loop.** It is the set of rules that decides whether the agent can act autonomously or must ask you first. Here is what happens and how to trigger each guard.

### Architecture recap (simplified)

```
Agent wants to run a command
        ↓
  DestructiveGuard  ← is it rm -rf, DROP TABLE, git push --force, etc.?
        ↓
  SensitiveFiles    ← is it touching .env, SSH keys, certificates?
        ↓
  RiskEngine        ← score 0-100; ≥80 = deny, ≥40 = ask, <40 = allow
        ↓
  LoopGuard         ← has it run this same command 3+ times already?
        ↓
  NetworkGuard      ← is it calling an external URL not on the allowlist?
        ↓
  RBAC              ← does your role allow this action type?
        ↓
  Execute (or block)
```

### 6.1 — Changing the autonomy mode

The autonomy mode controls how aggressively HITL asks for approval.

| Mode | Effect |
|---|---|
| `supervised` | Most cautious — asks frequently, stops early (5 iterations max) |
| `semi_autonomous` | Balanced — default for development |
| `fully_autonomous` | Most permissive — auto-approves low-risk actions |

```bash
# Via HTTP API
curl -X POST http://localhost:3100/api/hitl/mode \
  -H "Content-Type: application/json" \
  -d '{"agentId": "default", "mode": "supervised"}'
```

Or set it in `thirdwave.json` / VS Code settings.

### 6.2 — Triggering the DestructiveGuard

**Prompt (use a throwaway repo!):**
```
Run: rm -rf /tmp/trash-folder
```

**What you will see:**
1. A VS Code notification popup: *"Thirdwave wants to run a potentially destructive command. Approve?"*
2. Buttons: **Allow** / **Deny** / **Always allow for this session**
3. The audit log records the decision:
   ```bash
   tail -1 .thirdwave/.opencode/audit/audit.log.jsonl | python3 -m json.tool
   ```
4. `tool-calls.jsonl` shows `"hitlApproved": false` if you denied.

**Other phrases that trigger it:**
- `git push --force`
- `git reset --hard HEAD~5`
- Any `chmod 777`
- `DROP DATABASE` / `TRUNCATE TABLE`
- `pkill -9`

### 6.3 — Triggering the SensitiveFile guard

**Prompt:**
```
Show me the contents of .env
```
or
```
Read the file id_rsa in the .ssh folder
```

**What you will see:**
- HITL popup: *"Thirdwave wants to access a sensitive file"*
- Even if you approve, the access is logged with `"isSensitive": true` in `file-ops.jsonl`.

### 6.4 — Triggering the LoopGuard

The LoopGuard fires when the same command runs 3+ times in a 1-minute window.

**Prompt:**
```
Run `python3 does_not_exist.py`. If it fails, try again until it works.
```

**What you will see:**
- After 3 identical failures the guard detects a loop (score ≥40).
- HITL popup: *"Agent may be stuck in a loop. Continue?"*
- The loop score appears in `tool-calls.jsonl` as a risk factor.

### 6.5 — Testing the NetworkGuard

Set the network guard to `allowlist` mode first:
```bash
curl -X POST http://localhost:3100/api/hitl/network \
  -H "Content-Type: application/json" \
  -d '{"mode": "allowlist", "allowedDomains": ["api.github.com"]}'
```

**Prompt:**
```
Fetch the content of http://example.com
```

**What you will see:**
- Request blocked by NetworkGuard.
- `tool-calls.jsonl` shows `"hitlApproved": false` and `"error": "Network access denied"`.

### 6.6 — Reading the HITL audit trail

```bash
# View all HITL decisions (pretty-printed)
cat .thirdwave/.opencode/audit/audit.log.jsonl | while IFS= read -r line; do
  echo "$line" | python3 -m json.tool
  echo "---"
done

# Or just the denied actions
grep '"result":"deny"' .thirdwave/.opencode/audit/audit.log.jsonl

# Via the platform API
curl http://localhost:3100/api/audit?limit=20 | python3 -m json.tool
```

### 6.7 — HITL approval in the VS Code extension

When HITL needs your answer:

1. A **notification** appears bottom-right in VS Code.
2. The **Thirdwave sidebar** shows a pending approval badge.
3. Click into the sidebar → **HITL Approvals** panel → you see the full command, risk score, and reasoning.
4. Click **Allow** or **Deny**.
5. Approvals expire after **5 minutes** — after expiry the action is auto-denied.

---

## 7. Log File Reference

| File | Location | Format | What's inside |
|---|---|---|---|
| Tool calls | `<workspace>/.thirdwave/logs/tool-calls.jsonl` | JSONL | Every tool invocation: name, input, output, duration, HITL result |
| File operations | `<workspace>/.thirdwave/logs/file-ops.jsonl` | JSONL | Every file create/read/write/delete with path and success flag |
| HITL audit (HITL module) | `<workspace>/.thirdwave/.opencode/audit/audit.log.jsonl` | JSONL | Tamper-evident chain-hashed HITL events |
| Platform audit (server) | `<platform-dir>/data/audit.db` | SQLite | Full platform audit — queryable via `/api/audit` |
| Console logs | Terminal running the server | Plain text | HTTP requests, errors, status |
| VS Code extension logs | **Output panel → Thirdwave** | Plain text | Extension activation, errors, SDK calls |

### Reading the platform SQLite audit DB directly

```bash
# Requires sqlite3
sqlite3 platform/data/audit.db "SELECT action, resource, result, timestamp FROM audit_log ORDER BY timestamp DESC LIMIT 20;"
```

---

## 8. Quick Test Checklist

Copy this into a text file and tick off each item as you test.

```
WORKSPACE READING
[ ] Agent lists all files in /tmp/test-repo
[ ] Agent reads README.md and summarizes it
[ ] Agent explains architecture from source code
[ ] file-ops.jsonl shows "operation":"read" entries

FILE HANDLING
[ ] Agent creates hello_world.py
[ ] hello_world.py exists on disk
[ ] Agent edits hello_world.py
[ ] file-ops.jsonl shows "operation":"write" entries
[ ] Agent deletes a file and HITL notification appears
[ ] No file paths outside workspace in file-ops.jsonl

TOOL CALLING
[ ] tail -f tool-calls.jsonl shows real-time entries
[ ] tool-calls.jsonl JSON is valid (parseable)
[ ] durationMs values look reasonable (< 30 000ms)
[ ] Error entries appear when commands fail

HITL
[ ] rm -rf triggers destructive guard popup
[ ] .env access triggers sensitive file popup
[ ] Denying a request shows "hitlApproved":false in logs
[ ] Repeated failure triggers loop guard popup
[ ] Audit log has entries after HITL triggers
[ ] Approvals expire after 5 minutes without action
[ ] Changing autonomy mode to "supervised" increases popups
[ ] Changing autonomy mode to "fully_autonomous" reduces popups

EXTENSION UI
[ ] Sidebar shows active model in status bar
[ ] Sessions list is populated
[ ] History persists after refresh
[ ] /explain slash command works in native VS Code chat
```
