/**
 * HITL Unit Test Suite
 *
 * Covers all 10 HITL security modules in isolation.
 * Run with:  bun test tests/hitl.test.ts
 *
 * No running server required — all tests are pure unit tests against
 * the TypeScript modules in platform/HITL/.
 */

import { describe, test, expect, beforeEach } from "bun:test"

// ── Module imports ────────────────────────────────────────────────────────────
import { isDestructive, getSeverityLevel }              from "../HITL/destructiveGuard"
import { isSensitive, getSensitivePatterns }            from "../HITL/sensitiveFiles"
import { LoopGuard }                                    from "../HITL/loopGuard"
import { NetworkGuard }                                 from "../HITL/networkGuard"
import { RBACEngine }                                   from "../HITL/rbac"
import { RiskEngine }                                   from "../HITL/riskEngine"
import { AgentAutonomyController }                      from "../HITL/autonomy"
import { SkillTrustManager }                            from "../HITL/skillTrust"
import { AuditLogger }                                  from "../HITL/auditLogger"
import { SandboxRunnerFactory }                         from "../HITL/sandboxRunner"

// ─────────────────────────────────────────────────────────────────────────────
// 1. DESTRUCTIVE GUARD
// ─────────────────────────────────────────────────────────────────────────────

describe("DestructiveGuard", () => {
  // ── Commands that MUST be caught ──────────────────────────────────────────

  test("detects rm -rf", () => {
    expect(isDestructive({ command: "rm -rf /tmp/test" })).toBe(true)
  })

  test("detects git push --force", () => {
    expect(isDestructive({ command: "git push --force origin main" })).toBe(true)
  })

  test("detects git reset --hard", () => {
    expect(isDestructive({ command: "git reset --hard HEAD~3" })).toBe(true)
  })

  test("detects DROP DATABASE", () => {
    expect(isDestructive({ command: "DROP DATABASE production;" })).toBe(true)
  })

  test("detects TRUNCATE TABLE", () => {
    expect(isDestructive({ command: "TRUNCATE TABLE users;" })).toBe(true)
  })

  test("detects chmod 777", () => {
    expect(isDestructive({ command: "chmod 777 /etc/passwd" })).toBe(true)
  })

  test("detects chmod 666", () => {
    expect(isDestructive({ command: "chmod 666 secret.key" })).toBe(true)
  })

  test("detects sudo", () => {
    expect(isDestructive({ command: "sudo rm -rf /usr" })).toBe(true)
  })

  test("detects pkill -9", () => {
    expect(isDestructive({ command: "pkill -9 node" })).toBe(true)
  })

  test("detects mkfs", () => {
    expect(isDestructive({ command: "mkfs.ext4 /dev/sdb" })).toBe(true)
  })

  test("detects iptables -F (flush all rules)", () => {
    expect(isDestructive({ command: "iptables -F" })).toBe(true)
  })

  test("detects npm uninstall -g", () => {
    expect(isDestructive({ command: "npm uninstall -g typescript" })).toBe(true)
  })

  // ── Commands that must NOT be flagged ──────────────────────────────────────

  test("allows cat README.md", () => {
    expect(isDestructive({ command: "cat README.md" })).toBe(false)
  })

  test("allows ls -la", () => {
    expect(isDestructive({ command: "ls -la" })).toBe(false)
  })

  test("allows npm install (not uninstall -g)", () => {
    expect(isDestructive({ command: "npm install express" })).toBe(false)
  })

  test("allows git status", () => {
    expect(isDestructive({ command: "git status" })).toBe(false)
  })

  test("allows git push without --force", () => {
    expect(isDestructive({ command: "git push origin feature-branch" })).toBe(false)
  })

  // ── Severity levels ───────────────────────────────────────────────────────

  test("rm -rf is critical severity", () => {
    expect(getSeverityLevel({ command: "rm -rf /" })).toBe("critical")
  })

  test("git push --force is high severity", () => {
    const level = getSeverityLevel({ command: "git push --force" })
    expect(["high", "critical"]).toContain(level)
  })

  test("safe command is none severity", () => {
    expect(getSeverityLevel({ command: "echo hello" })).toBe("none")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. SENSITIVE FILES
// ─────────────────────────────────────────────────────────────────────────────

describe("SensitiveFiles", () => {
  // ── Files that MUST be flagged ────────────────────────────────────────────

  test("flags .env", () => {
    expect(isSensitive("/project/.env")).toBe(true)
  })

  test("flags .env.production", () => {
    expect(isSensitive("/project/.env.production")).toBe(true)
  })

  test("flags id_rsa (SSH private key)", () => {
    expect(isSensitive("/home/user/.ssh/id_rsa")).toBe(true)
  })

  test("flags .pem certificate file", () => {
    expect(isSensitive("/certs/server.pem")).toBe(true)
  })

  test("flags .key file", () => {
    expect(isSensitive("/secrets/api.key")).toBe(true)
  })

  test("flags AWS credentials file", () => {
    expect(isSensitive("/home/user/.aws/credentials")).toBe(true)
  })

  test("flags .pfx certificate", () => {
    expect(isSensitive("/certs/bundle.pfx")).toBe(true)
  })

  test("flags id_ed25519 (modern SSH key)", () => {
    expect(isSensitive("/home/user/.ssh/id_ed25519")).toBe(true)
  })

  test("flags .tfvars (Terraform secrets)", () => {
    expect(isSensitive("/infra/prod.tfvars")).toBe(true)
  })

  test("flags kubeconfig", () => {
    expect(isSensitive("/home/user/.kube/config")).toBe(true)
  })

  // ── Files that must NOT be flagged ───────────────────────────────────────

  test("allows README.md", () => {
    expect(isSensitive("/project/README.md")).toBe(false)
  })

  test("allows src/index.ts", () => {
    expect(isSensitive("/project/src/index.ts")).toBe(false)
  })

  test("allows package.json", () => {
    expect(isSensitive("/project/package.json")).toBe(false)
  })

  test("allows test.spec.ts", () => {
    expect(isSensitive("/project/tests/auth.spec.ts")).toBe(false)
  })

  // ── Pattern list ──────────────────────────────────────────────────────────

  test("getSensitivePatterns returns a non-empty array", () => {
    const patterns = getSensitivePatterns()
    expect(patterns.length).toBeGreaterThan(10)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. LOOP GUARD
// ─────────────────────────────────────────────────────────────────────────────

describe("LoopGuard", () => {
  let guard: LoopGuard

  beforeEach(() => {
    guard = new LoopGuard()
  })

  test("no loop score for single command", () => {
    guard.recordCommand("ls -la")
    expect(guard.computeLoopScore()).toBe(0)
  })

  test("no loop score for three different commands", () => {
    guard.recordCommand("ls")
    guard.recordCommand("cat file.txt")
    guard.recordCommand("pwd")
    expect(guard.computeLoopScore()).toBe(0)
  })

  test("detects loop when same command runs 3+ times", () => {
    guard.recordCommand("python3 broken.py")
    guard.recordCommand("python3 broken.py")
    guard.recordCommand("python3 broken.py")
    expect(guard.computeLoopScore()).toBeGreaterThanOrEqual(40)
  })

  test("detects error loop when same error repeats 2+ times", () => {
    guard.recordError("ModuleNotFoundError: No module named 'foo'", "pip install foo")
    guard.recordError("ModuleNotFoundError: No module named 'foo'", "pip install foo")
    expect(guard.computeLoopScore()).toBeGreaterThanOrEqual(50)
  })

  test("score is additive: command + error loop = higher score", () => {
    guard.recordCommand("npm test")
    guard.recordCommand("npm test")
    guard.recordCommand("npm test")
    guard.recordError("FAIL src/app.test.ts", "npm test")
    guard.recordError("FAIL src/app.test.ts", "npm test")
    const score = guard.computeLoopScore()
    expect(score).toBeGreaterThanOrEqual(90)
  })

  test("five identical commands in a row yields maximum score contribution", () => {
    for (let i = 0; i < 5; i++) guard.recordCommand("make build")
    expect(guard.computeLoopScore()).toBeGreaterThanOrEqual(40)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. NETWORK GUARD
// ─────────────────────────────────────────────────────────────────────────────

describe("NetworkGuard", () => {
  test("allow mode permits any URL by default", () => {
    const guard = new NetworkGuard({ mode: "allow" })
    expect(guard.checkUrl("https://example.com/api").allowed).toBe(true)
  })

  test("deny mode blocks all URLs", () => {
    const guard = new NetworkGuard({ mode: "deny" })
    expect(guard.checkUrl("https://google.com").allowed).toBe(false)
  })

  test("allowlist mode permits listed domain", () => {
    const guard = new NetworkGuard({ mode: "allowlist", allowDomains: ["api.github.com"] })
    expect(guard.checkUrl("https://api.github.com/repos").allowed).toBe(true)
  })

  test("allowlist mode blocks unlisted domain", () => {
    const guard = new NetworkGuard({ mode: "allowlist", allowDomains: ["api.github.com"] })
    expect(guard.checkUrl("https://evil.example.com/exfil").allowed).toBe(false)
  })

  test("allowlist mode supports wildcard subdomains", () => {
    const guard = new NetworkGuard({ mode: "allowlist", allowDomains: ["*.github.com"] })
    expect(guard.checkUrl("https://api.github.com").allowed).toBe(true)
    expect(guard.checkUrl("https://raw.githubusercontent.com").allowed).toBe(false)
  })

  test("denied domains list blocks specific domain in allow mode", () => {
    const guard = new NetworkGuard({ mode: "allow", deniedDomains: ["malware.example.com"] })
    expect(guard.checkUrl("https://malware.example.com/payload").allowed).toBe(false)
  })

  test("denied domains list does not block other domains", () => {
    const guard = new NetworkGuard({ mode: "allow", deniedDomains: ["malware.example.com"] })
    expect(guard.checkUrl("https://safe.example.com").allowed).toBe(true)
  })

  test("checkUrl returns a reason string when blocked", () => {
    const guard = new NetworkGuard({ mode: "deny" })
    const result = guard.checkUrl("https://anything.com")
    expect(result.allowed).toBe(false)
    expect(typeof result.reason).toBe("string")
    expect(result.reason!.length).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. RBAC ENGINE
// ─────────────────────────────────────────────────────────────────────────────

describe("RBACEngine", () => {
  const rbac = new RBACEngine()

  // ── Admin role ────────────────────────────────────────────────────────────

  test("admin can run bash", () => {
    expect(rbac.getPermission("admin", "bash")).toBe("allow")
  })

  test("admin can edit", () => {
    expect(rbac.getPermission("admin", "edit")).toBe("allow")
  })

  // ── readonly role ─────────────────────────────────────────────────────────

  test("readonly cannot run bash", () => {
    expect(rbac.getPermission("readonly", "bash")).toBe("deny")
  })

  test("readonly cannot edit", () => {
    expect(rbac.getPermission("readonly", "edit")).toBe("deny")
  })

  test("readonly can read", () => {
    expect(rbac.getPermission("readonly", "read")).toBe("allow")
  })

  // ── developer role ────────────────────────────────────────────────────────

  test("developer must ask before bash", () => {
    expect(rbac.getPermission("developer", "bash")).toBe("ask")
  })

  test("developer can edit without asking", () => {
    expect(rbac.getPermission("developer", "edit")).toBe("allow")
  })

  test("developer must ask before webfetch", () => {
    expect(rbac.getPermission("developer", "webfetch")).toBe("ask")
  })

  // ── autonomous_agent role ─────────────────────────────────────────────────

  test("autonomous_agent can run bash", () => {
    expect(rbac.getPermission("autonomous_agent", "bash")).toBe("allow")
  })

  test("autonomous_agent must ask before doom_loop", () => {
    expect(rbac.getPermission("autonomous_agent", "doom_loop")).toBe("ask")
  })

  // ── Custom policy override ────────────────────────────────────────────────

  test("custom policy overrides default for a specific role+permission", () => {
    const custom = new RBACEngine()
    custom.setCustomPolicy("developer", { bash: "allow" })
    expect(custom.getPermission("developer", "bash")).toBe("allow")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. RISK ENGINE
// ─────────────────────────────────────────────────────────────────────────────

describe("RiskEngine", () => {
  let engine: RiskEngine

  beforeEach(() => {
    engine = new RiskEngine()
  })

  test("rm -rf scores ≥ 80 (deny threshold)", () => {
    const { score } = engine.assess({ command: "rm -rf /tmp/test" })
    expect(score).toBeGreaterThanOrEqual(80)
  })

  test("rm -rf recommendation is deny", () => {
    const { recommendation } = engine.assess({ command: "rm -rf /tmp/test" })
    expect(recommendation).toBe("deny")
  })

  test("npm install scores in ask zone (40-79)", () => {
    const { score } = engine.assess({ command: "npm install lodash" })
    expect(score).toBeGreaterThanOrEqual(40)
    expect(score).toBeLessThan(80)
  })

  test("cat README.md scores below ask threshold (<40)", () => {
    const { score } = engine.assess({ command: "cat README.md" })
    expect(score).toBeLessThan(40)
  })

  test("touching .env adds high risk", () => {
    const safe  = engine.computeRisk({ command: "cat notes.txt" })
    const risky = engine.computeRisk({ command: "cat .env" })
    expect(risky).toBeGreaterThan(safe)
  })

  test("assess returns a factors array", () => {
    const result = engine.assess({ command: "rm -rf /usr" })
    expect(Array.isArray(result.factors)).toBe(true)
    expect(result.factors.length).toBeGreaterThan(0)
  })

  test("delete operation adds risk score", () => {
    const noDelete = engine.computeRisk({ command: "ls" })
    const withDelete = engine.computeRisk({ command: "unlink oldfile.txt", isDelete: true })
    expect(withDelete).toBeGreaterThan(noDelete)
  })

  test("large diff (>10KB) adds risk score", () => {
    const small = engine.computeRisk({ command: "echo hi", diffSize: 100 })
    const large = engine.computeRisk({ command: "echo hi", diffSize: 15_000 })
    expect(large).toBeGreaterThan(small)
  })

  test("repeated command adds risk", () => {
    const once   = engine.computeRisk({ command: "npm test" })
    const repeat = engine.computeRisk({ command: "npm test", isRepeatedCommand: true })
    expect(repeat).toBeGreaterThan(once)
  })

  test("score is capped at 100", () => {
    const { score } = engine.assess({
      command: "sudo rm -rf /",
      isDelete: true,
      touchesSensitiveFile: true,
      diffSize: 50_000,
      isRepeatedCommand: true,
    })
    expect(score).toBeLessThanOrEqual(100)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. AGENT AUTONOMY CONTROLLER
// ─────────────────────────────────────────────────────────────────────────────

describe("AgentAutonomyController", () => {
  const ctrl = new AgentAutonomyController()

  beforeEach(() => {
    ctrl.registerAgent("test-agent", { mode: "semi_autonomous" })
  })

  test("getMode returns registered mode", () => {
    expect(ctrl.getMode("test-agent")).toBe("semi_autonomous")
  })

  test("supervised mode has lower maxIterations than fully_autonomous", () => {
    ctrl.registerAgent("a", { mode: "supervised" })
    ctrl.registerAgent("b", { mode: "fully_autonomous" })
    const supervised = ctrl.getBehavior("a")
    const autonomous = ctrl.getBehavior("b")
    expect(supervised.maxIterations).toBeLessThan(autonomous.maxIterations)
  })

  test("fully_autonomous mode has lower askMultiplier (asks less)", () => {
    ctrl.registerAgent("a", { mode: "supervised" })
    ctrl.registerAgent("b", { mode: "fully_autonomous" })
    const supervised = ctrl.getBehavior("a")
    const autonomous = ctrl.getBehavior("b")
    expect(autonomous.askMultiplier).toBeLessThan(supervised.askMultiplier)
  })

  test("supervised mode has higher denyMultiplier (denies more)", () => {
    ctrl.registerAgent("a", { mode: "supervised" })
    ctrl.registerAgent("b", { mode: "fully_autonomous" })
    const supervised = ctrl.getBehavior("a")
    const autonomous = ctrl.getBehavior("b")
    expect(supervised.denyMultiplier).toBeGreaterThan(autonomous.denyMultiplier)
  })

  test("updating mode is reflected in subsequent getMode", () => {
    ctrl.registerAgent("agent-x", { mode: "supervised" })
    expect(ctrl.getMode("agent-x")).toBe("supervised")
    ctrl.registerAgent("agent-x", { mode: "fully_autonomous" })
    expect(ctrl.getMode("agent-x")).toBe("fully_autonomous")
  })

  test("unknown agent returns default config without throwing", () => {
    expect(() => ctrl.getConfig("nonexistent-agent")).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. SKILL TRUST MANAGER
// ─────────────────────────────────────────────────────────────────────────────

describe("SkillTrustManager", () => {
  let mgr: SkillTrustManager

  beforeEach(() => {
    mgr = new SkillTrustManager()
    mgr.registerSkill("official-skill", "trusted",    { author: "thirdwave-team" })
    mgr.registerSkill("community-skill", "restricted", { author: "community" })
    mgr.registerSkill("unknown-skill",  "untrusted",  { author: "anonymous" })
  })

  test("trusted skill isTrusted returns true", () => {
    expect(mgr.isTrusted("official-skill")).toBe(true)
  })

  test("restricted skill isTrusted returns false", () => {
    expect(mgr.isTrusted("community-skill")).toBe(false)
  })

  test("untrusted skill shouldSandbox returns true", () => {
    expect(mgr.shouldSandbox("unknown-skill")).toBe(true)
  })

  test("trusted skill shouldSandbox returns false", () => {
    expect(mgr.shouldSandbox("official-skill")).toBe(false)
  })

  test("trusted skill behavior is 'allow'", () => {
    expect(mgr.getBehavior("official-skill")).toBe("allow")
  })

  test("restricted skill behavior is 'ask'", () => {
    expect(mgr.getBehavior("community-skill")).toBe("ask")
  })

  test("untrusted skill behavior is 'sandbox'", () => {
    expect(mgr.getBehavior("unknown-skill")).toBe("sandbox")
  })

  test("getMetadata returns registered metadata", () => {
    const meta = mgr.getMetadata("official-skill")
    expect(meta).toMatchObject({ author: "thirdwave-team" })
  })

  test("getTrustLevel for unknown skill does not throw", () => {
    expect(() => mgr.getTrustLevel("ghost-skill")).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 9. AUDIT LOGGER
// ─────────────────────────────────────────────────────────────────────────────

describe("AuditLogger", () => {
  test("creates an event and retrieves it via getEvents", async () => {
    const logger = new AuditLogger(`/tmp/audit-test-${Date.now()}`)
    await logger.initialize()
    await logger.logPermissionDecision({
      action: "bash",
      resource: "ls -la",
      result: "allow",
      riskScore: 5,
    })
    const events = await logger.getEvents()
    expect(events.length).toBeGreaterThan(0)
    const event = events[0]
    expect(event.type).toBe("permission_decision")
    expect(event.result).toBe("allow")
    expect(typeof event.id).toBe("string")
  })

  test("multiple events are written and all retrievable", async () => {
    const logger = new AuditLogger(`/tmp/audit-chain-${Date.now()}`)
    await logger.initialize()
    await logger.logPermissionDecision({ action: "edit", result: "allow" })
    await logger.logCommandExecution({ command: "ls", executedIn: "host" })
    const events = await logger.getEvents()
    expect(events.length).toBe(2)
    expect(events[0].type).toBe("permission_decision")
    expect(events[1].type).toBe("command_execution")
  })

  test("events have numeric epoch timestamps", async () => {
    const before = Date.now()
    const logger = new AuditLogger(`/tmp/audit-ts-${Date.now()}`)
    await logger.initialize()
    await logger.logFileAccess({ filePath: "README.md", operation: "read" })
    const events = await logger.getEvents()
    expect(events.length).toBeGreaterThan(0)
    const ts = events[0].timestamp
    expect(typeof ts).toBe("number")
    expect(ts).toBeGreaterThanOrEqual(before)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 10. SANDBOX RUNNER FACTORY
// ─────────────────────────────────────────────────────────────────────────────

describe("SandboxRunnerFactory", () => {
  const factory = new SandboxRunnerFactory()

  test("creates a HostRunner when mode is 'host'", async () => {
    const runner = await factory.create("host")
    expect(runner.getMode()).toBe("host")
  })

  test("creates a DockerRunner when mode is 'sandbox'", async () => {
    const runner = await factory.create("sandbox")
    expect(runner.getMode()).toBe("sandbox")
  })

  test("HostRunner executes a safe command successfully", async () => {
    const runner = await factory.create("host")
    const result = await runner.runBash("echo thirdwave-test")
    expect(result.stdout).toContain("thirdwave-test")
    expect(result.exitCode).toBe(0)
  })

  test("HostRunner command exit code is non-zero for failing command", async () => {
    const runner = await factory.create("host")
    const result = await runner.runBash("bash -c 'exit 1'")
    expect(result.exitCode).not.toBe(0)
  })
})
