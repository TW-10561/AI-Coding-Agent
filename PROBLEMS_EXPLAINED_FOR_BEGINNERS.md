# Thirdwave RBAC Explained for Beginners

## What We Want to Build

✅ **Single PostgreSQL database** — One database for everything  
✅ **Flexible RBAC** — Roles that can be changed without restarting the program  
❌ **NO autonomous_agent role** — Agents always need human approval for risky actions  

---

## The 8 Problems Explained Simply

### Problem 1: No HITL Approval Workflow
 **Critical**

**What it means:** Right now, when your AI agent wants to do something risky (like delete files or run bash commands), it just does it. No human checks it first.

**Real example:**
```
Agent thinks: "I'll run: rm -rf /workspace/data"
Current system: ✓ Executes immediately (dangerous! 🔥)
Smart system: ✗ Creates approval request
            → Human gets notification: "Agent wants to delete /workspace/data"
            → Human reviews and clicks "Approve" or "Deny"
            → If approved, then execute
```

**Why it matters:** Protects against agent mistakes. If an agent misunderstands a request and tries to delete the wrong folder, a human can stop it.

---

### Problem 2: Hardcoded RBAC (4 roles)
🔴 **Critical**

**What it means:** Your roles are written in the code. To add or change a role, a programmer must edit files and restart the system.

**Current hardcoded roles (in code):**
```typescript
const roles = {
  admin: { ... },           // Can do everything
  developer: { ... },       // Can run most tools
  readonly: { ... },        // Can only read
  autonomous_agent: { ... } // (We're removing this)
}
```

**Problem:** 
- Want to create a "data_analyst" role that can only see specific files? → Need programmer
- Want to let Bob access `/workspace/data` but not `/workspace/secrets`? → Need programmer
- Want to change the policy? → Need to edit code, restart system, team loses access temporarily

**Why it matters:** You can't adapt to team changes quickly. New hire? Wait for programmer. New project? Wait for programmer.

---

### Problem 3: In-Memory RBAC
🔴 **Critical**

**What it means:** Role information is stored in the program's memory (RAM), not in a database.

**Real example:**
```
Current system:
┌─────────────────────┐
│  Platform Program   │
│  (Running in RAM)   │
│  Roles in memory:   │
│  - admin            │
│  - developer        │
│  - readonly         │
└─────────────────────┘

To change a role: Stop program → Edit code → Restart program
                   ↓
            Everyone loses access for 30 seconds!

Better system:
┌─────────────────────┐    ┌──────────────────┐
│  Platform Program   │    │   PostgreSQL DB  │
│  (Running in RAM)   │───→│  Roles in DB:    │
│                     │    │  - admin         │
│                     │    │  - developer     │
│                     │    │  - readonly      │
└─────────────────────┘    └──────────────────┘

To change a role: Update database → Program reads changes in <1 second
                   ↓
            No one loses access! Zero downtime!
```

**Why it matters:** Changes can happen instantly without disrupting the team.

---

### Problem 4: No Path-Level Access
🟠 **High**

**What it means:** You can't restrict which folders/directories each role can access. Either a role can access ALL files, or NO files.

**Real example:**
```
Currently:
├─ Bob (developer role)
│  └─ Can read/write: /workspace/, /root/, /etc/, EVERYTHING
│
├─ Charlie (readonly role)
│  └─ Can read: /workspace/, /root/, /etc/, EVERYTHING
│
└─ What we want:
   ├─ Bob
   │  └─ Can read/write: /workspace/project1
   │     Can read: /workspace/shared
   │     Cannot see: /workspace/secrets ← BLOCKED
   │
   └─ Charlie
      └─ Can read: /workspace/shared, /workspace/docs
         Cannot see: /workspace/project1 ← BLOCKED
```

**Why it matters:** Sensitive data stays protected. Bob works on Project 1, should he see the secrets folder? No!

---

### Problem 5: No User Management
🟠 **High**

**What it means:** There's no way to create team members or assign them roles in the system.

**Current situation:**
```
New hire "Diana" joins the team
├─ You tell her: "Ask the programmer to give you access"
├─ Programmer: "What role?"
├─ You: "developer role"
├─ Programmer: (edits config file, restarts system) ✓ Diana now has access
└─ Next month, Diana switches teams: Ask programmer again to remove access
```

**Better system:**
```
New hire "Diana" joins the team
├─ You go to admin UI
├─ Click "Add User"
├─ Type: Diana's email, select "developer" role
├─ Click "Save"
└─ Diana has access in <1 second. No programmer needed!
```

**Why it matters:** HR/managers can onboard/offboard people. Programmers don't have to babysit access changes.

---

### Problem 6: Fragmented Audit Trail
🟠 **High**

**What it means:** There's no complete record of who did what and who approved what. Compliance and debugging become hard.

**Real scenario:**
```
Someone deleted important files.

Current system: "When did this happen? Who did it? Did anyone approve it?"
                → Check 3 different log files
                → Some logs are JSONL files on disk (hard to search)
                → Some logs are in memory (lost if system crashes)
                → Piecing together the story takes 2 hours 😞

Better system: "When did this happen? Who did it? Did anyone approve it?"
               → Query: SELECT * FROM audit_log WHERE action='delete_file'
               → One organized table in PostgreSQL
               → Shows: WHO, WHEN, WHAT, WHO APPROVED IT
               → Answer in 30 seconds ✓
               → Can use for compliance reports (SOC2, FedRAMP, etc.)
```

**Why it matters:** 
- Debug issues faster
- Prove to auditors: "Yes, we have oversight on who does what"
- Legal proof if something goes wrong

---

### Problem 7: SQLite at Scale
🟡 **Medium**

**What it means:** SQLite works fine for 1-2 people, but starts breaking at 10+ people using it simultaneously.

**Real example:**
```
SQLite's limitation:
├─ Person A writes data
├─ Database locks: "Nobody else can write"
├─ Person B: "I want to write..." → Waits. Waits. Waits.
├─ Person C: "I want to write..." → Waits. Waits. Waits.
└─ After Person A finishes (1 second later), Person B and C can write

With 10 people: Someone is ALWAYS waiting. System feels slow! 🐢

PostgreSQL doesn't lock like that:
├─ Person A writes data
├─ Person B writes data → No problem! Happens at the same time
├─ Person C writes data → No problem! Happens at the same time
└─ All 10 people write simultaneously. Everyone is fast! 🚀
```

**Why it matters:** As your team grows, the system stays fast and responsive.

---

### Problem 8: No Approval Workflow UI
🟡 **Medium**

**What it means:** When the system needs human approval for a risky action, there's nowhere for the approver to see it or click "approve/deny".

**Real scenario:**
```
Agent requests: "I want to run 'bash: install-dependencies.sh'"

Current system:
├─ Approval request created (somewhere in a database)
├─ Approver Bob: "Uh, how do I approve this?"
└─ No UI, no notification, approval request is lost

Better system:
├─ Approval request created
├─ Bob gets Slack notification: "⚠️ Agent wants to run bash. Risk: HIGH. [Approve] [Deny]"
├─ Bob clicks [Approve]
└─ System logs the approval, executes bash, everyone is happy
```

**Why it matters:** 
- Approvers can actually do their job
- Risky actions don't get stuck waiting for approval
- Audit trail shows who approved what

---

## How Roles Can Be Dynamic (Not Hardcoded)

### Current: Hardcoded in Code ❌

```typescript
// File: platform/HITL/rbac.ts
const roles = {
  admin: {
    permissions: { "*": "allow" }
  },
  developer: {
    permissions: {
      bash: "ask",
      read_file: "allow",
      write_file: "allow"
    }
  },
  readonly: {
    permissions: {
      bash: "deny",
      read_file: "allow",
      write_file: "deny"
    }
  }
}
```

**Problem:** To add a role, you edit this file, restart the system. Everyone loses access for 30 sec.

---

### New: Dynamic from Database ✅

```sql
-- Instead of code, roles live in PostgreSQL:

CREATE TABLE roles (
  id UUID PRIMARY KEY,
  name TEXT,      -- "admin", "developer", "readonly", "data_analyst", etc.
  description TEXT
);

CREATE TABLE tool_access_policies (
  id UUID PRIMARY KEY,
  role_id UUID,
  tool_name TEXT,  -- "bash", "read_file", "write_file", etc.
  decision TEXT     -- "allow", "ask", "deny"
);

-- Example data in PostgreSQL:
INSERT INTO roles VALUES ('role-1', 'admin', 'Full access admin');
INSERT INTO roles VALUES ('role-2', 'developer', 'Can code and test');
INSERT INTO roles VALUES ('role-3', 'data_analyst', 'Can query and analyze');
INSERT INTO roles VALUES ('role-4', 'intern', 'New team member');

INSERT INTO tool_access_policies VALUES ('policy-1', 'role-2', 'bash', 'ask');
INSERT INTO tool_access_policies VALUES ('policy-2', 'role-2', 'read_file', 'allow');
INSERT INTO tool_access_policies VALUES ('policy-3', 'role-3', 'bash', 'deny');
INSERT INTO tool_access_policies VALUES ('policy-4', 'role-3', 'read_file', 'allow');
INSERT INTO tool_access_policies VALUES ('policy-5', 'role-4', 'bash', 'deny');
```

**Benefit:** Add a role by inserting a row. Changes take effect in <1 second. No restart needed. 🚀

---

## What Roles Could You Create?

Since roles are now dynamic, you can create ANY roles you want:

### Default Roles (We Recommend)

```yaml
roles:
  admin:
    description: "Engineering lead, full access, approves others"
    permissions:
      bash: "allow"                 # Can run bash
      read_file: "allow"            # Can read files
      write_file: "allow"           # Can write files
      web_fetch: "allow"            # Can fetch URLs
      
  developer:
    description: "Software engineer, can code & test"
    permissions:
      bash: "ask"                   # Bash needs approval
      read_file: "allow"
      write_file: "allow"
      web_fetch: "ask"              # Web requests need approval
      
  readonly:
    description: "Manager/stakeholder, read-only access"
    permissions:
      bash: "deny"
      read_file: "allow"            # Can only read
      write_file: "deny"
      web_fetch: "deny"
```

### Custom Roles You Could Create

**For your team:**

```yaml
data_analyst:
  description: "Analyzes data, runs SQL queries, no bash"
  permissions:
    bash: "deny"
    read_file: "allow"
    write_file: "ask"               # Writing needs approval
    web_fetch: "allow"
    
devops:
  description: "Infrastructure, deploys, approves changes"
  permissions:
    bash: "allow"
    read_file: "allow"
    write_file: "allow"
    web_fetch: "allow"
    
security_officer:
  description: "Audits, reviews approvals, sensitive access"
  permissions:
    bash: "deny"
    read_file: "allow"
    write_file: "deny"
    web_fetch: "deny"
    
intern:
  description: "New team member, very restricted"
  permissions:
    bash: "deny"
    read_file: "allow"              # Can read docs/examples
    write_file: "deny"
    web_fetch: "ask"                # Web needs approval
```

---

## How It All Works Together: A Real Example

### Scenario: Alice (Developer) Tries to Delete Data

```
Step 1: Alice's Tool Execution
├─ Agent: "I'll run: bash 'rm -rf /workspace/data'"
└─ Platform receives request

Step 2: Path Access Check (Problem #4 solved ✓)
├─ Check: Is Alice allowed to write to /workspace/data?
├─ Database query: SELECT * FROM path_access_rules WHERE role='developer' AND path LIKE '/workspace/data%'
├─ Result: YES, she can write there
└─ Continue...

Step 3: Tool Access Check
├─ Check: Is developer role allowed to run 'bash'?
├─ Database query: SELECT decision FROM tool_access_policies WHERE role='developer' AND tool='bash'
├─ Result: "ask" (requires approval)
└─ Continue...

Step 4: Create Approval Request (Problem #1 solved ✓)
├─ Create row in approval_requests table
├─ Tool: "bash"
├─ Command: "rm -rf /workspace/data"
├─ Requested by: Alice
├─ Status: "pending"
└─ Send notification...

Step 5: Notification (Problem #8 solved ✓)
├─ Alert sent to Slack (in #approvals channel)
│  "⚠️ Alice wants to run bash: 'rm -rf /workspace/data'"
│  "Risk Score: HIGH (destructive file operation detected)"
│  [Approve] [Deny]
└─ Bob (admin) sees the notification

Step 6: Approval
├─ Bob reviews: "This looks dangerous. Is this really needed?"
├─ Bob asks Alice: "Are you sure?"
├─ Alice: "Yes, that's old test data"
├─ Bob clicks [Approve]
└─ System updates approval_requests.status = "approved"

Step 7: Audit Trail (Problem #6 solved ✓)
├─ Record in audit_log table:
│  {
│    action: "approval_request.approved",
│    requested_by: "alice",
│    approved_by: "bob",
│    tool: "bash",
│    command: "rm -rf /workspace/data",
│    timestamp: "2026-04-08 10:30:00",
│    result: "approved"
│  }
└─ Compliance trail established

Step 8: Execute
├─ Now that approval is given, execute the bash command
├─ Delete /workspace/data ✓
└─ Done

Later audit shows:
"On April 8, Alice requested to delete /workspace/data. Bob approved it at 10:30am. Executed successfully."
```

---

## Why NOT Have an Autonomous Agent Role?

You mentioned: **"don't have autonomous role at all"** ✓ Good call!

**Why autonomous agents are risky:**

```
If you allow autonomous_agent role with "bash: allow" (no approval):
├─ Agent runs bash without human review
├─ Agent makes a mistake (misunderstands instructions)
├─ Agent: "I'll delete the database"
├─ [EXECUTE] — Too late! Database is gone 🔥
└─ No human saw it coming

Better approach:
├─ ALL risky actions (bash, write_file, web_fetch) need approval
├─ Agent can execute low-risk things (read_file, list_dir)
├─ Human always in the loop for dangerous operations
└─ Mistakes are caught before they happen ✓
```

---

## Summary: What You're Actually Building

```plaintext
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  ✅ Single PostgreSQL Database                             │
│     └─ All data (users, roles, approvals, audit) in one    │
│        place. Fast. Reliable. Scalable.                    │
│                                                             │
│  ✅ Dynamic RBAC (not hardcoded)                            │
│     └─ Create/edit roles without coding. Changes take      │
│        effect in 1 second.                                 │
│                                                             │
│  ✅ Approval Workflow (HITL)                               │
│     └─ Risky actions need human approval. Slack            │
│        notifications. Web UI for approvers.                │
│                                                             │
│  ✅ Path-Level Access Control                              │
│     └─ Bob can see /workspace/project1 but not             │
│        /workspace/secrets. Fine-grained control.           │
│                                                             │
│  ✅ User Management                                        │
│     └─ Create users and assign roles via API/UI.           │
│        No programmer needed.                               │
│                                                             │
│  ✅ Audit Trail (Compliance)                               │
│     └─ Complete log: who did what, who approved it,        │
│        when, why. For auditors.                            │
│                                                             │
│  ✅ Scales to 50+ users                                    │
│     └─ PostgreSQL handles simultaneous users.              │
│        SQLite couldn't.                                    │
│                                                             │
│  ✅ NO Autonomous Agent Role                               │
│     └─ Agents always need human approval for risky         │
│        actions. Safer.                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## The 6-Week Plan to Build This

| Week | What | Why |
|------|------|-----|
| **1** | Set up PostgreSQL, create 11 tables | Get the database ready |
| **2** | Migrate data from SQLite to PostgreSQL | Move all historical data safely |
| **3** | Build RBACEngineV2 (reads from DB, not code) | Core logic for dynamic RBAC |
| **4** | Build REST API endpoints | Team can manage roles/users via API |
| **5** | Build approval UI + Slack notifications | Approvers see requests and approve them |
| **6** | Test everything, switch to PostgreSQL | Validate it all works, go live |

**Total:** 155 hours, 3 engineers, 6 weeks.

---

## Next Steps

1. **Confirm the plan** — Do you agree with removing autonomous_agent role?
2. **Start Phase 1** — Provision PostgreSQL (April 9)
3. **Parallel work** — Backend + DevOps can start simultaneously
4. **Go live** — May 20, 2026 ✓

Ready?
