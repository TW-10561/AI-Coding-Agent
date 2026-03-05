🔧 ACTUAL IMPLEMENTATION - WHERE THE CODE LIVES
═══════════════════════════════════════════════════════════════════════════════

This folder documents where the REAL implementation of all 10 security policies
lives in the codebase.


📍 IMPORTANT: This is not copies of files, but a MAP to where they actually are.
═══════════════════════════════════════════════════════════════════════════════


🗺️  IMPLEMENTATION MAP
═══════════════════════════════════════════════════════════════════════════════

All 10 security policy implementations are located in:

    AI-Coding-Agent/packages/opencode/src/


POLICY #1: EXECUTION SANDBOX
────────────────────────────────────────────────────────────────────────────
  File:     sandbox/sandboxRunner.ts
  Path:     packages/opencode/src/sandbox/sandboxRunner.ts
  Purpose:  Host vs Docker execution with resource limits
  Export:   HostRunner, DockerRunner, SandboxRunnerFactory
  Status:   ✅ Implemented & Tested


POLICY #2: SENSITIVE FILE PROTECTION
────────────────────────────────────────────────────────────────────────────
  File:     security/sensitiveFiles.ts
  Path:     packages/opencode/src/security/sensitiveFiles.ts
  Purpose:  Detect .env, SSH keys, credentials (54 patterns)
  Export:   isSensitive(), getSensitivePatterns()
  Status:   ✅ Implemented & Tested


POLICY #3: RISK-BASED PERMISSION SYSTEM
────────────────────────────────────────────────────────────────────────────
  File:     permission/riskEngine.ts
  Path:     packages/opencode/src/permission/riskEngine.ts
  Purpose:  Dynamic risk scoring (0-100 scale)
  Export:   RiskEngine, RiskContext, RiskAssessment
  Status:   ✅ Implemented & Tested


POLICY #4: DESTRUCTIVE ACTION GUARDRAIL
────────────────────────────────────────────────────────────────────────────
  File:     security/destructiveGuard.ts
  Path:     packages/opencode/src/security/destructiveGuard.ts
  Purpose:  Pre-check for rm -rf, chmod 777, DROP DATABASE, etc.
  Export:   isDestructive(), getSeverityLevel()
  Status:   ✅ Implemented & Tested


POLICY #5: LOOP DETECTION v2
────────────────────────────────────────────────────────────────────────────
  File:     agent/loopGuard.ts
  Path:     packages/opencode/src/agent/loopGuard.ts
  Purpose:  Command/error repetition detection
  Export:   LoopGuard
  Status:   ✅ Implemented & Tested


POLICY #6: NETWORK ACCESS POLICY
────────────────────────────────────────────────────────────────────────────
  File:     security/networkGuard.ts
  Path:     packages/opencode/src/security/networkGuard.ts
  Purpose:  Allow/deny/allowlist modes for network
  Export:   NetworkGuard, NetworkPolicy
  Status:   ✅ Implemented & Tested


POLICY #7: SKILL-LEVEL TRUST SYSTEM
────────────────────────────────────────────────────────────────────────────
  File:     security/skillTrust.ts
  Path:     packages/opencode/src/security/skillTrust.ts
  Purpose:  Component-level trust management (3 levels)
  Export:   SkillTrustManager, SkillTrustLevel
  Status:   ✅ Implemented & Tested


POLICY #8: ROLE-BASED ACCESS CONTROL
────────────────────────────────────────────────────────────────────────────
  File:     security/rbac.ts
  Path:     packages/opencode/src/security/rbac.ts
  Purpose:  4 roles with permission matrices
  Export:   RBACEngine, Role
  Status:   ✅ Implemented & Tested


POLICY #9: AUDIT LOGGING
────────────────────────────────────────────────────────────────────────────
  File:     audit/auditLogger.ts
  Path:     packages/opencode/src/audit/auditLogger.ts
  Purpose:  Tamper-evident audit trail (JSONL + hash chain)
  Export:   AuditLogger
  Status:   ✅ Implemented & Fixed for test environments


POLICY #10: AGENT AUTONOMY MODES
────────────────────────────────────────────────────────────────────────────
  File:     agent/autonomy.ts
  Path:     packages/opencode/src/agent/autonomy.ts
  Purpose:  Supervised/semi/fully autonomous control
  Export:   AgentAutonomyController
  Status:   ✅ Implemented & Tested


CENTRAL INTEGRATION POINT
────────────────────────────────────────────────────────────────────────────
  File:     tool/bash.ts
  Path:     packages/opencode/src/tool/bash.ts
  Purpose:  Orchestrates all 10 policies in sequence
  Status:   ✅ Enhanced with 350+ lines of security integration
  
  Integration Order:
    1. Load configuration
    2. Initialize all security systems
    3. Destructive command check
    4. Sensitive file detection
    5. Risk assessment
    6. Loop detection
    7. Execute (host or sandbox)
    8. Audit and report


═══════════════════════════════════════════════════════════════════════════════

📊 IMPLEMENTATION STATISTICS
═══════════════════════════════════════════════════════════════════════════════

Number of Files:          11 (10 policies + bash.ts integration)
Total Lines:              ~1500 lines
Implementation Size:      ~100 KB
Test Cases:               71+ comprehensive tests
Test File:                packages/opencode/test/security/securityPolicies.test.ts


═══════════════════════════════════════════════════════════════════════════════

🔍 HOW TO VIEW THE ACTUAL CODE
═══════════════════════════════════════════════════════════════════════════════

To view the actual implementation:

1. Navigate to the opencode package:
   $ cd AI-Coding-Agent/packages/opencode

2. View the source code:
   $ ls -la src/

3. View a specific policy:
   $ cat src/security/sensitiveFiles.ts

4. View the integration:
   $ cat src/tool/bash.ts

5. View tests:
   $ cat test/security/securityPolicies.test.ts


═══════════════════════════════════════════════════════════════════════════════

⚙️  BUILD & COMPILATION
═══════════════════════════════════════════════════════════════════════════════

Language:         TypeScript
Runtime:          Node.js / Bun
Build System:     Bun / NPM
Compilation:      TypeScript → JavaScript

The policies are part of the @opencode package and are compiled as part of
the standard build process.


═══════════════════════════════════════════════════════════════════════════════

🧪 TESTING THE IMPLEMENTATION
═══════════════════════════════════════════════════════════════════════════════

Test Suite Location:
  packages/opencode/test/security/securityPolicies.test.ts

Run tests from:
  $ cd packages/opencode
  $ npm run test -- test/security/securityPolicies.test.ts

Expected Results:
  ✅ 71+ tests pass
  ✅ Full coverage of all 10 policies
  ✅ Integration tests verify they work together


═══════════════════════════════════════════════════════════════════════════════

🚀 DEPLOYMENT
═══════════════════════════════════════════════════════════════════════════════

The implementation is deployed as part of the standard @opencode package.

To deploy:
1. Choose a configuration (max-security, production, development)
2. Place in opencode.json
3. Run the agent normally
4. Security policies integrate automatically

See: SECURITY_POLICIES_ARCHITECTURE/configuration/ for templates


═══════════════════════════════════════════════════════════════════════════════

✅ KEY POINTS
═══════════════════════════════════════════════════════════════════════════════

✓ This is the PRODUCTION CODE
  → These files are actively used by the agent every day

✓ All 10 policies are FULLY IMPLEMENTED
  → Each policy is a complete, tested, self-contained module

✓ They are INTEGRATED into bash.ts
  → The integration point where execution happens

✓ All policies are TESTED
  → 71+ comprehensive tests cover all scenarios

✓ They are CONFIGURABLE
  → Configuration controls behavior without code changes

✓ They are AUDITED
  → Every decision is logged and verified


═══════════════════════════════════════════════════════════════════════════════

📖 FINDING YOUR WAY
═══════════════════════════════════════════════════════════════════════════════

If you want to...                    Do this:
─────────────────────────────────────────────────────────────────────────────
View the source code                 Go to packages/opencode/src/
Understand a policy                  Read the policy file + tests
See how they integrate               Look at bash.ts
Run the tests                        npm run test (in packages/opencode)
Configure the policies               See configuration/ folder
Learn more details                   See reference-documentation/


═══════════════════════════════════════════════════════════════════════════════

❓ FREQUENTLY ASKED QUESTIONS
═══════════════════════════════════════════════════════════════════════════════

Q: Where is the actual code?
A: packages/opencode/src/ (in the main codebase)

Q: Are these copies or the real thing?
A: These are the REAL implementations in packages/opencode/

Q: Can I modify them?
A: Yes, they're in the source tree. Modifications affect the actual agent.

Q: How do I test them?
A: Run npm test from packages/opencode directory

Q: Where's the integration point?
A: packages/opencode/src/tool/bash.ts (the command execution tool)

Q: How are they configured?
A: Via opencode.json configuration file

Q: What if Bun isn't available?
A: Use the Node.js test runner or install Bun


═══════════════════════════════════════════════════════════════════════════════

NEXT STEPS
═══════════════════════════════════════════════════════════════════════════════

1. Review the implementation map above
2. Visit packages/opencode/src/ to see actual code
3. Check reference-documentation/ for detailed guides
4. Run tests to verify everything works
5. Use configuration/ templates for deployment


═══════════════════════════════════════════════════════════════════════════════
