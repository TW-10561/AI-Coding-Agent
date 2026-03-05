📊 ARCHITECTURE DIAGRAMS & VISUAL GUIDES
═══════════════════════════════════════════════════════════════════════════════

Visual representations of the security policy architecture and interactions.


📂 CONTENTS
═══════════════════════════════════════════════════════════════════════════════

This folder contains text-based ASCII diagrams and visualizations:

1. security-flow.txt
   └─ How commands flow through the security gates

2. policy-relationships.txt
   └─ How the 10 policies interact with each other

3. integration-points.txt
   └─ Where policies integrate into bash.ts


═══════════════════════════════════════════════════════════════════════════════

🎯 QUICK NAVIGATION
═══════════════════════════════════════════════════════════════════════════════

Want to understand...                   Read this:
──────────────────────────────────────────────────────────────────────────────
Command execution flow                  security-flow.txt
How policies depend on each other       policy-relationships.txt
Where code connects                     integration-points.txt
Gate ordering                           security-flow.txt → "Execution Order"
Policy interactions                     policy-relationships.txt
Visual architecture                     All three files


═══════════════════════════════════════════════════════════════════════════════

🔄 THE BIG PICTURE
═══════════════════════════════════════════════════════════════════════════════

Command
  ↓
GATE 1: Destructive Check (Policy #4)
  ↓
GATE 2: Sensitive Files (Policy #2)
  ↓
GATE 3: Risk Assessment (Policy #3)
  ↓
GATE 4: Loop Detection (Policy #5)
  ↓
EXECUTE
  ├─ Sandbox (Policy #1)
  ├─ Network (Policy #6)
  └─ Record (Policy #9)
  ↓
RETURN RESULT
  └─ With metadata
    ├─ Risk score (Policy #3)
    ├─ Autonomy info (Policy #10)
    ├─ RBAC status (Policy #8)
    ├─ Trust level (Policy #7)
    └─ Audit ID (Policy #9)


═══════════════════════════════════════════════════════════════════════════════

📊 POLICY DEPENDENCY GRAPH
═══════════════════════════════════════════════════════════════════════════════

         ┌──────────────────────────────────────────┐
         │     Input Command (bash.ts)              │
         └──────────────────┬───────────────────────┘
                            │
                 ┌──────────┴──────────┐
                 ↓                     ↓
          Policy #4             Policy #4
         (Destructive)          (if match)
           Pre-Check              → BLOCK
                 │
                 ↓ (pass)
         Policy #2 (Sensitive Files)
           Pattern Match
                 │
          ┌──────┴──────┐
          ↓             ↓
       FOUND         NOT FOUND
          │              │
     Increase         Continue
      Risk            ↓
          │     Policy #3 (Risk)
          │     Score 0-100
          │          │
          └─────┬────┘
               ↓
         Compare Threshold
            │
    ┌───────┼───────┐
    ↓       ↓       ↓
  DENY    ASK     ALLOW
   │       │       │
   │       │  Policy #5
   │       │  (Loop Check)
   │       │     │
   │   ┌───┴─────┤
   │   ↓         ↓
   │ DENY      ALLOW
   │   │         │
   └───┴─────┬───┘
            ↓
      Execute
       (Policy #1)  Sandbox
       (Policy #6)  Network
            │
       ┌────┴────┐
       ↓         ↓
   Success    Error
       │         │
       └────┬────┘
          ↓
      Policy #9 (Audit Log)
          │
       ┌──┴──┬──┬──┐
       ↓     ↓  ↓  ↓
      #7    #8 #10 Result
    (Trust)(RBAC)(Autonomy)


═══════════════════════════════════════════════════════════════════════════════

🔗 CROSS-POLICY INTERACTIONS
═══════════════════════════════════════════════════════════════════════════════

Policy #1 (Sandbox) ←→ Policy #6 (Network)
  ├─ Sandbox execution needs network settings
  └─ Network guard adapted for sandbox mode

Policy #2 (Sensitive) ←→ Policy #3 (Risk)
  ├─ Sensitive files increase risk score
  ├─ Risk component: "sensitive_files" = +70 points
  └─ Higher score = more likely to block/ask

Policy #3 (Risk) ←→ Policy #10 (Autonomy)
  ├─ Autonomy multiplies risk thresholds
  ├─ Supervised: thresholds x 1.5 (stricter)
  ├─ Semi: thresholds x 1.0 (normal)
  └─ Fully: thresholds x 0.7 (relaxed)

Policy #4 (Destructive) ←→ Policy #3 (Risk)
  ├─ Destructive commands have high base score
  ├─ Pre-check (always blocks if matched)
  └─ Also factors into risk algorithm

Policy #5 (Loop) ←→ Policy #3 (Risk)
  ├─ Loop detection outputs loop score
  └─ Risk engine incorporates as risk factor

Policy #7 (Skill) ←→ Policy #8 (RBAC)
  ├─ Skill trust + user role = final permission
  ├─ Skill level affects allowed behaviors
  └─ Role level affects skill access

Policy #9 (Audit) ← All Others
  ├─ All policies feed audit events to #9
  ├─ Central tamper-evident log
  └─ Records every decision


═══════════════════════════════════════════════════════════════════════════════

👁️  DETAILED DIAGRAMS
═══════════════════════════════════════════════════════════════════════════════

See detailed ASCII diagrams in:

  security-flow.txt
    → Complete command flow with all gates
    → Step-by-step execution
    → Decision points

  policy-relationships.txt
    → How policies depend on each other
    → Information flow between policies
    → Decision ordering

  integration-points.txt
    → Where each policy plugs into bash.ts
    → Code structure
    → Configuration impact


═══════════════════════════════════════════════════════════════════════════════

📈 DATA FLOW
═══════════════════════════════════════════════════════════════════════════════

Configuration (opencode.json)
  ↓
RiskThresholds (Policy #3)
  ├─ deny: 80
  ├─ ask: 40
  └─ Adjusted by autonomy multiplier (Policy #10)
  ↓
Risk Computation
  ├─ Destructive pattern (Policy #4): 30-95
  ├─ Sensitive file (Policy #2): +70
  ├─ Loop likelihood (Policy #5): 20-50
  ├─ Network access (Policy #6): +30
  └─ Final score: 0-100
  ↓
Decision
  ├─ If score >= deny: BLOCK
  ├─ If score >= ask: REQUIRE APPROVAL
  └─ Else: ALLOW


═══════════════════════════════════════════════════════════════════════════════

🔐 SECURITY BOUNDARIES
═══════════════════════════════════════════════════════════════════════════════

Configuration Boundary
  ├─ Policies read from opencode.json
  └─ Assumed to be trusted (not modifiable by attackers)

Execution Boundary
  ├─ All commands must go through bash.ts
  ├─ No side-channel execution
  └─ All decisions logged

Audit Boundary
  ├─ Audit logs are append-only
  ├─ Hash-chained for tamper-evidence
  └─ Cannot be modified after creation


═══════════════════════════════════════════════════════════════════════════════

⚡ PERFORMANCE CONSIDERATIONS
═══════════════════════════════════════════════════════════════════════════════

Policy Execution Order (from fastest to slowest):

  1. Policy #4 (Destructive) - Regex matching (~1ms)
  2. Policy #2 (Sensitive) - Regex matching (~1ms)
  3. Policy #3 (Risk) - Scoring algorithm (~5ms)
  4. Policy #5 (Loop) - History lookup (~2ms)
  5. Policy #1 (Sandbox) - Execution setup (~10ms+)
  6. Policy #9 (Audit) - File I/O (~5-10ms)

Total Overhead: ~25ms average

Fast-fail optimization:
  → Policy #4 checked first (can exit immediately)
  → Policy #3 checked early (most expensive gate)


═══════════════════════════════════════════════════════════════════════════════

🎓 UNDERSTANDING THE DIAGRAMS
═══════════════════════════════════════════════════════════════════════════════

Symbols used in diagrams:

  ┌─┐  Box     = Component/Process
  ├─┤  Divider = Subcategory
  ↓   Arrow    = Flow direction
  ←→  2-way    = Bidirectional interaction
  │   Line     = Flow continuity
  ○   Circle   = Decision point


═══════════════════════════════════════════════════════════════════════════════

✅ NEXT STEPS
═══════════════════════════════════════════════════════════════════════════════

After reviewing these diagrams:

1. Read security-flow.txt
   → Understand how commands execute

2. Read policy-relationships.txt
   → Understand how policies work together

3. Read integration-points.txt
   → Understand code structure

4. Review reference-documentation/
   → Deep understanding of each policy

5. Look at actual code
   → See implementation details


═══════════════════════════════════════════════════════════════════════════════

START HERE → security-flow.txt

═══════════════════════════════════════════════════════════════════════════════
