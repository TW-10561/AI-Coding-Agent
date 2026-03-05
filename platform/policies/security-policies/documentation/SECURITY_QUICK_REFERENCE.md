# Security Policies Quick Reference

## Policy Checklist

### 1. ✅ Execution Sandbox
- **File**: `src/sandbox/sandboxRunner.ts`
- **Config**: `security.execution_mode` = "host" | "sandbox"
- **Status**: IMPLEMENTED
- **Integration Points**:
  - bash.ts tool (main execution)
  - sandboxRunner factory pattern
  - Docker isolation (--network=none, CPU/memory limits)

### 2. ✅ Sensitive File Protection
- **File**: `src/security/sensitiveFiles.ts`
- **Patterns**: 54 regex patterns for sensitive files
- **Status**: IMPLEMENTED
- **Integration Points**:
  - risk engine scoring
  - permission checks
  - audit logging

### 3. ✅ Risk-Based Permission System
- **File**: `src/permission/riskEngine.ts`
- **Config**: `security.risk_policy` = "static" | "dynamic" | "hybrid"
- **Status**: IMPLEMENTED
- **Scoring Ranges**: 0-100 (critical ≥80, high ≥60, medium ≥40, low <40)

### 4. ✅ Destructive Action Guardrail
- **File**: `src/security/destructiveGuard.ts`
- **Severity Levels**: critical (95), high (85), medium (60), low (30)
- **Status**: IMPLEMENTED
- **Pre-check**: Always runs before risk engine

### 5. ✅ Loop Detection (Doom Loop v2)
- **File**: `src/agent/loopGuard.ts`
- **Config**: `security.loop_detection.enabled` = true/false
- **Status**: IMPLEMENTED
- **Window**: 60000ms (configurable), 50 max history

### 6. ✅ Network Access Policy
- **File**: `src/security/networkGuard.ts`
- **Modes**: "allow" | "deny" | "allowlist"
- **Status**: IMPLEMENTED
- **Validation**: URL extraction, domain pattern matching, IP detection

### 7. ✅ Skill-Level Trust System
- **File**: `src/security/skillTrust.ts`
- **Levels**: "trusted" | "restricted" | "untrusted"
- **Status**: IMPLEMENTED
- **Behaviors**: allow | ask | sandbox

### 8. ✅ RBAC (Role-Based Access Control)
- **File**: `src/security/rbac.ts`
- **Roles**: admin | developer | readonly | autonomous_agent
- **Status**: IMPLEMENTED
- **Permissions**: bash, edit, read, webfetch, external_directory, doom_loop, skill

### 9. ✅ Audit Logging
- **File**: `src/audit/auditLogger.ts`
- **Config**: `security.audit_logging.enabled` = true/false
- **Status**: IMPLEMENTED
- **Storage**: `.opencode/audit/audit.log.jsonl` (tamper-evident)

### 10. ✅ Agent Autonomy Modes
- **File**: `src/agent/autonomy.ts`
- **Modes**: "supervised" | "semi_autonomous" | "fully_autonomous"
- **Status**: IMPLEMENTED
- **Multipliers**: 1.5x (supervised) → 1.0x (semi) → 0.7x (fully)

---

## Configuration Template

```json
{
  "security": {
    "execution_mode": "sandbox",
    "risk_policy": "dynamic",
    "risk_thresholds": {
      "deny": 80,
      "ask": 40
    },
    "network": {
      "mode": "allowlist",
      "allow_domains": ["api.example.com", "*.github.com"]
    },
    "sandbox": {
      "memory_limit": "512m",
      "cpu_limit": "1",
      "image_tag": "node:20-alpine"
    },
    "skill_trust": {
      "file_operations": "trusted",
      "network_access": "restricted",
      "system_operations": "untrusted"
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
    "max_iterations": 10,
    "requireApprovalOnHighRisk": true,
    "requireApprovalOnLoopDetection": true
  }
}
```

---

## Bash Tool Execution Flow

```
1. Load Config
   ↓
2. Initialize Security Systems
   ├─ RiskEngine
   ├─ SandboxFactory
   ├─ AuditLogger (if enabled)
   └─ LoopGuard (if enabled)
   ↓
3. Security Checks (in order)
   ├─ Destructive Guard (pre-check) ⚠️
   ├─ Sensitive File Detection
   ├─ Risk Assessment (if dynamic)
   └─ Loop Detection (if enabled)
   ↓
4. Permission Checks
   ├─ Traditional permissions
   └─ External directory checks
   ↓
5. Command Execution
   ├─ Host execution (from config)
   └─ Sandbox execution (Docker)
   ↓
6. Audit & Report
   └─ Log to audit trail
```

---

## Policy Interaction Matrix

| Policy | Checks | Scores | Denies | Asks | Logs |
|--------|--------|--------|--------|------|------|
| Destructive | Always 1st | 30-95 | Critical | All | Yes |
| Sensitive Files | On access | +70 | Via risk | Via risk | Yes |
| Risk Engine | If enabled | 0-100 | ≥80 | ≥40 | Yes |
| Loop Guard | If enabled | 0-100 | >threshold | >threshold | Yes |
| RBAC | All ops | N/A | By role | By role | Yes |
| Network | On request | N/A | Deny mode | Ask mode | Yes |
| Skill Trust | On use | N/A | Untrusted | Restricted | Yes |
| Audit | All events | N/A | N/A | N/A | Always |

---

## Risk Score Breakdown

```
Destructive Commands:
├─ Critical: rm -rf, mkfs, format → 95 points
├─ High: drop database, git push --force → 85 points
├─ Medium: chmod 777, sudo → 60 points
└─ Low: other patterns → 30 points

Sensitive Files: → 70 points
Package Installation: → 40 points
Network/External Calls: → 30 points
Large File Changes: 
├─ >10KB → 50 points
└─ >1KB → 30 points
File Deletion: → 40 points
Loop Indicators:
├─ Repeated command → 30 points
├─ Repeated error → 40 points
├─ High iteration count → 20 points
└─ Low uniqueness → 20-35 points
```

---

## Severity Levels

```
CRITICAL (≥80 score)
├─ System-wide destruction (mkfs, format)
├─ Complete recursively removal (rm -rf /)
├─ Kill all processes (kill -9 -1)
└─ Force system state changes

HIGH (60-79 score)
├─ Data loss operations (drop database)
├─ History rewriting (git push --force)
├─ Hard resets (git reset --hard)
└─ Destructive git operations

MEDIUM (40-59 score)
├─ Permission changes (chmod 777)
├─ Privilege escalation (sudo)
├─ Package modifications (npm uninstall -g)
└─ Potentially dangerous operations

LOW (<40 score)
├─ Safe file operations
├─ Read operations
├─ Standard commands
└─ Approved patterns
```

---

## Role Permissions Table

```
┌─────────────────┬────────┬──────┬──────┬──────────┬─────────────┬───────────┬───────┐
│ Role            │ Bash   │ Edit │ Read │ WebFetch │ Ext Dir     │ DoomLoop  │ Skill │
├─────────────────┼────────┼──────┼──────┼──────────┼─────────────┼───────────┼───────┤
│ admin           │ allow  │ allow│ allow│ allow    │ allow       │ allow     │ allow │
│ developer       │ ask    │ allow│ allow│ ask      │ ask         │ ask       │ allow │
│ readonly        │ deny   │ deny │ allow│ deny     │ deny        │ deny      │ deny  │
│ autonomous_agent│ allow  │ allow│ allow│ allow    │ allow       │ ask       │ allow │
└─────────────────┴────────┴──────┴──────┴──────────┴─────────────┴───────────┴───────┘
```

---

## Autonomy Mode Behavior

```
SUPERVISED (1.5x multiplier)
├─ askThreshold: 40 * 1.5 = 60
├─ denyThreshold: 80 * 1.2 = 96
├─ maxIterations: 5
└─ Use: Critical operations, maximum oversight

SEMI_AUTONOMOUS (1.0x multiplier)
├─ askThreshold: 40 * 1.0 = 40
├─ denyThreshold: 80 * 1.0 = 80
├─ maxIterations: 10
└─ Use: Standard operations, balanced control

FULLY_AUTONOMOUS (0.7x multiplier)
├─ askThreshold: 40 * 0.7 = 28
├─ denyThreshold: 80 * 0.8 = 64
├─ maxIterations: 20
└─ Use: Trusted operations, minimal intervention
```

---

## Trust Level Behaviors

```
TRUSTED
├─ Run: Direct execution
├─ Approval: None
└─ Sandbox: No

RESTRICTED
├─ Run: Ask user
├─ Approval: Required
└─ Sandbox: No

UNTRUSTED
├─ Run: Sandboxed
├─ Approval: Always
└─ Sandbox: Docker container
```

---

## Sensitive File Patterns (Examples)

```
Environment Variables:
  .env, .env.local, .env.production, .env.*

SSH & GPG:
  id_rsa, id_ed25519, id_ecdsa, id_dsa
  .ssh/config, .ssh/authorized_keys
  ~/.pgp, ~/.gnupg

Cloud Credentials:
  .aws/credentials, .aws/config
  .azure/*, .config/gcloud/*
  ~/.kube/config

API Keys:
  api_key, secret_key, auth_token
  access_token, refresh_token
  client_secret, client_id

Certificates:
  *.pem, *.key, *.crt, *.cert
  *.pfx, *.p12

Database:
  database.yml, database.yaml
  *_credentials.*

History Files:
  .bash_history, .zsh_history
  .psql_history, .mysql_history
```

---

## Docker Sandbox Isolation

```
docker run \
  --rm \
  --network=none \
  --memory=512m \
  --cpus=1 \
  -v /workspace:/workspace:ro \
  -w /workspace \
  node:20-alpine \
  sh -c "command"

Features:
├─ --rm: Clean up after execution
├─ --network=none: No network access
├─ --memory=512m: Memory limit
├─ --cpus=1: CPU core limit
├─ -v ...:ro: Read-only filesystem
└─ No docker sock access
```

---

## Network Mode Examples

```
ALLOW Mode:
  curl https://api.example.com → ✅ ALLOWED
  fetch https://anywhere.com   → ✅ ALLOWED

DENY Mode:
  curl https://api.example.com → ❌ DENIED
  fetch https://anywhere.com   → ❌ DENIED

ALLOWLIST Mode (allowed: api.example.com, *.github.com):
  curl https://api.example.com → ✅ ALLOWED
  curl https://raw.github.com  → ✅ ALLOWED
  curl https://external.com    → ❌ DENIED
```

---

## Test Coverage Summary

| Category | Tests | Status |
|----------|-------|--------|
| Sandbox | 3 | ✅ |
| Sensitive Files | 7 | ✅ |
| Risk Engine | 7 | ✅ |
| Destructive Guard | 8 | ✅ |
| Loop Detection | 5 | ✅ |
| Network Policy | 5 | ✅ |
| Skill Trust | 4 | ✅ |
| RBAC | 6 | ✅ |
| Audit Logging | 5 | ✅ |
| Autonomy Modes | 7 | ✅ |
| Integration | 14 | ✅ |
| **TOTAL** | **71** | **✅** |

---

## Quick Verification Checklist

- [ ] `security.json` configuration file created
- [ ] Sandbox runner tested with Docker
- [ ] Sensitive file patterns verified
- [ ] Risk engine scoring validated
- [ ] Destructive commands blocked
- [ ] Loop detection working
- [ ] Network policy enforced
- [ ] Skill trust levels assigned
- [ ] RBAC deployed
- [ ] Audit logging active
- [ ] Autonomy modes configured
- [ ] All tests passing
- [ ] Documentation complete
- [ ] Production configuration ready

---

## Troubleshooting

### Issue: Sandbox execution fails
**Solution**: Check Docker installation: `docker --version`
**Fallback**: Set `execution_mode: "host"`

### Issue: Loop detection too aggressive
**Solution**: Increase `loop_detection.threshold` (default: 50)
**Alternative**: Set `loop_detection.enabled: false`

### Issue: Legitimate commands blocked
**Solution**: Adjust `risk_thresholds.ask` (default: 40)
**Alternative**: Add to skill trust or RBAC exceptions

### Issue: Network requests blocked
**Solution**: Check `network.mode` and `allow_domains` config
**Test**: `network.mode: "allow"` to verify setup

### Issue: Audit log growing too fast
**Solution**: Increase pruning window or archive logs regularly
**Control**: Selective event logging by type

---

## Performance Tips

- Use `static` risk_policy if dynamic is too slow
- Disable loop detection for trusted agents
- Cache sensitive file patterns
- Batch audit log writes
- Use memory limits appropriately for sandbox
- Monitor Docker image pull times

---

## Security Best Practices

1. **Always enable audit logging in production**
2. **Use sandbox for untrusted code**
3. **Narrow network allowlists to needed domains**
4. **Set user_role to least privilege**
5. **Configure autonomy mode per agent type**
6. **Review audit logs regularly**
7. **Keep skill trust registry updated**
8. **Test policies before production deployment**
9. **Monitor loop detection metrics**
10. **Version control all security configs**

---

## Integration Checkpoints

- ✅ bash.ts: Full integration with all policies
- ✅ Config schema: All fields defined
- ✅ Test suite: Comprehensive coverage
- ✅ Documentation: Complete
- ✅ Error handling: Robust
- ✅ Logging: Debug and error levels
- ✅ Performance: Optimized
- ✅ Backward compatibility: Maintained
