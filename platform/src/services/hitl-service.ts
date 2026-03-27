// ---------------------------------------------------------------------------
// HITL (Human-in-the-Loop) Service
//
// Bridges the HITL security modules (platform/HITL/) with the platform's
// PolicyEngine to provide approval workflows, risk gating, and audit trails.
//
// Flow:
//   1. Action arrives (bash command, file edit, network request, etc.)
//   2. PolicyEngine evaluates risk, RBAC, destructive guards, etc.
//   3. If decision is "ask" → create a pending approval request
//   4. VSCode extension shows approval dialog to the user
//   5. User approves/denies → action proceeds or is blocked
//   6. All decisions are audit-logged
// ---------------------------------------------------------------------------

import type { AuditLogger } from "./audit-logger"
import type {
  PolicyEngine,
  RiskAssessment,
  Role,
  Permission,
  AutonomyMode,
} from "./policy-engine"

// ── Types ─────────────────────────────────────────────────────────────

export interface ApprovalRequest {
  id: string
  createdAt: number
  expiresAt: number
  status: "pending" | "approved" | "denied" | "expired"
  resolvedAt?: number
  resolvedBy?: string

  // What triggered the approval
  action: string
  resource?: string
  command?: string
  filePath?: string
  url?: string
  agentName?: string
  skillName?: string

  // Risk context from PolicyEngine
  riskScore?: number
  riskLevel?: string
  reasons: string[]
  decision: "ask" | "deny"

  // Metadata for display
  description?: string
  severity?: "critical" | "high" | "medium" | "low"
}

export interface HITLConfig {
  /** How long approval requests remain pending before auto-expiring (ms) */
  approvalTimeoutMs: number
  /** Whether to auto-approve low-risk actions in fully_autonomous mode */
  autoApproveInAutonomous: boolean
  /** Max pending approvals before new requests are auto-denied */
  maxPendingApprovals: number
}

const DEFAULT_HITL_CONFIG: HITLConfig = {
  approvalTimeoutMs: 5 * 60 * 1000, // 5 minutes
  autoApproveInAutonomous: true,
  maxPendingApprovals: 50,
}

// ── HITL Service ──────────────────────────────────────────────────────

export class HITLService {
  private pending: Map<string, ApprovalRequest> = new Map()
  private resolved: ApprovalRequest[] = []
  private config: HITLConfig
  private policyEngine: PolicyEngine
  private audit?: AuditLogger
  private idCounter = 0
  private listeners: Array<(req: ApprovalRequest) => void> = []

  constructor(
    policyEngine: PolicyEngine,
    audit?: AuditLogger,
    config?: Partial<HITLConfig>,
  ) {
    this.policyEngine = policyEngine
    this.audit = audit
    this.config = { ...DEFAULT_HITL_CONFIG, ...config }

    // Expire old requests every 30s
    setInterval(() => this.expireOldRequests(), 30_000)
  }

  /** Register a listener for new approval requests (used by SSE/WebSocket) */
  onApprovalRequest(listener: (req: ApprovalRequest) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  /**
   * Evaluate an action and create an approval request if needed.
   * Returns the approval decision immediately for "allow" and "deny".
   * For "ask", returns the pending approval request.
   */
  evaluate(ctx: {
    action: string
    command?: string
    filePath?: string
    url?: string
    role?: Role
    permission?: Permission
    agentName?: string
    skillName?: string
    isDelete?: boolean
    diffSize?: number
    description?: string
  }): {
    decision: "allow" | "ask" | "deny"
    approvalRequest?: ApprovalRequest
    riskAssessment?: RiskAssessment
    reasons: string[]
  } {
    // Auto-map action → RBAC role+permission when not explicitly provided.
    // Tool executor passes "bash"/"edit"/"read"/"web_fetch" as action strings;
    // map these to the Permission type so RBAC matrix is applied.
    const ACTION_TO_PERMISSION: Record<string, Permission> = {
      bash: "bash", edit: "edit", read: "read",
      web_fetch: "webfetch", webfetch: "webfetch",
      external_directory: "external_directory",
      doom_loop: "doom_loop", skill: "skill",
    }
    const enriched = { ...ctx }
    if (!enriched.role) enriched.role = "developer"
    if (!enriched.permission && ACTION_TO_PERMISSION[ctx.action]) {
      enriched.permission = ACTION_TO_PERMISSION[ctx.action]
    }

    // Run through PolicyEngine
    const result = this.policyEngine.evaluate(enriched)

    // If allowed, pass through
    if (result.decision === "allow") {
      this.logDecision(ctx, "allow", result.reasons, result.riskAssessment?.score)
      return {
        decision: "allow",
        riskAssessment: result.riskAssessment,
        reasons: result.reasons,
      }
    }

    // Check autonomy: fully autonomous agents can auto-approve "ask" decisions
    if (
      result.decision === "ask" &&
      this.config.autoApproveInAutonomous &&
      ctx.agentName
    ) {
      const mode = this.policyEngine.autonomy.getMode(ctx.agentName)
      if (mode === "fully_autonomous" && result.riskAssessment?.level !== "critical") {
        this.logDecision(ctx, "allow", [...result.reasons, "Auto-approved (fully_autonomous)"], result.riskAssessment?.score)
        return {
          decision: "allow",
          riskAssessment: result.riskAssessment,
          reasons: [...result.reasons, "Auto-approved (fully_autonomous)"],
        }
      }
    }

    // Hard deny for critical severity
    if (result.decision === "deny") {
      this.logDecision(ctx, "deny", result.reasons, result.riskAssessment?.score)
      return {
        decision: "deny",
        riskAssessment: result.riskAssessment,
        reasons: result.reasons,
      }
    }

    // Create approval request for "ask" decisions
    if (this.pending.size >= this.config.maxPendingApprovals) {
      this.logDecision(ctx, "deny", [...result.reasons, "Too many pending approvals"], result.riskAssessment?.score)
      return {
        decision: "deny",
        riskAssessment: result.riskAssessment,
        reasons: [...result.reasons, "Too many pending approvals"],
      }
    }

    const request = this.createApprovalRequest(ctx, result)
    return {
      decision: "ask",
      approvalRequest: request,
      riskAssessment: result.riskAssessment,
      reasons: result.reasons,
    }
  }

  /** Resolve a pending approval request */
  resolve(
    requestId: string,
    decision: "approved" | "denied",
    resolvedBy?: string,
  ): ApprovalRequest | null {
    const request = this.pending.get(requestId)
    if (!request) return null

    request.status = decision
    request.resolvedAt = Date.now()
    request.resolvedBy = resolvedBy

    this.pending.delete(requestId)
    this.resolved.push(request)

    // Keep resolved list bounded
    if (this.resolved.length > 200) {
      this.resolved = this.resolved.slice(-100)
    }

    // Audit log
    if (this.audit) {
      this.audit.log({
        action: "hitl.resolved",
        userID: resolvedBy ?? "user",
        metadata: {
          requestId,
          decision,
          action: request.action,
          command: request.command,
          riskScore: request.riskScore,
        },
        success: decision === "approved",
      })
    }

    return request
  }

  /** Get a specific pending request */
  getRequest(id: string): ApprovalRequest | undefined {
    return this.pending.get(id)
  }

  /** Get all pending requests */
  getPending(): ApprovalRequest[] {
    return [...this.pending.values()]
  }

  /** Get resolved requests (recent) */
  getResolved(limit = 50): ApprovalRequest[] {
    return this.resolved.slice(-limit)
  }

  /** Get a combined view of all requests */
  getAll(limit = 100): ApprovalRequest[] {
    const all = [...this.pending.values(), ...this.resolved]
    all.sort((a, b) => b.createdAt - a.createdAt)
    return all.slice(0, limit)
  }

  /** Get HITL statistics */
  getStats(): {
    pendingCount: number
    resolvedCount: number
    approvedCount: number
    deniedCount: number
    expiredCount: number
    avgResponseTimeMs: number
  } {
    const approved = this.resolved.filter((r) => r.status === "approved")
    const denied = this.resolved.filter((r) => r.status === "denied")
    const expired = this.resolved.filter((r) => r.status === "expired")
    const withTime = this.resolved.filter((r) => r.resolvedAt)
    const avgTime =
      withTime.length > 0
        ? withTime.reduce((sum, r) => sum + (r.resolvedAt! - r.createdAt), 0) / withTime.length
        : 0

    return {
      pendingCount: this.pending.size,
      resolvedCount: this.resolved.length,
      approvedCount: approved.length,
      deniedCount: denied.length,
      expiredCount: expired.length,
      avgResponseTimeMs: Math.round(avgTime),
    }
  }

  /** Update autonomy mode for an agent */
  setAutonomyMode(agentName: string, mode: AutonomyMode): void {
    this.policyEngine.autonomy.register(agentName, mode)
  }

  // ── Private helpers ─────────────────────────────────────────────

  private createApprovalRequest(
    ctx: {
      action: string
      command?: string
      filePath?: string
      url?: string
      agentName?: string
      skillName?: string
      description?: string
    },
    result: {
      decision: "allow" | "ask" | "deny"
      riskAssessment?: RiskAssessment
      reasons: string[]
    },
  ): ApprovalRequest {
    const id = `hitl_${Date.now()}_${++this.idCounter}`
    const now = Date.now()

    const severity: ApprovalRequest["severity"] = result.riskAssessment
      ? result.riskAssessment.level === "critical"
        ? "critical"
        : result.riskAssessment.level === "high"
          ? "high"
          : result.riskAssessment.level === "medium"
            ? "medium"
            : "low"
      : "medium"

    const request: ApprovalRequest = {
      id,
      createdAt: now,
      expiresAt: now + this.config.approvalTimeoutMs,
      status: "pending",
      action: ctx.action,
      resource: ctx.filePath ?? ctx.url ?? ctx.command,
      command: ctx.command,
      filePath: ctx.filePath,
      url: ctx.url,
      agentName: ctx.agentName,
      skillName: ctx.skillName,
      riskScore: result.riskAssessment?.score,
      riskLevel: result.riskAssessment?.level,
      reasons: result.reasons,
      decision: result.decision as "ask" | "deny",
      description: ctx.description,
      severity,
    }

    this.pending.set(id, request)

    // Notify listeners
    for (const listener of this.listeners) {
      try {
        listener(request)
      } catch {
        // Swallow listener errors
      }
    }

    // Audit log
    if (this.audit) {
      this.audit.log({
        action: "hitl.request_created",
        userID: "system",
        metadata: {
          requestId: id,
          action: ctx.action,
          command: ctx.command?.slice(0, 100),
          riskScore: result.riskAssessment?.score,
          severity,
          reasons: result.reasons,
        },
        success: true,
      })
    }

    return request
  }

  private expireOldRequests(): void {
    const now = Date.now()
    for (const [id, req] of this.pending) {
      if (now > req.expiresAt) {
        req.status = "expired"
        req.resolvedAt = now
        this.pending.delete(id)
        this.resolved.push(req)

        if (this.audit) {
          this.audit.log({
            action: "hitl.expired",
            userID: "system",
            metadata: { requestId: id, action: req.action },
            success: false,
          })
        }
      }
    }
  }

  private logDecision(
    ctx: { action: string; command?: string; filePath?: string },
    decision: string,
    reasons: string[],
    riskScore?: number,
  ): void {
    if (this.audit) {
      this.audit.log({
        action: "hitl.auto_decision",
        userID: "system",
        metadata: {
          decision,
          action: ctx.action,
          command: ctx.command?.slice(0, 100),
          filePath: ctx.filePath,
          riskScore,
          reasons,
        },
        success: decision === "allow",
      })
    }
  }

  /** Clean up resources */
  dispose(): void {
    this.pending.clear()
    this.listeners = []
  }
}
