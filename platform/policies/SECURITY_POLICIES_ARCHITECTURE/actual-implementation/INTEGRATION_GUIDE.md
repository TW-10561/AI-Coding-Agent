🔗 INTEGRATION GUIDE
═══════════════════════════════════════════════════════════════════════════════

How the 10 Security Policies integrate into the bash.ts execution tool.


📍 CENTRAL INTEGRATION POINT
═══════════════════════════════════════════════════════════════════════════════

File: packages/opencode/src/tool/bash.ts

This is where all 10 security policies come together and work as one unified
security system. Every command execution flows through these policies.


🔗 INTEGRATION ARCHITECTURE
═══════════════════════════════════════════════════════════════════════════════

USER COMMAND INPUT
  ↓
  ├─→ LOAD CONFIGURATION (opencode.json)
  │   └─ Read security settings, user role, autonomy mode
  │
  ├─→ INITIALIZE SECURITY SYSTEMS
  │   ├─ RiskEngine
  │   ├─ SandboxRunnerFactory
  │   ├─ AuditLogger
  │   ├─ LoopGuard
  │   └─ Other security modules
  │
  ├─→ GATE 1: DESTRUCTIVE COMMAND CHECK (Policy #4)
  │   ├─ Pattern matching (rm -rf, chmod 777, DROP TABLE, etc.)
  │   ├─ Always checked first
  │   └─ If matched → REQUIRE APPROVAL
  │
  ├─→ GATE 2: SENSITIVE FILE DETECTION (Policy #2)
  │   ├─ Check for .env, SSH keys, credentials (Policy #2)
  │   ├─ Increase risk score if found
  │   └─ Log sensitive file access (Policy #9)
  │
  ├─→ GATE 3: RISK ASSESSMENT (Policy #3)
  │   ├─ Compute dynamic risk score (0-100)
  │   ├─ Apply autonomy mode multipliers (Policy #10)
  │   ├─ Compare to configured thresholds
  │   └─ If score >= ask threshold → REQUIRE APPROVAL
  │
  ├─→ GATE 4: LOOP DETECTION (Policy #5)
  │   ├─ Check command/error history (60s window)
  │   ├─ Detect repetition patterns
  │   └─ If loop likely → REQUIRE APPROVAL
  │
  ├─→ PERMISSION CHECK (Policy #8)
  │   ├─ Check user role (admin, developer, readonly, autonomous_agent)
  │   ├─ Check skill trust (Policy #7)
  │   └─ Verify RBAC permissions
  │
  ├─→ EXECUTION
  │   ├─ Sandbox Runner (Policy #1)
  │   │  ├─ Host mode or Docker mode
  │   │  └─ Memory/CPU limits
  │   │
  │   ├─ Network Guard (Policy #6)
  │   │  ├─ Allow/deny/allowlist modes
  │   │  └─ Domain matching
  │   │
  │   └─ Execute command
  │
  └─→ AUDIT & REPORT (Policy #9)
      ├─ Log all decisions (hash-chained)
      ├─ Record execution details
      ├─ Include security metadata
      └─ Return results with metadata


═══════════════════════════════════════════════════════════════════════════════

📊 GATE ORDER & IMPORTANCE
═══════════════════════════════════════════════════════════════════════════════

Gate Order:  Priority  Policy          Blocking?   Quick-Fail?
──────────────────────────────────────────────────────────────────────────────
Gate 1       1st       Destructive     Yes         Always checked first
             (Critical) (Policy #4)     

Gate 2       2nd       Sensitive       Increases  Only used for risk
             (High)    Files (Policy #2) risk      scoring

Gate 3       3rd       Risk Engine     Maybe      Checks thresholds
             (Medium)  (Policy #3)

Gate 4       4th       Loop Detection  Maybe      If enabled
             (Medium)  (Policy #5)

Execution    5th       Sandbox         No         But tracks metadata
             (Low)     (Policy #1)

              Side      All Others      No         Non-blocking
             Effects   (Policies #6-10)


═══════════════════════════════════════════════════════════════════════════════

🧩 HOW POLICIES INTERACT
═══════════════════════════════════════════════════════════════════════════════

POLICY #1 (Sandbox) ←→ POLICY #6 (Network)
  Connection: Docker execution requires network isolation
  Interaction: Sandbox runner uses network policy
  
POLICY #2 (Sensitive Files) ←→ POLICY #3 (Risk Engine)
  Connection: Sensitive files increase risk score
  Interaction: Risk engine weights sensitive file detection
  
POLICY #3 (Risk) ←→ POLICY #10 (Autonomy)
  Connection: Risk thresholds adjusted by autonomy mode
  Interaction: Autonomy mode multiplies risk thresholds
  
POLICY #4 (Destructive) ←→ POLICY #3 (Risk)
  Connection: Destructive commands have high risk scores
  Interaction: Risk engine considers destructive patterns
  
POLICY #5 (Loop) ←→ POLICY #3 (Risk)
  Connection: Loop detection contributes to risk scoring
  Interaction: Risk engine factors in loop likelihood
  
POLICY #7 (Skill) ←→ POLICY #8 (RBAC)
  Connection: Skill trust + role determines behavior
  Interaction: Combined permission model
  
POLICY #9 (Audit) ←→ ALL OTHERS
  Connection: Logs decisions from all policies
  Interaction: Central audit trail for all actions
  

═══════════════════════════════════════════════════════════════════════════════

⚙️  CONFIGURATION IMPACT ON INTEGRATION
═══════════════════════════════════════════════════════════════════════════════

opencode.json settings affect how policies integrate:

security.risk_policy = "static" | "dynamic" | "hybrid"
  → Controls Policy #3 (Risk Engine) behavior

security.execution_mode = "host" | "sandbox"
  → Controls Policy #1 (Sandbox) mode

security.network.mode = "allow" | "deny" | "allowlist"
  → Controls Policy #6 (Network Guard) mode

agent_autonomy.mode = "supervised" | "semi" | "fully_autonomous"
  → Controls Policy #10 (Autonomy) multipliers

security.user_role = admin | developer | readonly | autonomous_agent
  → Controls Policy #8 (RBAC) checks


═══════════════════════════════════════════════════════════════════════════════

🔄 POLICY SEQUENCING
═══════════════════════════════════════════════════════════════════════════════

Why This Order Matters:

1. DESTRUCTIVE FIRST
   ├─ Destructive commands are most dangerous
   ├─ Should be caught before anything else
   └─ No reason to do expensive checks if we'll deny anyway

2. THEN SENSITIVE FILES
   ├─ Quick pattern matching (fast)
   └─ Feeds into risk scoring for gate 3

3. THEN RISK SCORING
   ├─ More expensive operation
   ├─ Uses multiple factors
   └─ Can block or require approval

4. THEN LOOP DETECTION
   ├─ Stateful check
   └─ Only if not already blocked

5. FINALLY EXECUTE
   ├─ If all gates passed
   └─ With appropriate execution mode


═══════════════════════════════════════════════════════════════════════════════

📈 POLICY ACTIVATION FLOWCHART
═══════════════════════════════════════════════════════════════════════════════

┌───────────────────────────────────────┐
│  Command arrives at bash.ts            │
└────────────┬────────────────────────────┘
             │
             ↓
        ┌─────────────────────────────┐
        │ Load config + init systems   │ ← Configuration
        └────────────┬────────────────┘
                     │
                     ↓
            ┌──────────────────────┐
            │ Policy #4 (Destructive)│
            │ IS pattern?           │
            └──┬──────────┬─────────┘
       YES  │            │ NO
           ↓             ↓
        BLOCK      ┌──────────────────────┐
                   │ Policy #2 (Sensitive) │
                   │ Files touched?       │
                   └──┬──────────┬────────┘
                NO  │            │ YES
                    │        Increase risk
                    ↓             │
            ┌──────────────────────────┐
            │ Policy #3 (Risk Engine)  │
            │ Score >= threshold?      │
            └──┬──────┬────────────┬──┘
         DENY │        │ASK         │ ALLOW
              ↓        ↓            ↓
           BLOCK    ASK USER    ┌──────────────────────┐
                    APPROVAL    │ Policy #5 (Loop Det) │
                                │ Loop likely?         │
                                └──┬──────┬────────────┘
                            NO  │      │ YES
                               ↓       ↓
                        Execute  ASK USER
                                APPROVAL
                                    │
                                    ↓
                        If approved:
                                    │
                    ┌───────────────┴──────────────┐
                    ↓                              ↓
            ┌──────────────────────┐  ┌────────────────────┐
            │ Policy #1 (Sandbox)  │  │ Policy #6 (Network)│
            │ Execute in sandbox?  │  │ Check domain       │
            └──────────┬───────────┘  └────────┬───────────┘
                       │                       │
                       └───────────┬───────────┘
                                   ↓
                        EXECUTE COMMAND
                                   │
                    ┌──────────────┴──────────────┐
                    ↓                             ↓
            ┌──────────────────────┐  ┌─────────────────────┐
            │ Policy #9 (Audit)    │  │ Policy #7/#8 (Trust)│
            │ Log decision + result │  │ Record permissions  │
            └──────────────────────┘  └─────────────────────┘
                    │                             │
                    └──────────────┬──────────────┘
                                   ↓
                        RETURN RESULT TO USER


═══════════════════════════════════════════════════════════════════════════════

💡 KEY INTEGRATION INSIGHTS
═══════════════════════════════════════════════════════════════════════════════

1. LAYERED DEFENSE
   → Multiple gates catch different types of issues
   → Early exit on dangerous operations
   → Expensive checks only when necessary

2. CONFIGURATION-DRIVEN
   → All gate behavior configured in opencode.json
   → Can adjust without code changes
   → Different configs for different deployments

3. NON-BLOCKING LOGGING
   → Audit logger runs in background
   → Doesn't block execution
   → Tamper-proof trail for compliance

4. FLEXIBLE AUTONOMY
   → Same code runs in different autonomy modes
   → Risk multipliers adjust thresholds
   → Admin can override when needed

5. ROLE-BASED CUSTOMIZATION
   → Admin sees everything
   → Developer sees some things
   → ReadOnly sees monitoring only
   └─ Same code, different permissions


═══════════════════════════════════════════════════════════════════════════════

🔐 SECURITY ASSUMPTIONS
═══════════════════════════════════════════════════════════════════════════════

This integration assumes:
  ✓ bash.ts is the ONLY command execution tool
  ✓ Configuration is trusted (not user-modifiable)
  ✓ Audit logs are stored securely
  ✓ Only authorized users can modify policies
  ✓ Bun/Node runtime is patched


═══════════════════════════════════════════════════════════════════════════════

✅ VERIFICATION CHECKLIST
═══════════════════════════════════════════════════════════════════════════════

To verify integration is working:

☐ All 10 policies load without errors
☐ bash.ts imports all security modules
☐ Gates execute in correct order
☐ Audit logs are created
☐ Risk scoring works (0-100)
☐ Sandbox mode activates when configured
☐ Network checks work
☐ Tests pass (71+ cases)


═══════════════════════════════════════════════════════════════════════════════

NEXT STEP: Review reference-documentation/ for detailed explanations

═══════════════════════════════════════════════════════════════════════════════
