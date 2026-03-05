⚙️ CONFIGURATION & DEPLOYMENT
═══════════════════════════════════════════════════════════════════════════════

Ready-to-use configuration templates and deployment guides.


📋 CONFIGURATION TEMPLATES
═══════════════════════════════════════════════════════════════════════════════

Three pre-configured templates for different deployment scenarios:


1️⃣ max-security.json
   ├─ Purpose: Highest protection
   ├─ Use case: Untrusted environments, critical operations
   ├─ Key settings:
   │  ├─ Sandbox: enabled
   │  ├─ Risk deny threshold: 70
   │  ├─ Risk ask threshold: 40
   │  ├─ Network mode: allowlist
   │  ├─ User role: readonly
   │  └─ Autonomy: supervised
   └─ Security level: MAXIMUM


2️⃣ production.json
   ├─ Purpose: Balanced production use
   ├─ Use case: Normal operations, trusted teams
   ├─ Key settings:
   │  ├─ Sandbox: disabled (host mode)
   │  ├─ Risk deny threshold: 80
   │  ├─ Risk ask threshold: 50
   │  ├─ Network mode: allow with deny patterns
   │  ├─ User role: developer
   │  └─ Autonomy: semi-autonomous
   └─ Security level: BALANCED


3️⃣ development.json
   ├─ Purpose: Development and testing
   ├─ Use case: Local dev, fast iteration
   ├─ Key settings:
   │  ├─ Sandbox: disabled
   │  ├─ Risk deny threshold: 90
   │  ├─ Risk ask threshold: 70
   │  ├─ Network mode: unrestricted
   │  ├─ User role: admin
   │  └─ Autonomy: fully autonomous
   └─ Security level: MINIMAL


═══════════════════════════════════════════════════════════════════════════════

🚀 QUICK START DEPLOYMENT
═══════════════════════════════════════════════════════════════════════════════

Step 1: Choose a template
  $ cat max-security.json           (or production.json or development.json)

Step 2: Copy to opencode.json
  $ cp production.json > opencode.json

Step 3: Customize if needed
  $ vi opencode.json                (edit as needed)

Step 4: Verify configuration
  $ see CONFIG-GUIDE.md for all options

Step 5: Deploy
  $ Agent will use these settings automatically

Step 6: Monitor
  $ tail -f .opencode/audit/audit.log.jsonl


═══════════════════════════════════════════════════════════════════════════════

📊 CONFIGURATION COMPARISON
═══════════════════════════════════════════════════════════════════════════════

Setting                 Max-Security    Production      Development
──────────────────────────────────────────────────────────────────────────────
Sandbox Enabled         YES             NO              NO
Execution Mode          sandbox         host            host
Risk Deny (≥)           70              80              90
Risk Ask (≥)            40              50              70
Network Mode            allowlist       allow           allow
Network Deny Patterns   many            some            none
Sensitive Files         block           warn            none
User Role               readonly        developer       admin
Autonomy Mode           supervised      semi            fully
Max Iterations          5               10              20
Approval Required       always high risk sometimes      rarely


═══════════════════════════════════════════════════════════════════════════════

⚙️  CONFIGURATION FILE STRUCTURE
═══════════════════════════════════════════════════════════════════════════════

{
  "security": {
    "enabled": true,
    "execution_mode": "host|sandbox",
    "risk_policy": "static|dynamic|hybrid",
    "risk_thresholds": {
      "deny": 80,
      "ask": 40
    },
    "sandbox": {
      "memory_limit": "512m",
      "cpu_limit": "1",
      "image_tag": "node:20-alpine"
    },
    "network": {
      "enabled": true,
      "mode": "allow|deny|allowlist",
      "allow_domains": ["github.com", "npmjs.com"],
      "deny_internal": true
    },
    "sensitive_files": {
      "enabled": true,
      "block_on_detect": true
    },
    "loop_detection": {
      "enabled": true,
      "threshold": 50,
      "window_ms": 60000
    },
    "audit_logging": {
      "enabled": true,
      "directory": ".opencode/audit",
      "retention_days": 90
    },
    "user_role": "admin|developer|readonly|autonomous_agent"
  },
  "agent_autonomy": {
    "enabled": true,
    "mode": "supervised|semi_autonomous|fully_autonomous",
    "max_iterations": 10
  }
}


═══════════════════════════════════════════════════════════════════════════════

📍 WHERE TO PUT YOUR CONFIGURATION
═══════════════════════════════════════════════════════════════════════════════

Place your configuration file at one of these locations:

  1. opencode.json (project root)
     → Most common, project-specific settings

  2. ~/.opencode/config.json (user home)
     → User-level settings, overrides project

  3. /etc/opencode/config.json (system)
     → System-wide settings (Linux/Mac)

Priority: User home > Project root > System default


═══════════════════════════════════════════════════════════════════════════════

🎯 CHOOSING THE RIGHT TEMPLATE
═══════════════════════════════════════════════════════════════════════════════

Use MAX-SECURITY if:
  ✓ Operating on untrusted systems
  ✓ Handling sensitive data
  ✓ Critical operations
  ✓ Compliance requirements (SOC2, etc.)
  ✓ High-security environments

Use PRODUCTION if:
  ✓ Normal business operations
  ✓ Trusted team environment
  ✓ Standard deployment
  ✓ Balanced security/usability
  ✓ Most organizations

Use DEVELOPMENT if:
  ✓ Local development
  ✓ Testing policies
  ✓ Learning the system
  ✓ Rapid iteration
  ✓ Dev/test environments only


═══════════════════════════════════════════════════════════════════════════════

🔧 CUSTOMIZATION EXAMPLES
═══════════════════════════════════════════════════════════════════════════════

Example 1: Stricter Risk Thresholds
  {
    "security": {
      "risk_thresholds": {
        "deny": 60,      ← Lower threshold = stricter
        "ask": 30        ← Lower threshold = more approvals
      }
    }
  }

Example 2: Allow Specific Domain
  {
    "security": {
      "network": {
        "mode": "allowlist",
        "allow_domains": [
          "github.com",
          "company.com",    ← Add your domain
          "internal.api"
        ]
      }
    }
  }

Example 3: Change Sandbox Settings
  {
    "security": {
      "sandbox": {
        "memory_limit": "256m",    ← Less memory
        "cpu_limit": "0.5",        ← Less CPU
        "image_tag": "node:18-alpine"
      }
    }
  }

Example 4: Hybrid Risk Policy
  {
    "security": {
      "execution_mode": "sandbox",
      "risk_policy": "hybrid",     ← Dynamic + static
      "risk_thresholds": {
        "deny": 75,
        "ask": 45
      }
    }
  }


═══════════════════════════════════════════════════════════════════════════════

✅ DEPLOYMENT CHECKLIST
═══════════════════════════════════════════════════════════════════════════════

Before deploying to production:

Setup:
  ☐ Choose appropriate template
  ☐ Customize for your environment
  ☐ Create opencode.json in project root
  ☐ Verify file permissions (readable by agent process)

Testing:
  ☐ Run security policy tests (71+ cases)
  ☐ Test each policy individually
  ☐ Test with production-like data
  ☐ Verify audit logging works

Verification:
  ☐ Check .opencode/audit/ directory is writable
  ☐ Verify risk scoring works as expected
  ☐ Test network policies with real domains
  ☐ Test sandbox execution (if enabled)

Documentation:
  ☐ Document why you chose this template
  ☐ Document any customizations
  ☐ Create runbooks for common issues
  ☐ Brief team on configuration

Monitoring:
  ☐ Set up audit log monitoring
  ☐ Create alerts for high-risk operations
  ☐ Plan daily log review
  ☐ Document incident response procedures


═══════════════════════════════════════════════════════════════════════════════

📊 CONFIGURATION VALIDATION
═══════════════════════════════════════════════════════════════════════════════

After deploying, verify:

  ✓ Config file is valid JSON
  ✓ Agent starts successfully
  ✓ No configuration errors in logs
  ✓ Policies are active (check audit logs)
  ✓ Risk scoring works (test with various commands)
  ✓ Approvals required when expected
  ✓ Audit logs are being created


═══════════════════════════════════════════════════════════════════════════════

🚨 TROUBLESHOOTING CONFIGURATION
═══════════════════════════════════════════════════════════════════════════════

Problem: Configuration not being read
  Solution: Check file path, permissions, JSON syntax

Problem: All commands blocked
  Solution: Risk thresholds too strict, lower deny value

Problem: No audit logs created
  Solution: Check .opencode/audit/ permissions, enable logging

Problem: Policies not working
  Solution: Verify config section present, all required fields

See CONFIG-GUIDE.md for detailed options and reference


═══════════════════════════════════════════════════════════════════════════════

📖 DETAILED REFERENCE
═══════════════════════════════════════════════════════════════════════════════

For complete configuration options, see:
  → CONFIG-GUIDE.md


═══════════════════════════════════════════════════════════════════════════════

START HERE → Choose your template, then see CONFIG-GUIDE.md

═══════════════════════════════════════════════════════════════════════════════
