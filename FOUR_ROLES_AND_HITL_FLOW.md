# Thirdwave: 4 Roles + HITL Approval Workflow

## Your 4 Roles (Simplified)

```yaml
roles:
  - name: admin
    description: "Engineering lead, full access, approves risky requests"
    tool_policies:
      bash: "allow"           # Can run bash immediately
      read_file: "allow"
      write_file: "allow"
      web_fetch: "allow"
    path_rules:
      - pattern: "*"          # Can access everything
        readable: true
        writable: true
        executable: true
        priority: 100

  - name: developer
    description: "Software engineer, can code & test"
    tool_policies:
      bash: "ask"             # ← TRIGGERS HITL APPROVAL
      read_file: "allow"      # Can read immediately
      write_file: "allow"     # Can write immediately
      web_fetch: "ask"        # ← TRIGGERS HITL APPROVAL
    path_rules:
      - pattern: "/workspace/*"
        readable: true
        writable: true
        priority: 10
      - pattern: "/root"
        readable: false
        writable: false
        priority: 20

  - name: readonly
    description: "Manager/stakeholder, read-only access"
    tool_policies:
      bash: "deny"
      read_file: "allow"      # Can read immediately
      write_file: "deny"
      web_fetch: "deny"
    path_rules:
      - pattern: "/workspace/*"
        readable: true
        writable: false
        priority: 10

  - name: team_leader
    description: "Team lead, can code & approve risky requests"
    tool_policies:
      bash: "allow"           # Can run bash immediately
      read_file: "allow"
      write_file: "allow"
      web_fetch: "allow"      # Can fetch URLs immediately
    path_rules:
      - pattern: "/workspace/*"
        readable: true
        writable: true
        priority: 10
      - pattern: "/root"
        readable: false
        writable: false
        priority: 20
```

---

## When Does HITL Approval Popup Happen?

**HITL = Human-In-The-Loop**

### The Trigger: `decision: "ask"`

When a tool has `"ask"` in the policy, an approval request is created IMMEDIATELY.

**Example Flow:**

```
Developer Bob tries to run: bash "npm install"

┌─────────────────────────────────────────────────────────┐
│ Step 1: Bob executes bash (tool_name="bash")            │
│ Platform receives request                               │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Step 2: Check RBAC                                      │
│ Query: SELECT decision FROM tool_access_policies        │
│        WHERE role='developer' AND tool_name='bash'      │
│ Result: "ask" ← THIS MEANS: Approval needed!            │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Step 3: Create Approval Request                         │
│ INSERT INTO approval_requests (                         │
│   session_id,                                           │
│   tool_name: "bash",                                    │
│   tool_args: "npm install",                             │
│   requested_by: bob_user_id,                            │
│   status: "pending",                                    │
│   risk_score: 40 (package install)                      │
│ )                                                       │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Step 4: Send Notification (HITL POPUP) 🔔              │
│                                                         │
│ Slack notification to #approvals channel:              │
│ ┌─────────────────────────────────────────────┐        │
│ │ ⚠️  APPROVAL NEEDED                          │        │
│ │ User: Bob (developer)                        │        │
│ │ Action: bash                                 │        │
│ │ Command: npm install                         │        │
│ │ Risk Score: 40 (Medium)                      │        │
│ │                                              │        │
│ │ [Approve] [Deny]                             │        │
│ └─────────────────────────────────────────────┘        │
│                                                         │
│ Admin Alice sees notification immediately in Slack    │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Step 5: Bash Does NOT Execute Yet                       │
│                                                         │
│ Bob: "Why isn't my npm install running?"              │
│ System: "Waiting for approval from team leader..."      │
│                                                         │
│ Status: "pending"                                       │
│ Bob cannot run bash until approved                      │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Step 6: Admin/Team Leader Approves (in Slack)          │
│                                                         │
│ Alice clicks [Approve] in Slack                        │
│                                                         │
│ System updates:                                         │
│ UPDATE approval_requests                               │
│ SET status = "approved",                               │
│     approved_by = alice_user_id,                        │
│     approved_at = now()                                 │
│                                                         │
│ Audit log entry recorded:                              │
│ {                                                       │
│   action: "approval.approved",                          │
│   requested_by: "bob",                                 │
│   approved_by: "alice",                                │
│   tool: "bash",                                        │
│   timestamp: "2026-04-08 14:30:00"                      │
│ }                                                       │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Step 7: Now Execute Bash                                │
│                                                         │
│ Platform: "Alice approved. Running npm install..."     │
│ $ npm install                                          │
│ ✓ Packages installed successfully                      │
│                                                         │
│ Bob sees: "✓ Done!"                                    │
└─────────────────────────────────────────────────────────┘
```

---

## Key Points: When HITL Popup Happens

### ✅ HITL Popup/Notification Appears When:

Tool execution encounters a decision: **"ask"**

**Your 4 roles trigger HITL when:**

| Role | Tool | Trigger? | What Happens |
|------|------|----------|--------------|
| **admin** | bash | ❌ NO | Executes immediately (allow) |
| **admin** | read_file | ❌ NO | Executes immediately (allow) |
| **developer** | bash | ✅ YES | Creates approval request + Slack notification |
| **developer** | read_file | ❌ NO | Executes immediately (allow) |
| **developer** | write_file | ❌ NO | Executes immediately (allow) |
| **developer** | web_fetch | ✅ YES | Creates approval request + Slack notification |
| **readonly** | bash | ❌ NO | Denied immediately (deny) - no approval even requested |
| **readonly** | read_file | ❌ NO | Executes immediately (allow) |
| **team_leader** | bash | ❌ NO | Executes immediately (allow) |
| **team_leader** | web_fetch | ❌ NO | Executes immediately (allow) |

---

## The 3 Decisions Explained

### 1️⃣ Decision: "allow"
✅ Tool executes IMMEDIATELY (no human review)

```
Developer wants to: read_file /workspace/README.md
├─ RBAC says: "developer → read_file = allow"
├─ Action: Execute immediately
└─ Result: File contents returned in <100ms
```

---

### 2️⃣ Decision: "deny"
❌ Tool is BLOCKED (no execution, no approval request)

```
ReadOnly user wants to: bash "rm -rf /workspace"
├─ RBAC says: "readonly → bash = deny"
├─ Action: Block immediately
├─ Result: "Access Denied: bash is not allowed for readonly role"
└─ NO approval request created (it's just not allowed)
```

---

### 3️⃣ Decision: "ask"
⏸️ HITL Popup/Notification Appears (approval workflow)

```
Developer wants to: bash "npm install --save-dev @types/node"
├─ RBAC says: "developer → bash = ask"
├─ Action: Create approval_requests row
├─ Notification: Slack message to #approvals
├─ Bob waits: "Waiting for approval..."
├─ Alice approves (or denies) in Slack
├─ If approved: Execute bash
└─ If denied: "Approval denied. Bash not executed."
```

---

## Timeline: When Each Popup Appears

### Scenario 1: Developer Bob wants to run bash

```
14:30:00 — Bob types: bash "npm install"
14:30:01 — Platform checks RBAC
14:30:02 — Platform sees: "developer → bash = ask"
14:30:03 — Platform creates approval_requests row
14:30:04 — ⏰ SLACK POPUP APPEARS TO ALICE
           "⚠️ Bob wants to run bash: 'npm install'"
           [Approve] [Deny]
           
14:30:45 — Alice clicks [Approve]
14:30:46 — Platform executes: npm install
14:31:00 — ✓ npm install finishes
           Bob sees: "✓ Completed successfully"
           
Approval took: ~45 seconds (Alice was watching Slack)
Total time for Bob: ~30 seconds (waiting)
```

---

### Scenario 2: Readonly user wants to read file

```
15:00:00 — Charlie (readonly) types: read_file /workspace/README.md
15:00:01 — Platform checks RBAC
15:00:02 — Platform sees: "readonly → read_file = allow"
15:00:03 — 🚀 EXECUTES IMMEDIATELY (no popup)
           
Charlie sees: File contents in <100ms
NO approval needed. Takes 100ms total.
```

---

### Scenario 3: Team Leader wants to run bash

```
16:00:00 — Alice (team_leader) types: bash "git push"
16:00:01 — Platform checks RBAC
16:00:02 — Platform sees: "team_leader → bash = allow"
16:00:03 — 🚀 EXECUTES IMMEDIATELY (no popup)
           
Alice sees: Command output in <200ms
NO approval needed. Takes 200ms total.
```

---

## Your HITL Approval Flow Summary

### Decision Matrix for Your 4 Roles

```
┌──────────────┬──────────┬────────────┬────────────┬───────────────┐
│ Role         │ bash     │ read_file  │ write_file │ web_fetch     │
├──────────────┼──────────┼────────────┼────────────┼───────────────┤
│ admin        │ ✅ allow │ ✅ allow   │ ✅ allow   │ ✅ allow      │
│ developer    │ ⏸️ ask   │ ✅ allow   │ ✅ allow   │ ⏸️ ask        │
│ readonly     │ ❌ deny  │ ✅ allow   │ ❌ deny    │ ❌ deny       │
│ team_leader  │ ✅ allow │ ✅ allow   │ ✅ allow   │ ✅ allow      │
└──────────────┴──────────┴────────────┴────────────┴───────────────┘

HITL Popups appear when: ⏸️ "ask" decision
Popup frequency:
- Developers who run bash: ~5–10 per day (approval needed)
- Developers who fetch URLs: ~2–5 per day (approval needed)
- Admins & team leaders: Almost never (everything allowed)
- Readonly users: Never (only reads allowed, no popups)
```

---

## When You Add More Roles Later

If you add new roles in the future (example):

```sql
-- Adding a new role in the future (without code changes!)
INSERT INTO roles (name, description) VALUES ('qa_tester', 'QA engineer');

-- Setting their policies
INSERT INTO tool_access_policies (role_id, tool_name, decision) VALUES
  ('qa_tester', 'bash', 'ask'),          -- Same as developer
  ('qa_tester', 'read_file', 'allow'),
  ('qa_tester', 'write_file', 'ask'),    -- Stricter than developer
  ('qa_tester', 'web_fetch', 'deny');    -- No web access for QA
```

**No code change needed.** The HITL system automatically uses the new role. ✓

---

## Database Tables Involved in HITL

When a developer tries to run bash:

```
┌──────────────────────────────────────────────────────────┐
│ 1. Check tool_access_policies table                      │
│    WHERE role_id = 'developer' AND tool_name = 'bash'    │
│    Result: decision = "ask" ← TRIGGER ALERT              │
└──────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────┐
│ 2. Create row in approval_requests table                 │
│    INSERT: {                                             │
│      session_id, tool_name, tool_args,                   │
│      requested_by, status: 'pending',                    │
│      risk_score, risk_factors                            │
│    }                                                     │
└──────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────┐
│ 3. Send Slack notification (external service)            │
│    POST to Slack API: approval request details           │
└──────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────┐
│ 4. Approver clicks [Approve] in Slack                    │
│    UPDATE approval_requests                              │
│    SET status = 'approved', approved_by, approved_at     │
└──────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────┐
│ 5. Log to audit_log table                                │
│    INSERT: action, approved_by, result, timestamp        │
└──────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────┐
│ 6. Execute the bash command                              │
│    (Now that it's approved)                              │
└──────────────────────────────────────────────────────────┘
```

---

## Summary

### Your 4 Roles:
1. **admin** — Full access, no approvals
2. **developer** — Can code & test; bash & web_fetch need approval
3. **readonly** — Read-only; nothing needs approval (because all denied or already allow)
4. **team_leader** — Full access, no approvals (like admin)

### HITL Popup Appears When:
- **Decision = "ask"** in tool_access_policies
- For your roles: **Only developers** see popups (when they run bash or web_fetch)
- **Admins & team leaders** never see popups (everything allowed)
- **Readonly** never see popups (everything denied or read-only)

### Timeline:
- Developer tries bash → Approval request created → Slack notification in <100ms → Admin approves → Bash executes (total: ~30–60 seconds depending on approval response time)

Ready to start Phase 1?
