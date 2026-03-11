# Security System Architecture

## Overview

This folder contains a comprehensive, enterprise-grade security framework for the AI coding agent. It provides 10 integrated security mechanisms organized into 7 functional domains.

## Folder Structure

```
security-system/
├── execution/          # Sandbox & execution isolation
│   ├── sandboxRunner.ts
│   └── index.ts
├── guards/            # Protective mechanisms
│   ├── sensitiveFiles.ts
│   ├── destructiveGuard.ts
│   └── index.ts
├── risk/              # Risk assessment engine
│   ├── riskEngine.ts
│   └── index.ts
├── access-control/    # RBAC & skill trust
│   ├── rbac.ts
│   ├── skillTrust.ts
│   └── index.ts
├── network/           # Network access control
│   ├── networkGuard.ts
│   └── index.ts
├── monitoring/        # Loop detection & audit logging
│   ├── loopGuard.ts
│   ├── auditLogger.ts
│   └── index.ts
├── autonomy/          # Agent autonomy control
│   ├── autonomy.ts
│   └── index.ts
├── index.ts           # Main security system export
└── README.md          # This file
```

## 10 Security Features

### 1. Execution Sandbox (`execution/`)
**Goal**: Run dangerous actions inside isolation instead of host

**Components**:
- `HostRunner`: Direct execution on host (existing behavior)
- `DockerRunner`: Isolated Docker container with limited resources
  - No network access (`--network=none`)
  - Memory limit (512MB default)
  - CPU limit (1 core default)
  - Read-only workspace mount

**Config**:
```json
{
  "security": {
    "execution_mode": "sandbox"
  }
}
```

### 2. Risk-Based Permission System (`risk/`)
**Goal**: Replace static allow/deny with scoring

**Components**:
- `RiskEngine`: Computes risk scores (0-100)
- `RiskContext`: Input for assessment
- `RiskAssessment`: Output with factors and recommendations

**Scoring Factors**:
- Destructive commands: +85-95
- Package installations: +40
- Network requests: +30
- Sensitive files: +70
- Large diffs (10KB+): +50
- File deletion: +40
- Repeated commands: +30
- High error rate: +30
- High iterations: +20

**Thresholds**:
- Score ≥ 80: DENY
- 40-79: ASK
- < 40: ALLOW

### 3. Sensitive File Protection (`guards/sensitiveFiles.ts`)
**Goal**: Central sensitive detector

**Protected Patterns**:
- `.env` files
- SSH/GPG keys (`.pem`, `.key`, `id_rsa`, etc.)
- AWS credentials (`.aws/`, `aws_access_key`)
- Azure/GCP credentials
- Database credentials
- OAuth tokens
- API keys and secrets
- Git config
- Kubernetes config
- History files

**Usage**:
```typescript
import { isSensitive } from '@/security-system/guards'

if (isSensitive(filePath)) {
  // Require approval for sensitive files
}
```

### 4. Destructive Action Guardrail (`guards/destructiveGuard.ts`)
**Goal**: Catch dangerous commands early

**Dangerous Patterns**:
- `rm -rf`, `rmdir -p` (recursive delete)
- `chmod 777`, `chmod 666` (world-writable)
- `git push --force`, `git reset --hard`
- `sudo` (privilege escalation)
- `mkfs`, `dd if=...of=` (format/wipe)
- `drop database`, `truncate table` (data loss)

**Severity Levels**:
- CRITICAL: System-wide destruction
- HIGH: Data loss
- MEDIUM: Permission/security
- LOW: Other concerns

### 5. Skill-Level Trust System (`access-control/skillTrust.ts`)
**Goal**: Not all tools are equal

**Trust Levels**:
- `trusted`: Auto-allow execution
- `restricted`: Require approval
- `untrusted`: Sandbox execution required

**Config**:
```json
{
  "security": {
    "skill_trust": {
      "browser": "restricted",
      "shell": "untrusted",
      "api": "trusted"
    }
  }
}
```

### 6. Network Access Policy (`network/`)
**Goal**: Prevent data exfiltration

**Modes**:
- `allow`: Allow all network access
- `deny`: Block all network access
- `allowlist`: Only allow specific domains

**Features**:
- Domain wildcard matching (`*.example.com`)
- Internal IP detection (localhost, 192.168.x.x, etc.)
- Docker network isolation when sandboxing

**Config**:
```json
{
  "security": {
    "network": {
      "mode": "allowlist",
      "allow_domains": ["api.example.com", "*.github.com"]
    }
  }
}
```

### 7. RBAC System (`access-control/rbac.ts`)
**Goal**: Role-based permission management

**Roles**:
```
readonly          → All tools disabled
developer         → Most tools require approval
autonomous_agent  → Most tools allowed
admin             → Full access
```

**Usage**:
```typescript
const rbac = new RBACEngine()
const decision = rbac.getPermission('developer', 'bash') // Returns: 'ask'
```

**Config**:
```json
{
  "security": {
    "user_role": "developer"
  }
}
```

### 8. Loop Detection (`monitoring/loopGuard.ts`)
**Goal**: Detect runaway agents

**Detection Signals**:
- Repeated commands (3+ identical in 60s)
- Repeated errors (2+ identical)
- No command variation
- High error rate (>70%)
- High iteration count

**Score Calculation**:
- Repeated command: +40
- Repeated error: +50
- Identical commands: +35
- No variation: +20
- High error rate: +30

**Threshold**: 50+ triggers approval

**Usage**:
```typescript
const loopGuard = new LoopGuard()
loopGuard.recordCommand(cmd)
if (loopGuard.isLoopLikely()) {
  // Request human approval
}
```

### 9. Audit Logging (`monitoring/auditLogger.ts`)
**Goal**: Enterprise audit trail

**Event Types**:
- `permission_decision`
- `command_execution`
- `file_access`
- `sensitive_file_access`
- `network_request`
- `loop_detected`
- `error_occurred`
- `sandbox_execution`

**Features**:
- Tamper-evident logging (hash chain)
- JSONL format (append-only)
- Search by type, time range
- Integrity verification

**Config**:
```json
{
  "security": {
    "audit_logging": {
      "enabled": true,
      "directory": ".opencode/audit"
    }
  }
}
```

### 10. Agent Autonomy Modes (`autonomy/`)
**Goal**: Control agent independence

**Modes**:
```
supervised
├─ Ask Multiplier: 1.5x (more conservative approvals)
├─ Deny Multiplier: 1.2x
└─ Max Iterations: 5

semi_autonomous (DEFAULT)
├─ Ask Multiplier: 1.0x
├─ Deny Multiplier: 1.0x
└─ Max Iterations: 10

fully_autonomous
├─ Ask Multiplier: 0.7x (fewer approvals)
├─ Deny Multiplier: 0.8x
└─ Max Iterations: 20
```

**Config**:
```json
{
  "agent_autonomy": {
    "mode": "semi_autonomous",
    "max_iterations": 10
  }
}
```

## Integration Patterns

### Complete Permission Flow

```typescript
import {
  DockerRunner,
  isSensitive,
  isDestructive,
  RiskEngine,
  RBACEngine,
  NetworkGuard,
  AuditLogger,
  AgentAutonomyController
} from '@/security-system'

class SecureExecutor {
  constructor(
    private risk = new RiskEngine(),
    private rbac = new RBACEngine(),
    private network = new NetworkGuard(),
    private audit = new AuditLogger(),
    private autonomy = new AgentAutonomyController()
  ) {}

  async executeCommand(
    command: string,
    user: string,
    agent: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Step 1: Check destructive patterns
    if (isDestructive({ command })) {
      await this.audit.logPermissionDecision({
        user,
        action: command,
        result: 'ask'
      })
      return { allowed: false, reason: 'Destructive command detected' }
    }

    // Step 2: Assess risk
    const assessment = this.risk.assess({ command })

    // Step 3: Adjust for agent autonomy
    const threshold = this.autonomy.adjustRiskThreshold(agent, 40, 'ask')
    if (assessment.score >= threshold) {
      return { allowed: false, reason: `High risk (${assessment.score}/100)` }
    }

    // Step 4: Check RBAC
    const userRole = 'developer'
    const rbacDecision = this.rbac.getPermission(userRole, 'bash')
    if (rbacDecision === 'deny') {
      return { allowed: false, reason: 'Role does not permit bash' }
    }

    // Step 5: Check network access
    if (/curl|wget|fetch/.test(command)) {
      const networkCheck = this.network.checkUrl('https://api.example.com')
      if (!networkCheck.allowed) {
        return { allowed: false, reason: networkCheck.reason }
      }
    }

    // Approved
    await this.audit.logCommandExecution({
      user,
      command,
      executedIn: 'sandbox'
    })
    return { allowed: true }
  }
}
```

## Configuration Example

```json
{
  "$schema": "https://opencode.ai/config.json",
  "security": {
    "execution_mode": "sandbox",
    "risk_policy": "dynamic",
    "risk_thresholds": {
      "deny": 80,
      "ask": 40
    },
    "network": {
      "mode": "allowlist",
      "allow_domains": ["github.com", "*.api.example.com"]
    },
    "sandbox": {
      "memory_limit": "512m",
      "cpu_limit": "1",
      "image_tag": "node:20-alpine"
    },
    "skill_trust": {
      "browser": "restricted",
      "shell": "untrusted"
    },
    "loop_detection": {
      "enabled": true,
      "threshold": 50,
      "window_ms": 60000
    },
    "audit_logging": {
      "enabled": true,
      "directory": ".opencode/audit"
    },
    "user_role": "developer"
  },
  "agent_autonomy": {
    "mode": "semi_autonomous",
    "max_iterations": 10
  }
}
```

## Testing & Validation

### Unit Tests

```typescript
// Test risk scoring
const risk = new RiskEngine()
const assessment = risk.assess({
  command: 'rm -rf /',
  filePath: '.env'
})
assert(assessment.level === 'critical')
assert(assessment.recommendation === 'deny')

// Test RBAC
const rbac = new RBACEngine()
assert(rbac.isDenied('readonly', 'bash') === true)
assert(rbac.canAccess('admin', 'bash') === true)

// Test loop detection
const loop = new LoopGuard()
loop.recordCommand('npm install')
loop.recordCommand('npm install')
loop.recordCommand('npm install')
assert(loop.isLoopLikely() === true)
```

## Security Considerations

1. **Sandbox Escapes**: Docker escapes compromise host. Update images regularly.
2. **Risk Score Tuning**: Thresholds depend on organization risk tolerance.
3. **Audit Log Storage**: Use immutable, encrypted storage for logs.
4. **Network Policies**: Keep allowlist restrictive. Default-deny is safer.
5. **Skill Trust**: Verify external skills before marking as `trusted`.
6. **User Roles**: Map LDAP/OAuth roles to system roles in enterprise.

## Future Enhancements

- [ ] Cryptographic audit log hashing (SHA-256)
- [ ] SIEM integration for centralized logging
- [ ] Machine learning for anomaly detection
- [ ] Custom risk scoring plugins
- [ ] LDAP/OAuth role integration
- [ ] Network policy learning mode
- [ ] GPU support for sandbox containers
- [ ] Multi-user per-session audit trails

## Contributing

When adding new security features:
1. Create appropriately in the correct folder
2. Export from folder's `index.ts`
3. Document in this README
4. Add tests
5. Update config schema if needed

See parent `security-system/README.md` for more details.
