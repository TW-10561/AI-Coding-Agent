╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║            🔐 SECURITY POLICIES ARCHITECTURE - CLEAR STRUCTURE               ║
║                                                                              ║
║              Complete Guide to All 10 Security Policies                     ║
║              With Clear Separation of Implementation vs Documentation        ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝


📍 LOCATION
═══════════════════════════════════════════════════════════════════════════════

/AGENT/SECURITY_POLICIES_ARCHITECTURE/


📂 FOLDER STRUCTURE
═══════════════════════════════════════════════════════════════════════════════

SECURITY_POLICIES_ARCHITECTURE/
│
├── 📄 README.md                       (This file - Start here)
│
├── 🔧 actual-implementation/          ✅ THE REAL CODE (What Actually Runs)
│   ├── IMPLEMENTATION_MAP.md           Where each policy lives
│   ├── INTEGRATION_GUIDE.md            How they integrate in bash.ts
│   └── SYMLINKS_TO_SOURCE.txt          Pointers to actual files in packages/opencode
│
├── 📚 reference-documentation/        📖 Guides & Explanations (For Understanding)
│   ├── 10-POLICIES-OVERVIEW.md        All 10 policies explained
│   ├── DEPLOYMENT-GUIDE.md            How to deploy them
│   ├── ARCHITECTURE-DIAGRAMS.txt      Visual diagrams
│   └── TROUBLESHOOTING.md             Common issues & solutions
│
├── ⚙️  configuration/                 🎛️  Configuration Templates & Examples
│   ├── max-security.json              Max protection config
│   ├── production.json                Balanced config
│   ├── development.json               Development config
│   └── CONFIG-GUIDE.md                How to configure
│
└── 📊 architecture-diagrams/          Visual representations
    ├── security-flow.txt              Execution flow
    ├── policy-relationships.txt       How policies interact
    └── integration-points.txt         Where policies connect


══════════════════════════════════════════════════════════════════════════════

🎯 QUICK NAVIGATION
══════════════════════════════════════════════════════════════════════════════

I want to...                           Read this file first:
──────────────────────────────────────────────────────────────────────────────
Understand the big picture             reference-documentation/10-POLICIES-OVERVIEW.md
See where code actually is             actual-implementation/IMPLEMENTATION_MAP.md
Deploy the security policies           reference-documentation/DEPLOYMENT-GUIDE.md
Configure for my environment           configuration/CONFIG-GUIDE.md
Debug an issue                         reference-documentation/TROUBLESHOOTING.md
Visualize how it works                 architecture-diagrams/security-flow.txt
Understand the architecture            reference-documentation/ARCHITECTURE-DIAGRAMS.txt


══════════════════════════════════════════════════════════════════════════════

✨ THE THREE LAYERS
══════════════════════════════════════════════════════════════════════════════

LAYER 1: ACTUAL IMPLEMENTATION (THE REAL CODE)
──────────────────────────────────────────────────────────────

This is where the code ACTUALLY RUNS. These are the real files that be
part of the agent's operation.

Location: AI-Coding-Agent/packages/opencode/src/

Files:
  • sandbox/sandboxRunner.ts           (Policy #1: Execution Sandbox)
  • security/sensitiveFiles.ts         (Policy #2: Sensitive Files)
  • permission/riskEngine.ts           (Policy #3: Risk-Based Permission)
  • security/destructiveGuard.ts       (Policy #4: Destructive Actions)
  • agent/loopGuard.ts                 (Policy #5: Loop Detection)
  • security/networkGuard.ts           (Policy #6: Network Access)
  • security/skillTrust.ts             (Policy #7: Skill Trust)
  • security/rbac.ts                   (Policy #8: RBAC)
  • audit/auditLogger.ts               (Policy #9: Audit Logging)
  • agent/autonomy.ts                  (Policy #10: Autonomy Modes)
  • tool/bash.ts                       (INTEGRATION: Orchestrates all 10)

Status: ✅ ACTIVE - This is what runs the agent
Updated: With security policies integrated
Tested: 71+ test cases in place


LAYER 2: REFERENCE DOCUMENTATION (FOR UNDERSTANDING)
──────────────────────────────────────────────────────────────

These are guides, explanations, and documentation to help you understand
the security policies.

Location: AI-Coding-Agent/AGENT/SECURITY_POLICIES_ARCHITECTURE/
          reference-documentation/

Contents:
  • 10-POLICIES-OVERVIEW.md            Detailed explanation of all 10
  • DEPLOYMENT-GUIDE.md                Step-by-step deployment
  • ARCHITECTURE-DIAGRAMS.txt          Visual flow diagrams
  • TROUBLESHOOTING.md                 Common issues & solutions

Also available:
  • AI-Coding-Agent/security-policies/ (Comprehensive reference folder)

Purpose: Understanding and learning
Status: ✅ COMPLETE - 2000+ lines of documentation


LAYER 3: CONFIGURATION & DEPLOYMENT (FOR OPERATIONS)
──────────────────────────────────────────────────────────────

Templates and guides for configuring and deploying the security policies.

Location: AI-Coding-Agent/AGENT/SECURITY_POLICIES_ARCHITECTURE/
          configuration/

Contents:
  • max-security.json                  Highest protection
  • production.json                    Balanced
  • development.json                   Development/testing
  • CONFIG-GUIDE.md                    Configuration options

Purpose: Deploy and configure the policies
Status: ✅ READY - 3 templates provided


══════════════════════════════════════════════════════════════════════════════

🗺️  DETAILED MAP OF ALL COMPONENTS
══════════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────────┐
│                         ACTUAL IMPLEMENTATION                               │
│                   (packages/opencode/src/ - L1)                            │
└─────────────────────────────────────────────────────────────────────────────┘

  1️⃣  EXECUTION SANDBOX
      File:     sandbox/sandboxRunner.ts
      Purpose:  Host vs Docker execution with resource limits
      Lines:    ~150
      Status:   ✅ Implemented & Tested

  2️⃣  SENSITIVE FILE PROTECTION
      File:     security/sensitiveFiles.ts
      Purpose:  Detect .env, SSH keys, credentials (54 patterns)
      Lines:    ~100
      Status:   ✅ Implemented & Tested

  3️⃣  RISK-BASED PERMISSION SYSTEM
      File:     permission/riskEngine.ts
      Purpose:  Dynamic risk scoring (0-100 scale)
      Lines:    ~250
      Status:   ✅ Implemented & Tested

  4️⃣  DESTRUCTIVE ACTION GUARDRAIL
      File:     security/destructiveGuard.ts
      Purpose:  Pre-check for rm -rf, chmod 777, etc.
      Lines:    ~120
      Status:   ✅ Implemented & Tested

  5️⃣  LOOP DETECTION v2
      File:     agent/loopGuard.ts
      Purpose:  Command/error repetition detection
      Lines:    ~200
      Status:   ✅ Implemented & Tested

  6️⃣  NETWORK ACCESS POLICY
      File:     security/networkGuard.ts
      Purpose:  Allow/deny/allowlist modes for network
      Lines:    ~150
      Status:   ✅ Implemented & Tested

  7️⃣  SKILL-LEVEL TRUST SYSTEM
      File:     security/skillTrust.ts
      Purpose:  Component-level trust management
      Lines:    ~180
      Status:   ✅ Implemented & Tested

  8️⃣  ROLE-BASED ACCESS CONTROL
      File:     security/rbac.ts
      Purpose:  4 roles (admin, developer, readonly, autonomous_agent)
      Lines:    ~160
      Status:   ✅ Implemented & Tested

  9️⃣  AUDIT LOGGING
      File:     audit/auditLogger.ts
      Purpose:  Tamper-evident audit trail
      Lines:    ~250
      Status:   ✅ Implemented & Tested (Fixed for test env)

  🔟 AGENT AUTONOMY MODES
      File:     agent/autonomy.ts
      Purpose:  Supervised/semi/fully autonomous control
      Lines:    ~200
      Status:   ✅ Implemented & Tested

  🔗 INTEGRATION ORCHESTRATOR
      File:     tool/bash.ts
      Purpose:  Central point that uses all 10 policies
      Lines:    ~350 (additions for security)
      Status:   ✅ Implemented & Integrated


┌─────────────────────────────────────────────────────────────────────────────┐
│                    REFERENCE DOCUMENTATION                                  │
│              (SECURITY_POLICIES_ARCHITECTURE/reference-../ - L2)           │
└─────────────────────────────────────────────────────────────────────────────┘

  10-POLICIES-OVERVIEW.md
    ├─ Policy 1: Execution Sandbox         What it does, how it works
    ├─ Policy 2: Sensitive Files           54 patterns explained
    ├─ Policy 3: Risk Scoring              Algorithm details
    ├─ Policy 4: Destructive Actions       Dangerous patterns
    ├─ Policy 5: Loop Detection            Loop detection algorithm
    ├─ Policy 6: Network Access            3 modes explained
    ├─ Policy 7: Skill Trust               Trust levels
    ├─ Policy 8: RBAC                      4 roles & permissions
    ├─ Policy 9: Audit Logging             Logging structure
    └─ Policy 10: Autonomy Modes           3 autonomy modes

  DEPLOYMENT-GUIDE.md
    ├─ Step 1: Understand the policies
    ├─ Step 2: Choose configuration
    ├─ Step 3: Deploy to your environment
    ├─ Step 4: Verify with tests
    └─ Step 5: Monitor audit logs

  ARCHITECTURE-DIAGRAMS.txt
    ├─ Execution flow diagram
    ├─ Policy interaction diagram
    ├─ Data flow diagram
    └─ Integration points diagram

  TROUBLESHOOTING.md
    ├─ Common issues & fixes
    ├─ Performance optimization
    ├─ Configuration problems
    └─ Debugging guides


┌─────────────────────────────────────────────────────────────────────────────┐
│                   CONFIGURATION & DEPLOYMENT                                │
│              (SECURITY_POLICIES_ARCHITECTURE/configuration/ - L3)          │
└─────────────────────────────────────────────────────────────────────────────┘

  max-security.json
    ├─ Sandbox: enabled
    ├─ Risk thresholds: strict (70/40)
    ├─ Network: allowlist
    ├─ User role: readonly
    └─ Autonomy: supervised

  production.json
    ├─ Sandbox: disabled (host mode)
    ├─ Risk thresholds: moderate (80/50)
    ├─ Network: allow with deny list
    ├─ User role: developer
    └─ Autonomy: semi-autonomous

  development.json
    ├─ Sandbox: disabled
    ├─ Risk thresholds: relaxed (90/70)
    ├─ Network: unrestricted
    ├─ User role: admin
    └─ Autonomy: fully autonomous

  CONFIG-GUIDE.md
    ├─ Configuration options reference
    ├─ How to customize each option
    ├─ Performance tuning guide
    └─ Best practices


══════════════════════════════════════════════════════════════════════════════

🔄 HOW THE THREE LAYERS WORK TOGETHER
══════════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  LAYER 1                                                                    │
│  You want to deploy                                                         │
│  the security policies                                      LAYER 2        │
│  ↓                                                          ↓              │
│  ┌──────────────────────┐         ┌──────────────────────┬──────────────┐ │
│  │  ACTUAL             │         │  REFERENCE           │ UNDERSTAND:  │ │
│  │  IMPLEMENTATION     │ ←────── │  DOCUMENTATION       │ • How they  │ │
│  │                    │  Learn   │                      │   work      │ │
│  │ packages/opencode/  │  from   │ SECURITY_POLICIES_   │ • Why they  │ │
│  │ src/                │         │ ARCHITECTURE/        │   exist     │ │
│  │                    │         │ reference-docs/      │ • How to    │ │
│  │ ✅ Real code       │         │                      │   deploy    │ │
│  │ ✅ Running daily   │         │ ✅ Educational       │             │ │
│  │ ✅ In production   │         │ ✅ Comprehensive     │ LAYER 3     │ │
│  │                    │         │ ✅ Clear            │ ↓           │ │
│  └──────────────────────┘       │                      │ CONFIGURE & │ │
│         ↑                       │                      │ DEPLOY:     │ │
│         │                       └──────────────────────┤ • Pick a   │ │
│         │                           ↑                 │   template  │ │
│         └───────────────────────────┘                 │ • Customize │ │
│      Configured and                                   │ • Deploy    │ │
│      managed by                                       │             │ │
│                                                       │ CONFIGURATION│ │
│      ┌─────────────────────────────────────────────-┬──────────────┘ │
│      │                                              │                 │
│      │  /AGENT/SECURITY_POLICIES_ARCHITECTURE/   │                 │
│      │  configuration/                            │                 │
│      └────────────────────────────────────────────┘                 │
│         • max-security.json                                          │
│         • production.json                                            │
│         • development.json                                           │
│                                                                       │
└─────────────────────────────────────────────────────────────────────────────┘


WORKFLOW SUMMARY:
─────────────────

1. READ (Layer 2): Understanding
   → Check reference-documentation/ to understand what you're deploying

2. CONFIGURE (Layer 3): Preparation
   → Pick or customize a configuration from configuration/

3. DEPLOY (Layer 1): Execution
   → Deploy using the actual implementation in packages/opencode/

4. VERIFY: Testing
   → Run tests to ensure everything works

5. MONITOR: Operations
   → Check audit logs for security events


══════════════════════════════════════════════════════════════════════════════

📊 STATISTICS BY LAYER
══════════════════════════════════════════════════════════════════════════════

LAYER 1 - ACTUAL IMPLEMENTATION
  Files:           11 (10 policies + integration)
  Total Lines:     1500+ lines
  Size:            ~100 KB
  Status:          ✅ ACTIVE & RUNNING
  Location:        packages/opencode/src/

LAYER 2 - REFERENCE DOCUMENTATION
  Files:           4+ guides
  Total Lines:     2000+ lines
  Size:            ~200 KB
  Status:          ✅ COMPREHENSIVE
  Location:        SECURITY_POLICIES_ARCHITECTURE/reference-documentation/

LAYER 3 - CONFIGURATION
  Files:           3 templates + guide
  Size:            ~10 KB
  Status:          ✅ READY TO USE
  Location:        SECURITY_POLICIES_ARCHITECTURE/configuration/


══════════════════════════════════════════════════════════════════════════════

🎓 LEARNING PATH
══════════════════════════════════════════════════════════════════════════════

For Different Roles:

EXECUTIVE/MANAGER (5 min)
  1. Read: reference-documentation/10-POLICIES-OVERVIEW.md
  2. Skim: reference-documentation/DEPLOYMENT-GUIDE.md

DEVELOPER (30 min)
  1. Read: actual-implementation/IMPLEMENTATION_MAP.md
  2. Read: reference-documentation/ARCHITECTURE-DIAGRAMS.txt
  3. Check: actual-implementation/INTEGRATION_GUIDE.md

SECURITY ENGINEER (60 min)
  1. Deep read: reference-documentation/10-POLICIES-OVERVIEW.md
  2. Study: Each policy file in packages/opencode/src/
  3. Review: reference-documentation/TROUBLESHOOTING.md

OPERATOR/DEVOPS (45 min)
  1. Read: reference-documentation/DEPLOYMENT-GUIDE.md
  2. Choose: configuration/*.json template
  3. Review: configuration/CONFIG-GUIDE.md

QA/TESTER (30 min)
  1. Check: packages/opencode/test/security/securityPolicies.test.ts
  2. Read: reference-documentation/TROUBLESHOOTING.md
  3. Verify: 71+ tests pass


══════════════════════════════════════════════════════════════════════════════

✅ QUICK CHECKLIST
══════════════════════════════════════════════════════════════════════════════

Understanding:
  ☐ Read 10-POLICIES-OVERVIEW.md
  ☐ Understand IMPLEMENTATION_MAP.md
  ☐ Review architecture diagrams

Configuration:
  ☐ Choose appropriate config template
  ☐ Customize for your environment
  ☐ Review CONFIG-GUIDE.md

Deployment:
  ☐ Follow DEPLOYMENT-GUIDE.md
  ☐ Run security policy tests
  ☐ Verify audit logging works

Operations:
  ☐ Monitor .opencode/audit/audit.log.jsonl
  ☐ Review logs regularly
  ☐ Adjust thresholds as needed


══════════════════════════════════════════════════════════════════════════════

📍 QUICK FILE REFERENCE
══════════════════════════════════════════════════════════════════════════════

To view...                              Go to:
──────────────────────────────────────────────────────────────────────────────
Source code of all 10 policies         packages/opencode/src/
Actual integration point               packages/opencode/src/tool/bash.ts
Complete documentation                 security-policies/ (separate folder)
Architecture overview                  SECURITY_POLICIES_ARCHITECTURE/
Reference guides                       SECURITY_POLICIES_ARCHITECTURE/reference-documentation/
Test suite                             packages/opencode/test/security/
Configuration templates                SECURITY_POLICIES_ARCHITECTURE/configuration/
Deployment information                 reference-documentation/DEPLOYMENT-GUIDE.md


══════════════════════════════════════════════════════════════════════════════

🎉 CONCLUSION
══════════════════════════════════════════════════════════════════════════════

The security policies are organized in THREE CLEAR LAYERS:

1️⃣  ACTUAL IMPLEMENTATION (packages/opencode/src/)
    ↓
    Real code that runs the agent's security

2️⃣  REFERENCE DOCUMENTATION (SECURITY_POLICIES_ARCHITECTURE/)
    ↓
    For understanding, learning, and planning

3️⃣  CONFIGURATION & DEPLOYMENT (SECURITY_POLICIES_ARCHITECTURE/configuration/)
    ↓
    For deploying to your environment

Each layer serves a different purpose. Use them together for:
  ✅ Clear Understanding
  ✅ Confident Deployment
  ✅ Effective Operations
  ✅ Proper Maintenance


START HERE → README.md in each subfolder


═══════════════════════════════════════════════════════════════════════════════
