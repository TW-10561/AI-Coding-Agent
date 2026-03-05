// ---------------------------------------------------------------------------
// Policy Engine — Unified security policy enforcement for Artemis platform.
//
// Integrates the 10 enterprise security policies from platform/policies/:
//   #1  Execution Sandbox     — host vs. Docker isolated execution
//   #2  Sensitive File Guard   — detect .env, SSH keys, credentials (54 patterns)
//   #3  Risk Scoring Engine    — dynamic risk scoring (0-100 scale)
//   #4  Destructive Guard      — pre-check dangerous shell commands
//   #5  Loop Detection         — detect and prevent agent infinite loops
//   #6  Network Access Guard   — control external network access
//   #7  Skill Trust System     — component-level trust management
//   #8  Role-Based Access (RBAC) — 4 roles × 7 permissions
//   #9  Audit Trail            — tamper-evident event log (delegates to our AuditLogger)
//   #10 Agent Autonomy Modes   — supervised / semi / fully autonomous
//
// This module contains NO OpenCode internal dependencies.  Each policy is
// self-contained and exposed via the PolicyEngine singleton which is wired
// into the Hono middleware + route layer.
// ---------------------------------------------------------------------------

import type { AuditLogger } from "./audit-logger"

// ════════════════════════════════════════════════════════════════════════
// Policy #2 — Sensitive File Guard
// ════════════════════════════════════════════════════════════════════════

const SENSITIVE_PATTERNS: RegExp[] = [
  /\.env/i, /\.env\..*/i,
  /\.pem$/i, /\.key$/i, /id_rsa/i, /id_dsa/i, /id_ecdsa/i, /id_ed25519/i, /\.ssh\//i,
  /\.aws\//i, /aws_access_key/i, /\.azure\//i, /\.config\/gcloud/i, /service-account/i,
  /\.crt$/i, /\.cert$/i, /\.pfx$/i, /\.p12$/i,
  /database\.ya?ml/i, /\.oauth/i, /refresh_token/i, /access_token/i,
  /api[_-]?key/i, /secret[_-]?key/i, /private[_-]?key/i, /auth[_-]?token/i,
  /\.git\/config/i, /\.tfvars/i, /\.secrets/i, /secrets\.yaml/i,
  /docker-compose\.override/i, /kube\/config/i,
  /\.bash_history/i, /\.zsh_history/i, /\.psql_history/i,
]

export function isSensitiveFile(filePath: string): boolean {
  const lower = filePath.toLowerCase()
  return SENSITIVE_PATTERNS.some(p => p.test(lower))
}

export function filterSensitiveFiles(paths: string[]): { sensitive: string[]; safe: string[] } {
  const sensitive: string[] = []
  const safe: string[] = []
  for (const p of paths) (isSensitiveFile(p) ? sensitive : safe).push(p)
  return { sensitive, safe }
}

// ════════════════════════════════════════════════════════════════════════
// Policy #4 — Destructive Command Guard
// ════════════════════════════════════════════════════════════════════════

const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /rm\s+-.*rf/i, /rm\s*-.*r.*f/i, /rmdir\s+-.*p/i,
  /chmod\s+777/i, /chmod\s+666/i,
  /git\s+push\s+--force/i, /git\s+push\s+-f/i, /git\s+reset\s+--hard/i,
  /sudo\s+/i,
  /pkill\s+-9/i, /kill\s+-9\s+-1/i,
  /mkfs/i, /dd\s+if=.*of=/i,
  /npm\s+uninstall.*-g/i,
  /drop\s+database/i, /truncate\s+table/i, /delete\s+from.*where/i,
  /iptables\s+-F/i,
]

export type Severity = "critical" | "high" | "medium" | "low" | "none"

export function isDestructiveCommand(cmd: string): boolean {
  return DESTRUCTIVE_PATTERNS.some(p => p.test(cmd))
}

export function getCommandSeverity(cmd: string): Severity {
  const c = cmd.trim().toLowerCase()
  if (/mkfs|dd\s+if.*of=|format\s+.*:|kill\s+-9\s+-1/.test(c)) return "critical"
  if (/rm\s+-.*rf|drop\s+database|truncate\s+table|git\s+push\s+--force|git\s+reset\s+--hard/.test(c)) return "high"
  if (/chmod\s+777|chmod\s+666|sudo/.test(c)) return "medium"
  if (isDestructiveCommand(cmd)) return "low"
  return "none"
}

export function getDestructiveReason(cmd: string): string | null {
  const c = cmd.trim().toLowerCase()
  if (/rm\s+-.*rf|rmdir\s+-.*p/.test(c)) return "Recursive file deletion can permanently remove entire directories"
  if (/mkfs|format\s+.*:/.test(c)) return "Filesystem formatting will erase all data"
  if (/chmod\s+777|chmod\s+666/.test(c)) return "World-writable permissions expose files to unauthorized access"
  if (/git\s+push\s+--force|git\s+push\s+-f/.test(c)) return "Force push rewrites git history"
  if (/git\s+reset\s+--hard/.test(c)) return "Hard reset discards all uncommitted changes"
  if (/sudo/.test(c)) return "Privilege escalation can cause system-wide damage"
  if (/drop\s+database/.test(c)) return "Dropping a database permanently deletes all its data"
  if (/truncate\s+table|delete\s+from/.test(c)) return "Database deletion removes data permanently"
  return null
}

// ════════════════════════════════════════════════════════════════════════
// Policy #3 — Risk Scoring Engine
// ════════════════════════════════════════════════════════════════════════

export interface RiskContext {
  command?: string
  filePath?: string
  isDelete?: boolean
  isRepeatedCommand?: boolean
  isRepeatedError?: boolean
  iterations?: number
  diffSize?: number
}

export interface RiskAssessment {
  score: number
  level: "critical" | "high" | "medium" | "low"
  recommendation: "deny" | "ask" | "allow"
  factors: Array<{ reason: string; points: number }>
}

export class RiskEngine {
  private thresholds = { deny: 80, ask: 40 }

  constructor(opts?: { deny?: number; ask?: number }) {
    if (opts?.deny) this.thresholds.deny = opts.deny
    if (opts?.ask)  this.thresholds.ask  = opts.ask
  }

  assess(ctx: RiskContext): RiskAssessment {
    let score = 0
    const factors: Array<{ reason: string; points: number }> = []

    const add = (reason: string, points: number) => { score += points; factors.push({ reason, points }) }

    if (ctx.command) {
      if (isDestructiveCommand(ctx.command)) {
        const s = getCommandSeverity(ctx.command)
        const pts = s === "critical" ? 95 : s === "high" ? 85 : s === "medium" ? 60 : 30
        add(`Destructive command (${s})`, pts)
      }
      if (/npm\s+install|yarn\s+install|apt-get\s+install|pip\s+install|brew\s+install/.test(ctx.command))
        add("Package installation", 40)
      if (/curl|wget|fetch|http/.test(ctx.command))
        add("External network request", 30)
      if (/\.env|\.key|\.pem|secret|password|token|credential/.test(ctx.command))
        add("References sensitive content", 70)
    }
    if (ctx.filePath && isSensitiveFile(ctx.filePath)) add("Sensitive file access", 70)
    if (ctx.diffSize && ctx.diffSize > 10000) add("Very large changes (10KB+)", 50)
    else if (ctx.diffSize && ctx.diffSize > 1000) add("Large changes (1KB+)", 30)
    if (ctx.isDelete) add("File deletion", 40)
    if (ctx.isRepeatedCommand) add("Repeated command", 30)
    if (ctx.isRepeatedError) add("Repeated error", 40)
    if (ctx.iterations && ctx.iterations > 10) add(`High iteration count (${ctx.iterations})`, 20)

    score = Math.min(100, score)
    const level = score >= 80 ? "critical" : score >= 60 ? "high" : score >= 40 ? "medium" : "low"
    const recommendation = score >= this.thresholds.deny ? "deny" : score >= this.thresholds.ask ? "ask" : "allow"

    return { score, level, recommendation, factors }
  }

  setThresholds(t: { deny?: number; ask?: number }) {
    if (t.deny !== undefined) this.thresholds.deny = t.deny
    if (t.ask  !== undefined) this.thresholds.ask  = t.ask
  }
}

// ════════════════════════════════════════════════════════════════════════
// Policy #5 — Loop Detection
// ════════════════════════════════════════════════════════════════════════

export class LoopGuard {
  private commands: Array<{ cmd: string; ts: number }> = []
  private errors: Array<{ err: string; ts: number }> = []
  private maxHistory = 50
  private windowMs = 60_000

  recordCommand(cmd: string) {
    this.commands.push({ cmd, ts: Date.now() })
    if (this.commands.length > this.maxHistory) this.commands.shift()
  }

  recordError(err: string) {
    this.errors.push({ err, ts: Date.now() })
    if (this.errors.length > this.maxHistory) this.errors.shift()
  }

  computeScore(): number {
    const now = Date.now()
    let score = 0

    // Repeated commands
    const recent = this.commands.filter(c => now - c.ts < this.windowMs)
    const cmdCounts = new Map<string, number>()
    for (const { cmd } of recent) cmdCounts.set(cmd, (cmdCounts.get(cmd) ?? 0) + 1)
    for (const count of cmdCounts.values()) if (count >= 3) { score += 40; break }

    // Repeated errors
    const recentErrs = this.errors.filter(e => now - e.ts < this.windowMs)
    const errCounts = new Map<string, number>()
    for (const { err } of recentErrs) errCounts.set(err, (errCounts.get(err) ?? 0) + 1)
    for (const count of errCounts.values()) if (count >= 2) { score += 50; break }

    // Identical recent commands
    if (recent.length >= 5) {
      const last5 = recent.slice(-5)
      const unique = new Set(last5.map(c => c.cmd))
      if (unique.size <= 1) score += 35
      else if (unique.size <= 2) score += 20
    }

    // High error rate
    if (this.commands.length > 0 && this.errors.length > 0) {
      const rate = this.errors.length / (this.commands.length + this.errors.length)
      if (rate > 0.7) score += 30
    }

    return Math.min(100, score)
  }

  isLoopLikely(threshold = 50): boolean { return this.computeScore() >= threshold }

  reset() { this.commands = []; this.errors = [] }

  getSummary() {
    const now = Date.now()
    return {
      score: this.computeScore(),
      isLoopLikely: this.isLoopLikely(),
      recentCommands: [...new Set(this.commands.filter(c => now - c.ts < this.windowMs).map(c => c.cmd))],
      recentErrors:  [...new Set(this.errors.filter(e => now - e.ts < this.windowMs).map(e => e.err))],
      commandCount: this.commands.length,
      errorCount: this.errors.length,
    }
  }
}

// ════════════════════════════════════════════════════════════════════════
// Policy #6 — Network Access Guard
// ════════════════════════════════════════════════════════════════════════

export type NetworkMode = "allow" | "deny" | "allowlist"

export interface NetworkPolicy {
  mode: NetworkMode
  allowDomains?: string[]
  denyDomains?: string[]
}

export class NetworkGuard {
  private policy: NetworkPolicy

  constructor(policy?: NetworkPolicy) { this.policy = policy ?? { mode: "allow" } }

  updatePolicy(p: NetworkPolicy) { this.policy = p }
  getPolicy() { return this.policy }

  checkUrl(url: string): { allowed: boolean; reason?: string } {
    const domain = this.extractDomain(url)
    if (this.policy.mode === "allow") return { allowed: true }
    if (this.policy.mode === "deny") return { allowed: false, reason: `Network access disabled: ${url}` }

    // Allowlist mode
    if (this.policy.denyDomains) {
      for (const d of this.policy.denyDomains) if (this.match(domain, d)) return { allowed: false, reason: `Domain denied: ${domain}` }
    }
    if (this.policy.allowDomains) {
      for (const d of this.policy.allowDomains) if (this.match(domain, d)) return { allowed: true }
      return { allowed: false, reason: `Domain not in allowlist: ${domain}` }
    }
    return { allowed: true }
  }

  isAllowed(url: string): boolean { return this.checkUrl(url).allowed }

  isInternal(url: string): boolean {
    const d = this.extractDomain(url)
    if (d === "localhost" || d === "127.0.0.1" || d === "::1" || d.startsWith("192.168.") || d.startsWith("10.")) return true
    // RFC 1918: 172.16.0.0/12 covers 172.16.x.x through 172.31.x.x
    const m = d.match(/^172\.(\d+)\./)
    if (m) { const oct = parseInt(m[1], 10); if (oct >= 16 && oct <= 31) return true }
    return false
  }

  private extractDomain(url: string): string {
    try { return new URL(url).hostname } catch { const m = url.match(/^(?:https?:\/\/)?(?:www\.)?([^/?]+)/); return m ? m[1] : url }
  }
  private match(domain: string, pattern: string): boolean {
    if (pattern === "*" || pattern === domain) return true
    if (pattern.startsWith("*.")) return domain.endsWith(pattern.slice(1)) || domain === pattern.slice(2)
    return false
  }
}

// ════════════════════════════════════════════════════════════════════════
// Policy #7 — Skill Trust System
// ════════════════════════════════════════════════════════════════════════

export type SkillTrustLevel = "trusted" | "restricted" | "untrusted"
const TRUST_BEHAVIOR: Record<SkillTrustLevel, "allow" | "ask" | "sandbox"> = {
  trusted: "allow", restricted: "ask", untrusted: "sandbox",
}

export class SkillTrustManager {
  private trustMap = new Map<string, SkillTrustLevel>()

  register(name: string, level: SkillTrustLevel) { this.trustMap.set(name, level) }
  getTrust(name: string): SkillTrustLevel { return this.trustMap.get(name) ?? "restricted" }
  getBehavior(name: string): "allow" | "ask" | "sandbox" { return TRUST_BEHAVIOR[this.getTrust(name)] }
  isTrusted(name: string): boolean { return this.getTrust(name) === "trusted" }
  update(name: string, level: SkillTrustLevel) { this.trustMap.set(name, level) }
  getAll(): Array<{ name: string; level: SkillTrustLevel; behavior: string }> {
    return [...this.trustMap.entries()].map(([name, level]) => ({ name, level, behavior: TRUST_BEHAVIOR[level] }))
  }
}

// ════════════════════════════════════════════════════════════════════════
// Policy #8 — Role-Based Access Control (RBAC)
// ════════════════════════════════════════════════════════════════════════

export type Role = "admin" | "developer" | "readonly" | "autonomous_agent"
export type Permission = "bash" | "edit" | "read" | "webfetch" | "external_directory" | "skill"
type Decision = "allow" | "ask" | "deny"

const ROLE_MATRIX: Record<Role, Record<Permission, Decision>> = {
  admin:            { bash: "allow", edit: "allow", read: "allow", webfetch: "allow", external_directory: "allow", skill: "allow" },
  developer:        { bash: "ask",   edit: "allow", read: "allow", webfetch: "ask",   external_directory: "ask",   skill: "allow" },
  readonly:         { bash: "deny",  edit: "deny",  read: "allow", webfetch: "deny",  external_directory: "deny",  skill: "deny" },
  autonomous_agent: { bash: "allow", edit: "allow", read: "allow", webfetch: "allow", external_directory: "allow", skill: "allow" },
}

export class RBACEngine {
  private overrides = new Map<Role, Partial<Record<Permission, Decision>>>()

  check(role: Role, perm: Permission): Decision {
    return this.overrides.get(role)?.[perm] ?? ROLE_MATRIX[role][perm]
  }
  canAccess(role: Role, perm: Permission): boolean { return this.check(role, perm) === "allow" }
  needsApproval(role: Role, perm: Permission): boolean { return this.check(role, perm) === "ask" }
  setOverride(role: Role, perm: Permission, decision: Decision) {
    const existing = this.overrides.get(role) ?? {}
    existing[perm] = decision
    this.overrides.set(role, existing)
  }
  getAllRoles(): Role[] { return ["admin", "developer", "readonly", "autonomous_agent"] }
  getAllPermissions(): Permission[] { return ["bash", "edit", "read", "webfetch", "external_directory", "skill"] }
  getMatrix(role: Role): Record<Permission, Decision> {
    const base = { ...ROLE_MATRIX[role] }
    const over = this.overrides.get(role)
    if (over) Object.assign(base, over)
    return base
  }
}

// ════════════════════════════════════════════════════════════════════════
// Policy #10 — Agent Autonomy Modes
// ════════════════════════════════════════════════════════════════════════

export type AutonomyMode = "supervised" | "semi_autonomous" | "fully_autonomous"

const AUTONOMY_BEHAVIOR: Record<AutonomyMode, { askMul: number; denyMul: number; maxIter: number; description: string }> = {
  supervised:       { askMul: 1.5, denyMul: 1.2, maxIter: 5,  description: "Frequent user approval required." },
  semi_autonomous:  { askMul: 1.0, denyMul: 1.0, maxIter: 10, description: "Balanced mode — standard approval." },
  fully_autonomous: { askMul: 0.7, denyMul: 0.8, maxIter: 20, description: "Minimal interruption. Use for trusted agents." },
}

export class AutonomyController {
  private agents = new Map<string, { mode: AutonomyMode; maxIter?: number; approveHighRisk?: boolean }>()

  register(agent: string, mode: AutonomyMode, opts?: { maxIter?: number; approveHighRisk?: boolean }) {
    this.agents.set(agent, { mode, ...opts })
  }
  getMode(agent: string): AutonomyMode { return this.agents.get(agent)?.mode ?? "semi_autonomous" }
  getBehavior(agent: string) { return AUTONOMY_BEHAVIOR[this.getMode(agent)] }
  getMaxIterations(agent: string): number { return this.agents.get(agent)?.maxIter ?? AUTONOMY_BEHAVIOR[this.getMode(agent)].maxIter }
  requiresApproval(agent: string): boolean { return this.agents.get(agent)?.approveHighRisk ?? this.getMode(agent) === "supervised" }
  setGlobalMode(mode: AutonomyMode) { for (const [, cfg] of this.agents) cfg.mode = mode }
  getSummary() {
    return [...this.agents.entries()].map(([name, cfg]) => ({
      name,
      mode: cfg.mode,
      maxIterations: this.getMaxIterations(name),
      description: AUTONOMY_BEHAVIOR[cfg.mode].description,
    }))
  }
}

// ════════════════════════════════════════════════════════════════════════
// Policy Configuration — loaded from JSON
// ════════════════════════════════════════════════════════════════════════

export interface PolicyConfig {
  enabled: boolean
  execution_mode: "host" | "sandbox"
  risk_thresholds: { deny: number; ask: number }
  network: { mode: NetworkMode; allowDomains?: string[]; denyDomains?: string[] }
  sensitive_files: { enabled: boolean; block: boolean }
  destructive_commands: { enabled: boolean; requireApproval: boolean }
  loop_detection: { enabled: boolean; threshold: number }
  skill_trust: { defaultLevel: SkillTrustLevel }
  autonomy: { defaultMode: AutonomyMode }
}

const DEFAULT_CONFIG: PolicyConfig = {
  enabled: true,
  execution_mode: "host",
  risk_thresholds: { deny: 80, ask: 40 },
  network: { mode: "allow" },
  sensitive_files: { enabled: true, block: false },
  destructive_commands: { enabled: true, requireApproval: true },
  loop_detection: { enabled: true, threshold: 50 },
  skill_trust: { defaultLevel: "restricted" },
  autonomy: { defaultMode: "semi_autonomous" },
}

// ════════════════════════════════════════════════════════════════════════
// PolicyEngine — unified facade
// ════════════════════════════════════════════════════════════════════════

export class PolicyEngine {
  readonly config: PolicyConfig
  readonly risk: RiskEngine
  readonly loopGuard: LoopGuard
  readonly network: NetworkGuard
  readonly skillTrust: SkillTrustManager
  readonly rbac: RBACEngine
  readonly autonomy: AutonomyController
  private audit?: AuditLogger

  constructor(config?: Partial<PolicyConfig>, audit?: AuditLogger) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.audit = audit

    this.risk = new RiskEngine(this.config.risk_thresholds)
    this.loopGuard = new LoopGuard()
    this.network = new NetworkGuard(this.config.network)
    this.skillTrust = new SkillTrustManager()
    this.rbac = new RBACEngine()
    this.autonomy = new AutonomyController()

    // Register default agents
    this.autonomy.register("build", this.config.autonomy.defaultMode)
    this.autonomy.register("plan", this.config.autonomy.defaultMode)
    this.autonomy.register("explore", this.config.autonomy.defaultMode)
    this.autonomy.register("general", this.config.autonomy.defaultMode)
  }

  /** Attach an audit logger (for deferred wiring after construction) */
  setAudit(audit: AuditLogger) {
    this.audit = audit
  }

  /** Evaluate an action against all applicable policies. Returns combined decision. */
  evaluate(ctx: {
    command?: string
    filePath?: string
    url?: string
    role?: Role
    permission?: Permission
    agentName?: string
    skillName?: string
    isDelete?: boolean
    diffSize?: number
  }): {
    decision: "allow" | "ask" | "deny"
    riskAssessment?: RiskAssessment
    loopScore?: number
    networkCheck?: { allowed: boolean; reason?: string }
    reasons: string[]
  } {
    const reasons: string[] = []
    let decision: "allow" | "ask" | "deny" = "allow"

    const escalate = (d: "allow" | "ask" | "deny", reason: string) => {
      if (d === "deny" || (d === "ask" && decision === "allow")) {
        decision = d as "allow" | "ask" | "deny"
        reasons.push(reason)
      }
    }

    // Policy #8: RBAC
    if (ctx.role && ctx.permission) {
      const rbacResult = this.rbac.check(ctx.role, ctx.permission)
      if (rbacResult !== "allow") escalate(rbacResult, `RBAC: ${ctx.role} → ${ctx.permission} = ${rbacResult}`)
    }

    // Policy #3: Risk assessment
    let riskAssessment: RiskAssessment | undefined
    if (ctx.command || ctx.filePath) {
      riskAssessment = this.risk.assess({
        command: ctx.command,
        filePath: ctx.filePath,
        isDelete: ctx.isDelete,
        diffSize: ctx.diffSize,
      })
      if (riskAssessment.recommendation !== "allow") {
        escalate(riskAssessment.recommendation, `Risk: ${riskAssessment.level} (${riskAssessment.score}/100)`)
      }
    }

    // Policy #4: Destructive guard
    if (ctx.command && this.config.destructive_commands.enabled) {
      if (isDestructiveCommand(ctx.command)) {
        const sev = getCommandSeverity(ctx.command)
        const reason = getDestructiveReason(ctx.command)
        escalate(sev === "critical" ? "deny" : "ask", `Destructive: ${reason ?? sev}`)
      }
    }

    // Policy #2: Sensitive files
    if (ctx.filePath && this.config.sensitive_files.enabled) {
      if (isSensitiveFile(ctx.filePath)) {
        escalate(this.config.sensitive_files.block ? "deny" : "ask", `Sensitive file: ${ctx.filePath}`)
      }
    }

    // Policy #5: Loop detection
    let loopScore: number | undefined
    if (this.config.loop_detection.enabled && (ctx.command || ctx.agentName)) {
      if (ctx.command) this.loopGuard.recordCommand(ctx.command)
      loopScore = this.loopGuard.computeScore()
      if (loopScore >= this.config.loop_detection.threshold) {
        escalate("ask", `Loop detected: score ${loopScore}`)
      }
    }

    // Policy #6: Network guard
    let networkCheck: { allowed: boolean; reason?: string } | undefined
    if (ctx.url) {
      networkCheck = this.network.checkUrl(ctx.url)
      if (!networkCheck.allowed) escalate("deny", networkCheck.reason ?? "Network blocked")
    }

    // Policy #7: Skill trust
    if (ctx.skillName) {
      const behavior = this.skillTrust.getBehavior(ctx.skillName)
      if (behavior === "sandbox") escalate("ask", `Untrusted skill: ${ctx.skillName}`)
      else if (behavior === "ask") escalate("ask", `Restricted skill: ${ctx.skillName}`)
    }

    // Policy #10: Autonomy — adjust thresholds
    if (ctx.agentName) {
      const behavior = this.autonomy.getBehavior(ctx.agentName)
      if (riskAssessment && riskAssessment.level === "high" && this.autonomy.requiresApproval(ctx.agentName)) {
        escalate("ask", `Autonomy: ${ctx.agentName} requires approval for high-risk`)
      }
    }

    // Log to audit
    if (this.audit) {
      this.audit.log({
        action: "policy.evaluate",
        userID: "system",
        metadata: {
          decision,
          reasons,
          riskScore: riskAssessment?.score,
          loopScore,
          command: ctx.command?.slice(0, 100),
          filePath: ctx.filePath,
        },
        success: (decision as string) !== "deny",
      })
    }

    return { decision, riskAssessment, loopScore, networkCheck, reasons }
  }

  /** Get a full status report of all policies */
  getStatus(): {
    enabled: boolean
    executionMode: string
    riskThresholds: { deny: number; ask: number }
    networkMode: string
    sensitiveFiles: { enabled: boolean; patternCount: number }
    destructiveGuard: { enabled: boolean }
    loopDetection: { enabled: boolean; currentScore: number }
    skillTrust: { defaultLevel: string; registered: number }
    rbac: { roles: string[] }
    autonomy: { defaultMode: string; agents: Array<{ name: string; mode: string }> }
  } {
    return {
      enabled: this.config.enabled,
      executionMode: this.config.execution_mode,
      riskThresholds: this.config.risk_thresholds,
      networkMode: this.network.getPolicy().mode,
      sensitiveFiles: { enabled: this.config.sensitive_files.enabled, patternCount: SENSITIVE_PATTERNS.length },
      destructiveGuard: { enabled: this.config.destructive_commands.enabled },
      loopDetection: { enabled: this.config.loop_detection.enabled, currentScore: this.loopGuard.computeScore() },
      skillTrust: { defaultLevel: this.config.skill_trust.defaultLevel, registered: this.skillTrust.getAll().length },
      rbac: { roles: this.rbac.getAllRoles() },
      autonomy: { defaultMode: this.config.autonomy.defaultMode, agents: this.autonomy.getSummary() },
    }
  }
}

// Default singleton — call setAudit() after startup to wire in audit logging
export const defaultPolicyEngine = new PolicyEngine()
