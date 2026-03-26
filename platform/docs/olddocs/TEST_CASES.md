# Thirdwave AI Coding Platform — Test Case Scenarios

> **Audience**: QA engineers, developers, integration testers  
> **Version**: 0.1.0  
> **Last Updated**: July 2025

---

## Table of Contents

1. [Health & Connectivity](#1-health--connectivity)
2. [Model Provider Registry](#2-model-provider-registry)
3. [Agentic Chat (Tool-Calling)](#3-agentic-chat-tool-calling)
4. [Direct Chat (No Tools)](#4-direct-chat-no-tools)
5. [Streaming Chat (SSE)](#5-streaming-chat-sse)
6. [Tool Execution](#6-tool-execution)
7. [CLI Client (`art`)](#7-cli-client-art)
8. [CLI File Saving](#8-cli-file-saving)
9. [Install Script](#9-install-script)
10. [Session Management](#10-session-management)
11. [Task Queue (Simple)](#11-task-queue-simple)
12. [Scalable Queue](#12-scalable-queue)
13. [Orchestrations (Multi-Agent)](#13-orchestrations-multi-agent)
14. [Parallel Execution](#14-parallel-execution)
15. [Budget Management](#15-budget-management)
16. [Audit Logging](#16-audit-logging)
17. [Workspace Management](#17-workspace-management)
18. [Skills / Knowledge System](#18-skills--knowledge-system)
19. [Policy Engine / Security](#19-policy-engine--security)
20. [Authentication & Authorization](#20-authentication--authorization)
21. [Rate Limiting](#21-rate-limiting)
22. [nginx Proxy](#22-nginx-proxy)
23. [systemd Service](#23-systemd-service)
24. [Multi-User / Port Offset](#24-multi-user--port-offset)
25. [Error Handling & Edge Cases](#25-error-handling--edge-cases)
26. [Performance & Load](#26-performance--load)

---

## Test Case Format

Each test case follows this structure:

| Field | Description |
|-------|-------------|
| **ID** | Unique identifier (e.g., HC-01) |
| **Title** | Short description |
| **Precondition** | What must be true before testing |
| **Steps** | Numbered steps to execute |
| **Expected Result** | What should happen |
| **Priority** | P0 (critical), P1 (high), P2 (medium), P3 (low) |

---

## 1. Health & Connectivity

### HC-01: Platform Health Check
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | Thirdwave service is running |
| **Steps** | 1. `curl http://localhost:3100/health` |
| **Expected** | `{"platform":"ok","opencode":"ok","uptime":<number>,"version":"0.1.0"}` with HTTP 200 |

### HC-02: Platform Health via nginx
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | nginx is running |
| **Steps** | 1. `curl http://localhost/health` |
| **Expected** | Same response as HC-01, proxied through nginx |

### HC-03: OpenCode Unreachable
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | OpenCode process is stopped |
| **Steps** | 1. Stop OpenCode: `pkill opencode` <br> 2. `curl http://localhost:3100/health` |
| **Expected** | `{"platform":"ok","opencode":"unreachable",...}` — platform still operational |

### HC-04: Landing Page Loads
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Thirdwave running |
| **Steps** | 1. Open `http://<server-ip>/` in browser |
| **Expected** | Thirdwave dashboard HTML with status indicators, model list, and tabbed interface |

---

## 2. Model Provider Registry

### PR-01: List All Providers
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | Thirdwave running, at least one vLLM/Ollama endpoint reachable |
| **Steps** | 1. `curl http://localhost:3100/api/registry` |
| **Expected** | JSON with `local` array (providers with models) and `cloud` array (9 cloud providers). Each local provider has `name`, `endpoint`, `status`, `models[]` |

### PR-02: vLLM Primary Online
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | vLLM at `172.30.140.91:8000` is running |
| **Steps** | 1. `curl http://localhost:3100/api/registry \| jq '.local[0]'` |
| **Expected** | `status: "online"`, `name: "Local vLLM"`, models include `plezan/MiniMax-M2.1-REAP-50-W4A16` with `contextLimit: 30000` |

### PR-03: Ollama Detection
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Ollama gateway at `172.30.140.143:31254` is running |
| **Steps** | 1. `curl http://localhost:3100/api/registry \| jq '.local[] \| select(.name \| contains("Ollama"))'` |
| **Expected** | Provider name contains "Ollama" (not "vLLM"). Status: "online". Models include `Qwen3-8B`, `Qwen2.5-Coder-32B-Instruct-AWQ`, etc. |

### PR-04: Offline Endpoint Fallback
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | An extra vLLM endpoint is unreachable (e.g., `VLM_EXTRA_ENDPOINTS` includes a down server) |
| **Steps** | 1. Set `VLLM_EXTRA_ENDPOINTS=http://172.30.140.143:31254/v1,http://10.0.0.99:8000/v1` <br> 2. `curl http://localhost:3100/api/registry` |
| **Expected** | Reachable endpoint shows `status: "online"` with live models. Unreachable endpoint shows `status: "offline"` with static fallback model list |

### PR-05: Cloud Provider Configured
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Set `OPENAI_API_KEY=sk-test123` in `.env` |
| **Steps** | 1. Restart service <br> 2. `curl http://localhost:3100/api/registry \| jq '.cloud[] \| select(.id=="openai")'` |
| **Expected** | `configured: true`, models list includes GPT-4.1, GPT-4o, etc. |

### PR-06: Cloud Provider Unconfigured
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | No `ANTHROPIC_API_KEY` set |
| **Steps** | 1. `curl http://localhost:3100/api/registry \| jq '.cloud[] \| select(.id=="anthropic")'` |
| **Expected** | `configured: false`, models still listed for UI presentation |

### PR-07: OpenRouter Provider
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Thirdwave running |
| **Steps** | 1. `curl http://localhost:3100/api/registry \| jq '.cloud[] \| select(.id=="openrouter")'` |
| **Expected** | Provider listed with 6 models: Claude Sonnet 4, GPT-4.1, Gemini 2.5 Pro, DeepSeek R1, Qwen3 235B, Llama 4 Maverick |

---

## 3. Agentic Chat (Tool-Calling)

### AC-01: Simple Code Question with Tools
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | At least one local model is online |
| **Steps** | 1. `curl -X POST http://localhost:3100/api/chat -H 'Content-Type: application/json' -d '{"message":"list the files in the current directory"}'` |
| **Expected** | Response includes `text` (file listing description), `toolCalls` array with at least one `list_dir` or `bash` tool call. `tokens`, `latencyMs`, `model`, `provider` fields present. |

### AC-02: File Read + Write Loop
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | Project directory has at least one source file |
| **Steps** | 1. `curl -X POST http://localhost:3100/api/chat -H 'Content-Type: application/json' -d '{"message":"read platform/package.json and tell me the version"}'` |
| **Expected** | `toolCalls` contains `read_file` call with `args.path` containing `package.json`. `text` contains the version number. `success: true` on the tool call. |

### AC-03: Tool Calling Disabled
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | At least one model online |
| **Steps** | 1. `curl -X POST http://localhost:3100/api/chat -H 'Content-Type: application/json' -d '{"message":"what is 2+2","tools":false}'` |
| **Expected** | Response has no `toolCalls` array (or empty). LLM responds directly with text. |

### AC-04: Max Tool Rounds Respected
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Model online |
| **Steps** | 1. Send complex request with `maxToolRounds: 2` that would normally need 5+ rounds |
| **Expected** | Tool loop stops after 2 rounds. Response includes partial result + indication that max rounds reached. |

### AC-05: Model Selection by ID
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Multiple models available |
| **Steps** | 1. `curl -X POST http://localhost:3100/api/chat -d '{"message":"hello","modelID":"Qwen/Qwen3-8B","providerID":"Local Ollama #3"}'` |
| **Expected** | Response `model` field matches `Qwen/Qwen3-8B`. `provider` field references Ollama endpoint. |

### AC-06: Conversation History
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Model online |
| **Steps** | 1. Send: `{"message":"my name is Alice","history":[]}` <br> 2. Send: `{"message":"what is my name?","history":[{"role":"user","content":"my name is Alice"},{"role":"assistant","content":"Hello Alice!"}]}` |
| **Expected** | Second response correctly recalls "Alice" from history |

### AC-07: Custom System Prompt
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Model online |
| **Steps** | 1. `curl -X POST http://localhost:3100/api/chat -d '{"message":"hello","system":"You are a pirate. Always respond in pirate speak."}'` |
| **Expected** | Response text uses pirate language/style |

### AC-08: Temperature Parameter
| | |
|---|---|
| **Priority** | P3 |
| **Precondition** | Model online |
| **Steps** | 1. Send 3 identical requests with `temperature: 0` <br> 2. Send 3 identical requests with `temperature: 2` |
| **Expected** | Low temperature responses are similar/identical. High temperature responses vary significantly. |

---

## 4. Direct Chat (No Tools)

### DC-01: Basic Direct Chat
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | Model online |
| **Steps** | 1. `curl -X POST http://localhost:3100/api/chat/direct -H 'Content-Type: application/json' -d '{"message":"explain what a closure is"}'` |
| **Expected** | JSON response with `text` (explanation), `model`, `provider`, `tokens`, `latencyMs`. No `toolCalls` field. |

### DC-02: Direct Chat Is Faster
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Model online |
| **Steps** | 1. Send same message to `/api/chat` and `/api/chat/direct` <br> 2. Compare `latencyMs` |
| **Expected** | Direct chat latency is lower (no tool overhead) |

---

## 5. Streaming Chat (SSE)

### SC-01: Basic Streaming
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Model online |
| **Steps** | 1. `curl -N -X POST http://localhost:3100/api/chat/stream -H 'Content-Type: application/json' -d '{"message":"count from 1 to 10"}'` |
| **Expected** | SSE events arrive incrementally: `data: {"type":"chunk","content":"1"}`, etc. Final event: `data: {"type":"done",...}` |

### SC-02: Stream Abort
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Model online |
| **Steps** | 1. Start a stream request <br> 2. Close the connection mid-stream |
| **Expected** | Server handles connection close gracefully without error logs |

---

## 6. Tool Execution

### TE-01: bash Tool
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | Agentic chat working |
| **Steps** | 1. `POST /api/chat {"message":"run 'echo hello world' in bash and tell me the output"}` |
| **Expected** | `toolCalls` contains `bash` call with `command: "echo hello world"`. Result: `"hello world\n"`. Success: true. |

### TE-02: read_file Tool
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | Known file exists |
| **Steps** | 1. `POST /api/chat {"message":"read the first 5 lines of package.json"}` |
| **Expected** | `toolCalls` has `read_file` with correct path. Result contains file content. |

### TE-03: write_file Tool
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | Write access to project dir |
| **Steps** | 1. `POST /api/chat {"message":"create a file called test-output.txt with the text 'hello from thirdwave'"}` |
| **Expected** | `toolCalls` has `write_file` with `args.path` = "test-output.txt" and `args.content` = "hello from thirdwave". File exists on server at project root. |

### TE-04: list_dir Tool
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Agentic chat working |
| **Steps** | 1. `POST /api/chat {"message":"list the platform/src/services directory"}` |
| **Expected** | `toolCalls` has `list_dir` or `bash ls`. Response text includes service filenames. |

### TE-05: grep_search Tool
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Agentic chat working |
| **Steps** | 1. `POST /api/chat {"message":"search for 'BudgetManager' in the codebase"}` |
| **Expected** | `toolCalls` has `grep_search` with query "BudgetManager". Results show matching files. |

### TE-06: web_fetch Tool
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Network access allowed |
| **Steps** | 1. `POST /api/chat {"message":"fetch the title of https://example.com"}` |
| **Expected** | `toolCalls` has `web_fetch` with URL. Result contains page content/title. |

### TE-07: bash Timeout
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Agentic chat working |
| **Steps** | 1. `POST /api/chat {"message":"run 'sleep 300' in bash"}` |
| **Expected** | Tool call returns timeout error (max 120s). Loop continues with error result. |

### TE-08: Path Traversal Prevention
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | Agentic chat working |
| **Steps** | 1. `POST /api/chat {"message":"read the file ../../../../etc/passwd"}` |
| **Expected** | `read_file` tool either rejects the path traversal or resolves it safely within project directory. Should NOT return /etc/passwd contents. |

---

## 7. CLI Client (`art`)

### CL-01: Health Command
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | `art` CLI installed, server running |
| **Steps** | 1. `art health` |
| **Expected** | Green output showing platform and OpenCode status |

### CL-02: Models Command
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | CLI installed, server running |
| **Steps** | 1. `art models` |
| **Expected** | Table showing local providers (vLLM, Ollama) with models, status indicators, and cloud provider list |

### CL-03: Chat Command
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | CLI installed, model online |
| **Steps** | 1. `art chat "what is 2+2"` |
| **Expected** | Shows formatted response with answer. Shows tool usage summary (if any tools were used). |

### CL-04: Ask Command (Direct)
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | CLI installed, model online |
| **Steps** | 1. `art ask "explain what a map function does"` |
| **Expected** | Shows direct text response without tool usage |

### CL-05: Sessions Command
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | CLI installed, at least one session created |
| **Steps** | 1. `art sessions` |
| **Expected** | Lists sessions with IDs and titles |

### CL-06: Server Unreachable
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | CLI installed, server is DOWN |
| **Steps** | 1. `art health` |
| **Expected** | Clear error message: "Cannot reach Thirdwave server at <URL>" |

### CL-07: Custom Server URL
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | CLI installed |
| **Steps** | 1. `THIRDWAVE_SERVER=http://10.0.0.5:3100 art health` |
| **Expected** | CLI connects to custom server instead of default |

---

## 8. CLI File Saving

### FS-01: Save from write_file Tool Calls
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | CLI installed, model online |
| **Steps** | 1. `art chat "create a python hello world script"` <br> 2. Check `art_output/` directory |
| **Expected** | File saved in `art_output/` (e.g., `hello.py`). File contains valid Python code. Console shows "Saved N file(s)". |

### FS-02: Save from Code Blocks (Fallback)
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | CLI installed, model online, response contains code blocks but no write_file tool calls |
| **Steps** | 1. `art ask "write a fibonacci function in python"` (direct mode — no tools) <br> 2. Check `art_output/` directory |
| **Expected** | Code block extracted and saved as a file in `art_output/`. File extension matches language. |

### FS-03: Deduplication Between Tool and Code Block Saves
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Response has both write_file tool call AND code block with same content |
| **Steps** | 1. `art chat "create a file called app.py with a flask hello world"` <br> 2. Count files in `art_output/` |
| **Expected** | Only ONE copy of each file saved — tool call save takes priority, code block skipped for same file |

### FS-04: Multiple Files in Single Response
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | CLI installed |
| **Steps** | 1. `art chat "create a basic express app with index.js, package.json, and README.md"` |
| **Expected** | Multiple files saved in `art_output/`. Each file has correct content. Tool call summary shows multiple write_file calls. |

### FS-05: Custom Output Directory
| | |
|---|---|
| **Priority** | P3 |
| **Precondition** | CLI installed |
| **Steps** | 1. `art chat "create a test file" --dir /tmp/my-project` (if supported) |
| **Expected** | Files saved to specified directory instead of default `art_output/` |

---

## 9. Install Script

### IS-01: Fresh Install
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | No `art` binary exists, server running |
| **Steps** | 1. `curl -fsSL http://<server>/api/install \| bash` |
| **Expected** | Downloads CLI to `~/.local/bin/art`. Shows success message. Shows `export PATH` command. `art health` works. |

### IS-02: Server URL Patching
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | Server running at known IP |
| **Steps** | 1. `curl -fsSL http://172.30.140.142/api/install \| bash` <br> 2. `grep THIRDWAVE_SERVER ~/.local/bin/art` |
| **Expected** | The CLI binary contains `THIRDWAVE_SERVER="${THIRDWAVE_SERVER:-http://172.30.140.142}"` — patched to the server's actual URL |

### IS-03: Overwrite Existing Install
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | `art` already installed |
| **Steps** | 1. Run installer again |
| **Expected** | Overwrites old binary. New version reflected in `art --version` or behavior. |

### IS-04: Install Script Download
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Server running |
| **Steps** | 1. `curl http://localhost:3100/api/install` |
| **Expected** | Returns bash script (Content-Type: text/plain). Script contains correct server URL. |

### IS-05: Client Binary Download
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Server running |
| **Steps** | 1. `curl http://localhost:3100/api/client` |
| **Expected** | Returns bash script. Content-Disposition: `art`. Script contains `#!/usr/bin/env bash`. |

---

## 10. Session Management

### SM-01: Create Session
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | OpenCode running |
| **Steps** | 1. `curl -X POST http://localhost:3100/api/sessions -H 'Content-Type: application/json' -d '{}'` |
| **Expected** | HTTP 201. Response contains session `id` (ULID format). |

### SM-02: List Sessions
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | At least one session exists |
| **Steps** | 1. `curl http://localhost:3100/api/sessions` |
| **Expected** | JSON array of sessions with `id`, `title`, `time` fields |

### SM-03: Delete Session
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Session exists with known ID |
| **Steps** | 1. `curl -X DELETE http://localhost:3100/api/sessions/<id>` |
| **Expected** | HTTP 200. Session no longer appears in list. |

### SM-04: Send Message to Session
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Session exists |
| **Steps** | 1. `curl -X POST http://localhost:3100/api/sessions/<id>/message -d '{"parts":[{"type":"text","text":"hello"}]}'` |
| **Expected** | Response with AI-generated message parts |

---

## 11. Task Queue (Simple)

### TQ-01: Enqueue Task
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | OpenCode running |
| **Steps** | 1. `curl -X POST http://localhost:3100/api/tasks -d '{"prompt":"explain closures","directory":"."}'` |
| **Expected** | HTTP 201. Response: `{ id, status: "queued", prompt, ... }` |

### TQ-02: Task Status Progression
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Task enqueued |
| **Steps** | 1. Enqueue task <br> 2. Poll `GET /api/tasks/<id>` every 2s |
| **Expected** | Status transitions: `queued → running → done` (or `failed`). Final response contains result text. |

### TQ-03: List Tasks
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | At least one task exists |
| **Steps** | 1. `curl http://localhost:3100/api/tasks` |
| **Expected** | JSON array with tasks and their current statuses |

---

## 12. Scalable Queue

### SQ-01: Enqueue Job
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Queue started |
| **Steps** | 1. `curl -X POST http://localhost:3100/api/queue -d '{"title":"test job","prompt":"hello","priority":50}'` |
| **Expected** | HTTP 201. Job created with `state: "queued"` |

### SQ-02: Queue Metrics
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Queue running |
| **Steps** | 1. `curl http://localhost:3100/api/queue/metrics` |
| **Expected** | JSON with `queued`, `running`, `completed`, `failed` counts, `activeWorkers`, `queueDepth` |

### SQ-03: Priority Ordering
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Queue is stopped (to control execution order) |
| **Steps** | 1. Enqueue job A with `priority: 100` (low) <br> 2. Enqueue job B with `priority: 1` (high) <br> 3. Start queue |
| **Expected** | Job B executes before Job A |

### SQ-04: Backpressure
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Queue running, `maxQueueDepth=200` |
| **Steps** | 1. Rapid-fire 250 enqueue requests |
| **Expected** | First 200 accepted. Requests beyond 200 rejected with error (backpressure) |

### SQ-05: Queue Start/Stop
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Queue running |
| **Steps** | 1. `POST /api/queue/stop` <br> 2. Enqueue 3 jobs — verify they stay `queued` <br> 3. `POST /api/queue/start` |
| **Expected** | Jobs only picked up after start. Metrics reflect pause/resume. |

---

## 13. Orchestrations (Multi-Agent)

### OR-01: Start Simple Orchestration
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | OpenCode running |
| **Steps** | 1. ```curl -X POST http://localhost:3100/api/orchestrations -d '{"name":"test","tasks":[{"label":"task1","prompt":"explain closures"}]}'``` |
| **Expected** | HTTP 201. Orchestration created with `status: "pending"`, task listed |

### OR-02: Dependency Graph
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | OpenCode running |
| **Steps** | 1. Create orchestration with task B depending on task A: `tasks: [{label:"A",prompt:"..."},{label:"B",prompt:"...",dependsOn:["A"]}]` |
| **Expected** | Task A starts first. Task B waits until A completes. |

### OR-03: Cancel Orchestration
| | |
|---|---|
| **Priority** | P3 |
| **Precondition** | Orchestration running |
| **Steps** | 1. `POST /api/orchestrations/<id>/cancel` |
| **Expected** | All pending tasks cancelled. Running tasks aborted. Status: "cancelled". |

---

## 14. Parallel Execution

### PE-01: Run Parallel Tasks
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | OpenCode running |
| **Steps** | 1. `POST /api/parallel -d '{"name":"test","tasks":[{"prompt":"task 1"},{"prompt":"task 2"},{"prompt":"task 3"}]}'` |
| **Expected** | All 3 tasks start simultaneously (or limited by concurrency). Completion times are roughly equal (not sequential). |

### PE-02: List Parallel Executions
| | |
|---|---|
| **Priority** | P3 |
| **Precondition** | At least one parallel execution exists |
| **Steps** | 1. `curl http://localhost:3100/api/parallel` |
| **Expected** | JSON array with execution details and per-task statuses |

---

## 15. Budget Management

### BU-01: Check Budget (No Limits Set)
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | No budget limits configured |
| **Steps** | 1. `curl http://localhost:3100/api/budget/check` |
| **Expected** | `{ allowed: true, ... }` — everything allowed when no limits set |

### BU-02: Set Token Limit
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Thirdwave running |
| **Steps** | 1. `curl -X PUT http://localhost:3100/api/budget/limits -d '{"window":"day","maxTokens":10000,"hardLimit":true}'` <br> 2. `curl http://localhost:3100/api/budget/check` |
| **Expected** | Limit set. Check shows `allowed: true` with `remaining.tokens: 10000`. |

### BU-03: Budget Exceeded (Hard Limit)
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Hard token limit set to low value (e.g., 100 tokens) |
| **Steps** | 1. Record high usage: `POST /api/budget/record {"tokensInput":50,"tokensOutput":60}` <br> 2. `curl http://localhost:3100/api/budget/check` |
| **Expected** | `{ allowed: false, reason: "token limit exceeded", ... }` |

### BU-04: Budget Summary
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Some usage recorded |
| **Steps** | 1. `curl http://localhost:3100/api/budget/summary` |
| **Expected** | Summary per window (hour, day, month) with `tokensUsed`, `requestCount`, `costCents` |

---

## 16. Audit Logging

### AU-01: Audit Trail for API Calls
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Any API call made |
| **Steps** | 1. Make any API call (e.g., `/api/registry`) <br> 2. `curl http://localhost:3100/api/audit?limit=5` |
| **Expected** | Latest entry shows `action: "api.request"`, `metadata.path: "/api/registry"`, `success: true` |

### AU-02: Filter Audit by Action
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Multiple audit events exist |
| **Steps** | 1. `curl http://localhost:3100/api/audit?action=session.create` |
| **Expected** | Only session creation events returned |

### AU-03: Audit Statistics
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Multiple events logged |
| **Steps** | 1. `curl http://localhost:3100/api/audit/stats` |
| **Expected** | Aggregated stats: total events, success rate, events per action type |

### AU-04: Audit Date Range Filter
| | |
|---|---|
| **Priority** | P3 |
| **Precondition** | Events logged over time |
| **Steps** | 1. `curl http://localhost:3100/api/audit?from=2025-07-01&to=2025-07-02&limit=100` |
| **Expected** | Only events within the specified date range returned |

---

## 17. Workspace Management

### WS-01: Create Workspace
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Directory exists |
| **Steps** | 1. `curl -X POST http://localhost:3100/api/workspaces -d '{"name":"my-project","directory":"/home/nvidia/projects/myapp"}'` |
| **Expected** | HTTP 201. Workspace created with ULID, name, directory. |

### WS-02: List Workspaces
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | At least one workspace exists |
| **Steps** | 1. `curl http://localhost:3100/api/workspaces` |
| **Expected** | JSON array with workspace details |

### WS-03: Activate Workspace
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Workspace exists |
| **Steps** | 1. `POST /api/workspaces/<id>/activate` <br> 2. `GET /api/workspaces/active` |
| **Expected** | Active workspace returns the activated one |

### WS-04: Delete Workspace
| | |
|---|---|
| **Priority** | P3 |
| **Precondition** | Non-active workspace exists |
| **Steps** | 1. `DELETE /api/workspaces/<id>` |
| **Expected** | Workspace removed from list. Directory on disk NOT deleted (only metadata). |

### WS-05: Duplicate Directory Rejected
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Workspace already registered for a directory |
| **Steps** | 1. Try creating another workspace with same directory |
| **Expected** | Error: directory already registered (unique constraint) |

---

## 18. Skills / Knowledge System

### SK-01: List All Skills
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Skills loaded at startup |
| **Steps** | 1. `curl http://localhost:3100/api/skills` |
| **Expected** | JSON array with 31 skills. Each has `id`, `name`, `description`, `category`, `tags`. |

### SK-02: Search Skills by Keyword
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Skills loaded |
| **Steps** | 1. `curl http://localhost:3100/api/skills?q=debugging` |
| **Expected** | Results include "systematic-debugging" skill with high relevance score |

### SK-03: Get Skill by ID
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Skills loaded |
| **Steps** | 1. `curl http://localhost:3100/api/skills/systematic-debugging` |
| **Expected** | Full skill content with frontmatter metadata and markdown body |

### SK-04: Skill Count
| | |
|---|---|
| **Priority** | P3 |
| **Precondition** | Skills loaded |
| **Steps** | 1. Check startup logs for `[skills] Loaded N skills` |
| **Expected** | N ≥ 31 (31 installed skills) |

---

## 19. Policy Engine / Security

### PO-01: Evaluate Safe Action
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Policy engine initialized |
| **Steps** | 1. `curl -X POST http://localhost:3100/api/policies/evaluate -d '{"action":"read_file","target":"src/main.ts"}'` |
| **Expected** | `{ allowed: true, risk: <low_number> }` |

### PO-02: Sensitive File Detection
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | Policy engine initialized |
| **Steps** | 1. `POST /api/policies/evaluate -d '{"action":"read_file","target":".env"}'` |
| **Expected** | Either `allowed: false` or high risk score with warning about sensitive file |

### PO-03: Destructive Command Guard
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | Agentic chat working |
| **Steps** | 1. `POST /api/chat {"message":"run rm -rf / in bash"}` |
| **Expected** | Destructive Guard triggers. Either command blocked or AI refuses to execute dangerous command. |

### PO-04: List Active Policies
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Policy engine initialized |
| **Steps** | 1. `curl http://localhost:3100/api/policies` |
| **Expected** | List of 10 active policies with names and status |

### PO-05: Sensitive File Patterns (54 Patterns)
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Policy engine initialized |
| **Steps** | 1. Test each category: `.env`, `.pem`, `id_rsa`, `.aws/`, `api_key`, `.bash_history` |
| **Expected** | All recognized as sensitive. `isSensitiveFile()` returns true for each. |

---

## 20. Authentication & Authorization

### AA-01: Open Mode (No API Key)
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | `PLATFORM_API_KEY` NOT set in `.env` |
| **Steps** | 1. `curl http://localhost:3100/api/registry` (no auth header) |
| **Expected** | HTTP 200. Full response. No auth required. |

### AA-02: Key Required When Set
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | `PLATFORM_API_KEY=my-secret-key` in `.env`, service restarted |
| **Steps** | 1. `curl http://localhost:3100/api/registry` (no auth header) |
| **Expected** | HTTP 401: `{"error":"unauthorized","message":"Invalid or missing API key"}` |

### AA-03: Valid Bearer Token
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | API key set |
| **Steps** | 1. `curl -H 'Authorization: Bearer my-secret-key' http://localhost:3100/api/registry` |
| **Expected** | HTTP 200. Full response. |

### AA-04: Valid x-api-key Header
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | API key set |
| **Steps** | 1. `curl -H 'x-api-key: my-secret-key' http://localhost:3100/api/registry` |
| **Expected** | HTTP 200. Full response. |

### AA-05: Invalid Key
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | API key set |
| **Steps** | 1. `curl -H 'Authorization: Bearer wrong-key' http://localhost:3100/api/registry` |
| **Expected** | HTTP 401 |

---

## 21. Rate Limiting

### RL-01: Platform Rate Limit Headers
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Thirdwave running |
| **Steps** | 1. `curl -I http://localhost:3100/api/registry` |
| **Expected** | Response headers include: `X-RateLimit-Limit: 120`, `X-RateLimit-Remaining: <N>`, `X-RateLimit-Reset: <timestamp>` |

### RL-02: Rate Limit Exceeded
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Thirdwave running |
| **Steps** | 1. Send 130 rapid requests to `/api/registry` within 60 seconds |
| **Expected** | First 120 succeed. Requests 121+ get HTTP 429: `{"error":"rate_limited","message":"Too many requests"}` |

### RL-03: nginx Chat Rate Limit
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | nginx running |
| **Steps** | 1. Send 8 rapid POST requests to `/api/chat` via nginx |
| **Expected** | First 5+burst(10) succeed. Excess requests get HTTP 503 from nginx |

### RL-04: Rate Limit Resets
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Rate limit hit |
| **Steps** | 1. Hit rate limit <br> 2. Wait 60 seconds <br> 3. Send new request |
| **Expected** | Request succeeds. `X-RateLimit-Remaining` reset to max. |

---

## 22. nginx Proxy

### NX-01: Proxy to Platform
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | nginx + Thirdwave running |
| **Steps** | 1. `curl http://localhost/api/registry` |
| **Expected** | Same response as `curl http://localhost:3100/api/registry` |

### NX-02: Security Headers
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | nginx running |
| **Steps** | 1. `curl -I http://localhost/api/registry` |
| **Expected** | Headers: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection: 1; mode=block` |

### NX-03: Chat Timeout (300s)
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | nginx running |
| **Steps** | 1. Send a complex chat request that takes >60s but <300s via nginx |
| **Expected** | Request completes successfully (not timed out). nginx `proxy_read_timeout` is 300s for `/api/chat`. |

### NX-04: SSE Events Connection
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | nginx running |
| **Steps** | 1. `curl -N http://localhost/api/events` |
| **Expected** | SSE connection stays open. Events arrive in real-time. No buffering (nginx `proxy_buffering off`). |

### NX-05: Client Max Body Size
| | |
|---|---|
| **Priority** | P3 |
| **Precondition** | nginx running |
| **Steps** | 1. Send POST with body >10MB to `/api/chat` via nginx |
| **Expected** | HTTP 413 (Request Entity Too Large) from nginx |

---

## 23. systemd Service

### SD-01: Service Start
| | |
|---|---|
| **Priority** | P0 |
| **Precondition** | Service installed |
| **Steps** | 1. `sudo systemctl start thirdwave` <br> 2. `sudo systemctl status thirdwave` |
| **Expected** | Active (running). PID assigned. No errors in output. |

### SD-02: Service Auto-Restart
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Service running |
| **Steps** | 1. Kill the process: `sudo kill $(pgrep -f 'start-all')` <br> 2. Wait 10 seconds <br> 3. `sudo systemctl status thirdwave` |
| **Expected** | Service automatically restarted (Restart=on-failure). New PID. Health check passes. |

### SD-03: Service Logs
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Service running |
| **Steps** | 1. `journalctl -u thirdwave -n 20 --no-pager` |
| **Expected** | Logs show OpenCode start, Platform start, server banner with port info |

### SD-04: Service Stop
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Service running |
| **Steps** | 1. `sudo systemctl stop thirdwave` <br> 2. `curl http://localhost:3100/health` |
| **Expected** | Service stops cleanly (SIGTERM + 30s timeout). Health check fails (connection refused). |

### SD-05: ProtectSystem Enforcement
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Service running with `ProtectSystem=strict` |
| **Steps** | 1. Send chat: "create a file at /etc/test.txt" |
| **Expected** | write_file tool fails for paths outside ReadWritePaths (.platform/ and /tmp) |

### SD-06: Memory Limit
| | |
|---|---|
| **Priority** | P3 |
| **Precondition** | Service running, `MemoryMax=4G` |
| **Steps** | 1. Monitor: `systemctl show thirdwave -p MemoryMax` |
| **Expected** | MemoryMax set to 4294967296 (4G). Service killed if exceeded. |

---

## 24. Multi-User / Port Offset

### MU-01: Default Ports
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | `THIRDWAVE_PORT_OFFSET` not set |
| **Steps** | 1. Start platform <br> 2. Check startup banner |
| **Expected** | Platform on :3100, OpenCode on :4096 |

### MU-02: Port Offset Applied
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Set `THIRDWAVE_PORT_OFFSET=10` |
| **Steps** | 1. Start platform <br> 2. `curl http://localhost:3110/health` |
| **Expected** | Platform on :3110, OpenCode URL shifted to :4106 |

### MU-03: Auto-Port Finds Free Port
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | `AUTO_PORT=true`, port 3100 busy (e.g., another instance running) |
| **Steps** | 1. Start first instance on :3100 <br> 2. Start second instance |
| **Expected** | Second instance auto-binds to :3101 (or next free). Log: "Port 3100 busy — using 3101" |

---

## 25. Error Handling & Edge Cases

### EH-01: Invalid JSON Body
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | API accessible |
| **Steps** | 1. `curl -X POST http://localhost:3100/api/chat -H 'Content-Type: application/json' -d 'not json'` |
| **Expected** | HTTP 400: Zod validation error with details |

### EH-02: Missing Required Field
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | API accessible |
| **Steps** | 1. `curl -X POST http://localhost:3100/api/chat -d '{}'` |
| **Expected** | HTTP 400: `{"error":"ValidationError","issues":[{"path":["message"],...}]}` |

### EH-03: 404 Not Found
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | API accessible |
| **Steps** | 1. `curl http://localhost:3100/api/nonexistent` |
| **Expected** | HTTP 404: `{"error":"not_found","message":"GET /api/nonexistent not found"}` |

### EH-04: vLLM Unreachable During Chat
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | All model endpoints unreachable |
| **Steps** | 1. `POST /api/chat {"message":"hello"}` |
| **Expected** | Meaningful error: "No available model provider" or connection error with provider name |

### EH-05: Empty Message
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | API accessible |
| **Steps** | 1. `POST /api/chat {"message":""}` |
| **Expected** | HTTP 400: Zod validation error (min length 1) |

### EH-06: Message Too Large
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | API accessible |
| **Steps** | 1. Send message with 1MB+ of text |
| **Expected** | Either accepted (model handles context) or meaningful error about context limit |

### EH-07: Concurrent Requests
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | API accessible |
| **Steps** | 1. Send 10 `POST /api/chat` requests simultaneously |
| **Expected** | All requests handled. No crashes. Rate limiting may apply but no data corruption. |

### EH-08: Graceful Shutdown
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Active requests in progress |
| **Steps** | 1. Send long-running chat request <br> 2. `sudo systemctl stop thirdwave` |
| **Expected** | Server drains in-flight requests (KillMode=mixed, TimeoutStopSec=30). Clean shutdown in logs. |

---

## 26. Performance & Load

### PF-01: Health Check Latency
| | |
|---|---|
| **Priority** | P1 |
| **Precondition** | Thirdwave running, warm |
| **Steps** | 1. `time curl -s http://localhost:3100/health > /dev/null` |
| **Expected** | < 100ms response time |

### PF-02: Registry Response Time
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Thirdwave running |
| **Steps** | 1. `time curl -s http://localhost:3100/api/registry > /dev/null` |
| **Expected** | < 5s (includes probing vLLM/Ollama endpoints) |

### PF-03: Direct Chat Latency
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Model online, warm |
| **Steps** | 1. `time curl -s -X POST http://localhost:3100/api/chat/direct -d '{"message":"say hi"}'` |
| **Expected** | `latencyMs` in response < 10s for short response |

### PF-04: Agentic Chat with Tools
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Model online, warm |
| **Steps** | 1. `time curl -X POST http://localhost:3100/api/chat -d '{"message":"list files in current dir"}'` |
| **Expected** | < 30s for simple tool task (1-2 rounds). < 120s for complex multi-round tasks. |

### PF-05: Concurrent Users
| | |
|---|---|
| **Priority** | P2 |
| **Precondition** | Thirdwave running |
| **Steps** | 1. Use `ab` or `wrk`: `ab -n 100 -c 10 http://localhost:3100/health` |
| **Expected** | 0 failed requests. p95 < 500ms. No OOM or crashes. |

---

## Appendix: Quick Smoke Test Script

Run this as a quick validation after deployment:

```bash
#!/usr/bin/env bash
# Quick smoke test for Thirdwave platform
SERVER="${1:-http://localhost:3100}"
PASSED=0
FAILED=0

check() {
  local name="$1" cmd="$2" expect="$3"
  result=$(eval "$cmd" 2>/dev/null)
  if echo "$result" | grep -q "$expect"; then
    echo "✓ $name"
    PASSED=$((PASSED + 1))
  else
    echo "✗ $name (expected '$expect')"
    FAILED=$((FAILED + 1))
  fi
}

echo "=== Thirdwave Smoke Test ==="
echo "Server: $SERVER"
echo ""

check "Health"          "curl -sf $SERVER/health"              '"platform":"ok"'
check "Registry"        "curl -sf $SERVER/api/registry"        '"local"'
check "Audit"           "curl -sf $SERVER/api/audit?limit=1"   '['
check "Budget check"    "curl -sf $SERVER/api/budget/check"    '"allowed"'
check "Skills"          "curl -sf $SERVER/api/skills"          '['
check "Policies"        "curl -sf $SERVER/api/policies"        '['
check "Queue metrics"   "curl -sf $SERVER/api/queue/metrics"   '"queued"'
check "Client download" "curl -sf $SERVER/api/client | head -1" '#!/usr/bin/env bash'
check "Install script"  "curl -sf $SERVER/api/install | head -1" '#!/usr/bin/env bash'

echo ""
echo "Passed: $PASSED  Failed: $FAILED"
[[ $FAILED -eq 0 ]] && echo "ALL PASSED ✓" || echo "SOME FAILED ✗"
```

Save as `platform/tests/smoke-test.sh` and run after deployment:
```bash
bash platform/tests/smoke-test.sh http://172.30.140.142
```

---

*End of Test Case Scenarios Document*
