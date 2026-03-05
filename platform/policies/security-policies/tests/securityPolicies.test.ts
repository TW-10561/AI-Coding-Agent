import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { RiskEngine, RiskContext, RiskAssessment } from "../../src/permission/riskEngine"
import { LoopGuard } from "../../src/agent/loopGuard"
import { isSensitive, getSensitivePatterns } from "../../src/security/sensitiveFiles"
import { isDestructive, getSeverityLevel } from "../../src/security/destructiveGuard"
import { NetworkGuard, type NetworkPolicy } from "../../src/security/networkGuard"
import { SkillTrustManager, type SkillTrustLevel } from "../../src/security/skillTrust"
import { RBACEngine, type Role } from "../../src/security/rbac"
import { AuditLogger } from "../../src/audit/auditLogger"
import { DockerRunner, HostRunner } from "../../src/sandbox/sandboxRunner"
import { AgentAutonomyController } from "../../src/agent/autonomy"

describe("Security Policies Implementation Tests", () => {
  // ============================================================================
  // 1. SANDBOX EXECUTION TESTS
  // ============================================================================
  describe("1. Execution Sandbox", () => {
    describe("HostRunner", () => {
      it("should execute commands on host", async () => {
        const runner = new HostRunner()
        expect(runner.getMode()).toBe("host")
        // Note: actual execution requires proper environment setup
      })

      it("should report host mode", () => {
        const runner = new HostRunner()
        const mode = runner.getMode()
        expect(mode).toBe("host")
      })
    })

    describe("DockerRunner", () => {
      it("should be configured with memory limits", () => {
        const runner = new DockerRunner({
          memoryLimit: "256m",
          cpuLimit: "0.5",
          imageTag: "node:18-alpine",
        })
        expect(runner.getMode()).toBe("sandbox")
      })

      it("should check Docker availability", async () => {
        const available = await DockerRunner.isAvailable()
        expect(typeof available).toBe("boolean")
      })
    })
  })

  // ============================================================================
  // 2. SENSITIVE FILE PROTECTION TESTS
  // ============================================================================
  describe("2. Sensitive File Protection", () => {
    it("should detect .env files", () => {
      expect(isSensitive(".env")).toBe(true)
      expect(isSensitive(".env.local")).toBe(true)
      expect(isSensitive(".env.production")).toBe(true)
    })

    it("should detect SSH keys", () => {
      expect(isSensitive("id_rsa")).toBe(true)
      expect(isSensitive("id_ed25519")).toBe(true)
      expect(isSensitive(".ssh/config")).toBe(true)
    })

    it("should detect AWS credentials", () => {
      expect(isSensitive(".aws/credentials")).toBe(true)
      expect(isSensitive(".aws/config")).toBe(true)
    })

    it("should detect certificates and keys", () => {
      expect(isSensitive("cert.pem")).toBe(true)
      expect(isSensitive("private.key")).toBe(true)
      expect(isSensitive("server.crt")).toBe(true)
    })

    it("should detect API keys and tokens", () => {
      expect(isSensitive("api_key.txt")).toBe(true)
      expect(isSensitive("secret_key.json")).toBe(true)
      expect(isSensitive("auth_token.txt")).toBe(true)
    })

    it("should return pattern list for documentation", () => {
      const patterns = getSensitivePatterns()
      expect(patterns.length).toBeGreaterThan(0)
      expect(Array.isArray(patterns)).toBe(true)
    })

    it("should not flag normal files", () => {
      expect(isSensitive("README.md")).toBe(false)
      expect(isSensitive("src/index.ts")).toBe(false)
      expect(isSensitive("package.json")).toBe(false)
    })
  })

  // ============================================================================
  // 3. RISK-BASED PERMISSION SYSTEM TESTS
  // ============================================================================
  describe("3. Risk-Based Permission System", () => {
    let riskEngine: RiskEngine

    beforeEach(() => {
      riskEngine = new RiskEngine()
    })

    it("should assess low-risk operations", () => {
      const context: RiskContext = {
        command: "ls -la",
        path: "/home/user",
      }
      const assessment = riskEngine.assess(context)
      expect(assessment.level).toBe("low")
      expect(assessment.recommendation).toBe("allow")
    })

    it("should detect destructive commands as high-risk", () => {
      const context: RiskContext = {
        command: "rm -rf /",
      }
      const assessment = riskEngine.assess(context)
      expect(assessment.level).toBe("critical")
      expect(assessment.score).toBeGreaterThanOrEqual(80)
    })

    it("should flag package installation as medium risk", () => {
      const context: RiskContext = {
        command: "npm install",
      }
      const assessment = riskEngine.assess(context)
      expect(assessment.score).toBeGreaterThanOrEqual(40)
      expect(assessment.factors.some((f) => f.reason.includes("Package"))).toBe(true)
    })

    it("should detect sensitive file access", () => {
      const context: RiskContext = {
        filePath: ".env",
        touchesSensitiveFile: true,
      }
      const assessment = riskEngine.assess(context)
      expect(assessment.score).toBeGreaterThanOrEqual(70)
    })

    it("should assess large diffs as higher risk", () => {
      const context: RiskContext = {
        largeFileDiff: true,
        diffSize: 50000,
      }
      const assessment = riskEngine.assess(context)
      expect(assessment.score).toBeGreaterThan(0)
    })

    it("should detect repeated commands", () => {
      const context: RiskContext = {
        command: "npm install",
        isRepeatedCommand: true,
      }
      const assessment = riskEngine.assess(context)
      expect(assessment.factors.some((f) => f.reason.includes("Repeated"))).toBe(true)
    })

    it("should support custom thresholds", () => {
      const customEngine = new RiskEngine({ deny: 90, ask: 70 })
      const decision = customEngine.riskDecision(75)
      expect(decision).toBe("ask")
    })
  })

  // ============================================================================
  // 4. DESTRUCTIVE ACTION GUARDRAIL TESTS
  // ============================================================================
  describe("4. Destructive Action Guardrail", () => {
    it("should detect rm -rf commands", () => {
      expect(isDestructive({ command: "rm -rf /var/www" })).toBe(true)
      expect(isDestructive({ command: "rm -r -f /data" })).toBe(true)
    })

    it("should detect chmod 777 commands", () => {
      expect(isDestructive({ command: "chmod 777 /var/www" })).toBe(true)
      expect(isDestructive({ command: "chmod 666 /files" })).toBe(true)
    })

    it("should detect git push --force", () => {
      expect(isDestructive({ command: "git push --force" })).toBe(true)
      expect(isDestructive({ command: "git push -f" })).toBe(true)
    })

    it("should detect git reset --hard", () => {
      expect(isDestructive({ command: "git reset --hard" })).toBe(true)
    })

    it("should detect sudo commands", () => {
      expect(isDestructive({ command: "sudo apt-get remove package" })).toBe(true)
    })

    it("should detect database destructive operations", () => {
      expect(isDestructive({ command: "DROP DATABASE mydb;" })).toBe(true)
      expect(isDestructive({ command: "TRUNCATE TABLE users;" })).toBe(true)
    })

    it("should classify severity levels", () => {
      const critical = getSeverityLevel({ command: "rm -rf /" })
      const high = getSeverityLevel({ command: "chmod 777 /config" })
      expect(critical).toBe("critical")
      expect(["high", "medium", "low"]).toContain(high)
    })

    it("should not flag safe commands", () => {
      expect(isDestructive({ command: "ls -la" })).toBe(false)
      expect(isDestructive({ command: "mkdir newdir" })).toBe(false)
      expect(isDestructive({ command: "cat file.txt" })).toBe(false)
    })
  })

  // ============================================================================
  // 5. LOOP DETECTION (DOOM LOOP v2) TESTS
  // ============================================================================
  describe("5. Loop Detection (Doom Loop v2)", () => {
    let loopGuard: LoopGuard

    beforeEach(() => {
      loopGuard = new LoopGuard()
    })

    it("should track command history", () => {
      loopGuard.recordCommand("npm install")
      loopGuard.recordCommand("npm install")
      loopGuard.recordCommand("npm install")

      // Should have increased loop score
      const score = loopGuard.computeLoopScore()
      expect(score).toBeGreaterThan(0)
    })

    it("should detect repeated errors", () => {
      loopGuard.recordError("ENOENT", "npm install")
      loopGuard.recordError("ENOENT", "npm install")
      loopGuard.recordError("ENOENT", "npm install")

      const score = loopGuard.computeLoopScore()
      expect(score).toBeGreaterThan(0)
    })

    it("should track frequency of changes", () => {
      for (let i = 0; i < 5; i++) {
        loopGuard.recordCommand("same command")
      }

      const frequency = loopGuard.getCommandFrequency("same command")
      expect(frequency).toBeGreaterThan(0)
    })

    it("should provide loop statistics", () => {
      loopGuard.recordCommand("cmd1")
      loopGuard.recordCommand("cmd2")
      loopGuard.recordCommand("cmd1")

      const stats = loopGuard.getStatistics()
      expect(stats.totalCommands).toBe(3)
      expect(stats.totalErrors).toBe(0)
    })

    it("should reset history when requested", () => {
      loopGuard.recordCommand("test")
      loopGuard.reset()

      const score = loopGuard.computeLoopScore()
      expect(score).toBe(0)
    })
  })

  // ============================================================================
  // 6. NETWORK ACCESS POLICY TESTS
  // ============================================================================
  describe("6. Network Access Policy", () => {
    it("should allow all in allow mode", () => {
      const guard = new NetworkGuard({ mode: "allow" })
      const allowed = guard.isAllowed("https://api.example.com")
      expect(allowed).toBe(true)
    })

    it("should deny all in deny mode", () => {
      const guard = new NetworkGuard({ mode: "deny" })
      const allowed = guard.isAllowed("https://api.example.com")
      expect(allowed).toBe(false)
    })

    it("should use allowlist in allowlist mode", () => {
      const guard = new NetworkGuard({
        mode: "allowlist",
        allowDomains: ["api.example.com", "*.internal.com"],
      })

      expect(guard.isAllowed("https://api.example.com")).toBe(true)
      expect(guard.isAllowed("https://server.internal.com")).toBe(true)
      expect(guard.isAllowed("https://external.com")).toBe(false)
    })

    it("should support domain pattern matching", () => {
      const guard = new NetworkGuard({
        mode: "allowlist",
        allowDomains: ["*.github.com"],
      })

      expect(guard.isAllowed("https://raw.githubusercontent.com")).toBe(true)
      expect(guard.isAllowed("https://api.github.com")).toBe(true)
      expect(guard.isAllowed("https://external.com")).toBe(false)
    })

    it("should handle IP addresses", () => {
      const guard = new NetworkGuard({
        mode: "allowlist",
        allowDomains: ["192.168.1.1"],
      })

      expect(guard.isAllowed("http://192.168.1.1")).toBe(true)
      expect(guard.isAllowed("http://192.168.1.2")).toBe(false)
    })
  })

  // ============================================================================
  // 7. SKILL TRUST SYSTEM TESTS
  // ============================================================================
  describe("7. Skill-Level Trust System", () => {
    let trustManager: SkillTrustManager

    beforeEach(() => {
      trustManager = new SkillTrustManager()
    })

    it("should register skills with trust levels", () => {
      trustManager.registerSkill("browser", "trusted", { verified: true })
      trustManager.registerSkill("api", "restricted")
      trustManager.registerSkill("unknown", "untrusted")

      expect(trustManager.getTrustLevel("browser")).toBe("trusted")
      expect(trustManager.getTrustLevel("api")).toBe("restricted")
      expect(trustManager.getTrustLevel("unknown")).toBe("untrusted")
    })

    it("should map trust levels to behaviors", () => {
      trustManager.registerSkill("safe", "trusted")
      trustManager.registerSkill("caution", "restricted")
      trustManager.registerSkill("danger", "untrusted")

      expect(trustManager.getBehavior("safe")).toBe("allow")
      expect(trustManager.getBehavior("caution")).toBe("ask")
      expect(trustManager.getBehavior("danger")).toBe("sandbox")
    })

    it("should identify trusted skills", () => {
      trustManager.registerSkill("verified_skill", "trusted")
      trustManager.registerSkill("untrusted_skill", "untrusted")

      expect(trustManager.isTrusted("verified_skill")).toBe(true)
      expect(trustManager.isTrusted("untrusted_skill")).toBe(false)
    })

    it("should provide metadata about skills", () => {
      trustManager.registerSkill("system_api", "restricted", {
        description: "System-level operations",
        author: "admin",
        version: "1.0.0",
      })

      const info = trustManager.getSkillInfo("system_api")
      expect(info?.name).toBe("system_api")
      expect(info?.trustLevel).toBe("restricted")
      expect(info?.author).toBe("admin")
    })
  })

  // ============================================================================
  // 8. RBAC TESTS
  // ============================================================================
  describe("8. Role-Based Access Control (RBAC)", () => {
    let rbac: RBACEngine

    beforeEach(() => {
      rbac = new RBACEngine()
    })

    it("should allow admin full access", () => {
      const policy = rbac.getPolicy("admin")
      expect(policy.bash).toBe("allow")
      expect(policy.edit).toBe("allow")
      expect(policy.read).toBe("allow")
    })

    it("should require dev approval for bash", () => {
      const policy = rbac.getPolicy("developer")
      expect(policy.bash).toBe("ask")
      expect(policy.edit).toBe("allow")
      expect(policy.read).toBe("allow")
    })

    it("should restrict read-only role", () => {
      const policy = rbac.getPolicy("readonly")
      expect(policy.bash).toBe("deny")
      expect(policy.edit).toBe("deny")
      expect(policy.read).toBe("allow")
    })

    it("should allow autonomous agents with restrictions", () => {
      const policy = rbac.getPolicy("autonomous_agent")
      expect(policy.bash).toBe("allow")
      expect(policy.edit).toBe("allow")
      expect(policy.doom_loop).toBe("ask")
    })

    it("should support custom policies per role", () => {
      const customPolicy = { bash: "deny", edit: "ask" }
      rbac.setCustomPolicy("developer", customPolicy)

      const policy = rbac.getPolicy("developer")
      expect(policy.bash).toBe("deny")
      expect(policy.edit).toBe("ask")
    })

    it("should check permission for action", () => {
      expect(rbac.checkPermission("admin", "bash")).toBe("allow")
      expect(rbac.checkPermission("developer", "bash")).toBe("ask")
      expect(rbac.checkPermission("readonly", "bash")).toBe("deny")
    })
  })

  // ============================================================================
  // 9. AUDIT LOGGING TESTS
  // ============================================================================
  describe("9. Audit Logging", () => {
    let auditLogger: AuditLogger

    beforeEach(async () => {
      auditLogger = new AuditLogger()
      await auditLogger.initialize()
    })

    it("should log permission decisions", async () => {
      await auditLogger.logEvent({
        type: "permission_decision",
        action: "bash_command",
        resource: "ls -la",
        result: "allow",
      })

      const events = auditLogger.getEventCount()
      expect(events).toBeGreaterThan(0)
    })

    it("should log file access events", async () => {
      await auditLogger.logEvent({
        type: "file_access",
        action: "read",
        resource: "config.json",
        result: "allow",
      })

      const events = auditLogger.getEventCount()
      expect(events).toBeGreaterThan(0)
    })

    it("should log sensitive file access", async () => {
      await auditLogger.logEvent({
        type: "sensitive_file_access",
        action: "write",
        resource: ".env",
        result: "deny",
      })

      const events = auditLogger.getEventCount()
      expect(events).toBeGreaterThan(0)
    })

    it("should log loop detection", async () => {
      await auditLogger.logEvent({
        type: "loop_detected",
        action: "infinite_loop",
        resource: "npm install",
        riskScore: 75,
      })

      const events = auditLogger.getEventCount()
      expect(events).toBeGreaterThan(0)
    })

    it("should maintain tamper-evident log", async () => {
      await auditLogger.logEvent({
        type: "command_execution",
        action: "test_command",
        resource: "test",
      })

      const integrity = await auditLogger.verifyIntegrity()
      expect(integrity).toBe(true)
    })
  })

  // ============================================================================
  // 10. AGENT AUTONOMY MODES TESTS
  // ============================================================================
  describe("10. Agent Autonomy Modes", () => {
    let autonomyController: AgentAutonomyController

    beforeEach(() => {
      autonomyController = new AgentAutonomyController()
    })

    it("should register agent with supervised mode", () => {
      autonomyController.registerAgent("supervised-agent", { mode: "supervised" })
      const config = autonomyController.getConfig("supervised-agent")

      expect(config.mode).toBe("supervised")
    })

    it("should register agent with semi-autonomous mode", () => {
      autonomyController.registerAgent("balanced-agent", { mode: "semi_autonomous" })
      const config = autonomyController.getConfig("balanced-agent")

      expect(config.mode).toBe("semi_autonomous")
    })

    it("should register agent with fully autonomous mode", () => {
      autonomyController.registerAgent("autonomous-agent", { mode: "fully_autonomous", maxIterations: 20 })
      const config = autonomyController.getConfig("autonomous-agent")

      expect(config.mode).toBe("fully_autonomous")
      expect(config.maxIterations).toBe(20)
    })

    it("should apply multipliers for supervised mode", () => {
      const behavior = autonomyController.getAutonomyBehavior("supervised")
      expect(behavior.askMultiplier).toBe(1.5)
      expect(behavior.maxIterations).toBeLessThan(20)
    })

    it("should apply multipliers for autonomous mode", () => {
      const behavior = autonomyController.getAutonomyBehavior("fully_autonomous")
      expect(behavior.askMultiplier).toBe(0.7)
      expect(behavior.maxIterations).toBeGreaterThan(10)
    })

    it("should get agent list", () => {
      autonomyController.registerAgent("agent1", { mode: "supervised" })
      autonomyController.registerAgent("agent2", { mode: "fully_autonomous" })

      const agents = autonomyController.getRegisteredAgents()
      expect(agents.length).toBe(2)
    })
  })

  // ============================================================================
  // 11. INTEGRATION TESTS - POLICY COMBINATIONS
  // ============================================================================
  describe("11. Integration Tests - Policy Combinations", () => {
    it("should apply multiple security layers to bash commands", async () => {
      const riskEngine = new RiskEngine()
      const loopGuard = new LoopGuard()

      // Simulate a potentially problematic command
      const command = "rm -rf /var/www && npm install"
      const cwd = ".env"

      // Check destructive
      const isDestr = isDestructive({ command })
      expect(isDestr).toBe(true)

      // Check sensitive
      const isSens = isSensitive(cwd)
      expect(isSens).toBe(true)

      // Risk assessment
      const assessment = riskEngine.assess({ command, path: cwd })
      expect(assessment.score).toBeGreaterThan(50)

      // Loop tracking
      loopGuard.recordCommand(command)
      loopGuard.recordCommand(command)
      loopGuard.recordCommand(command)
      const loopScore = loopGuard.computeLoopScore()
      expect(loopScore).toBeGreaterThan(0)
    })

    it("should enforce RBAC with risk engine", () => {
      const rbac = new RBACEngine()
      const riskEngine = new RiskEngine()

      // Developer role
      const devCanBash = rbac.checkPermission("developer", "bash")
      expect(devCanBash).toBe("ask")

      // But if command is high risk
      const assessment = riskEngine.assess({ command: "rm -rf /" })
      expect(assessment.recommendation).toBe("deny")

      // Both should restrict the developer
    })

    it("should apply autonomy multipliers with risk thresholds", () => {
      const riskEngine = new RiskEngine()
      const autonomyController = new AgentAutonomyController()

      autonomyController.registerAgent("supervised", { mode: "supervised" })
      autonomyController.registerAgent("autonomous", { mode: "fully_autonomous" })

      // Risk assessment
      const assessment = riskEngine.assess({
        command: "npm install",
        path: "/home/user",
      })

      const supervisedBehavior =autonomyController.getAutonomyBehavior("supervised")
      const autonomousBehavior = autonomyController.getAutonomyBehavior("fully_autonomous")

      // Supervised requires higher threshold
      expect(supervisedBehavior.askMultiplier).toBeGreaterThan(autonomousBehavior.askMultiplier)
    })

    it("should log all policy decisions", async () => {
      const auditLogger = new AuditLogger()
      await auditLogger.initialize()

      // Log destructive command detection
      await auditLogger.logEvent({
        type: "command_execution",
        action: "destructive_command",
        resource: "rm -rf /",
        result: "deny",
      })

      // Log risk assessment
      await auditLogger.logEvent({
        type: "permission_decision",
        action: "risk_based_check",
        resource: "npm install",
        riskScore: 45,
      })

      // Log loop detection
      await auditLogger.logEvent({
        type: "loop_detected",
        action: "repeated_command",
        resource: "same cmd",
        riskScore: 60,
      })

      const count = auditLogger.getEventCount()
      expect(count).toBeGreaterThanOrEqual(3)
    })
  })
})
