import { Log } from "../util/log"
import { isSensitive } from "./sensitiveFiles"
import { isDestructive, getSeverityLevel } from "./destructiveGuard"

const log = Log.create({ service: "risk-engine" })

/**
 * Context for risk assessment
 */
export interface RiskContext {
  command?: string
  path?: string
  filePath?: string
  touchesSensitiveFile?: boolean
  action?: string
  largeFileDiff?: boolean
  diffSize?: number
  isDelete?: boolean
  commandHistory?: string[]
  errorHistory?: string[]
  isRepeatedCommand?: boolean
  isRepeatedError?: boolean
  iterations?: number
}

/**
 * Risk assessment result
 */
export interface RiskAssessment {
  score: number
  factors: Array<{ reason: string; points: number }>
  level: "critical" | "high" | "medium" | "low"
  recommendation: "deny" | "ask" | "allow"
}

/**
 * Risk-based permission engine
 * Scores actions and determines whether they should be allowed, asked about, or denied
 */
export class RiskEngine {
  private thresholds = {
    deny: 80,
    ask: 40,
    allow: 0,
  }

  constructor(thresholds?: { deny?: number; ask?: number }) {
    if (thresholds?.deny) this.thresholds.deny = thresholds.deny
    if (thresholds?.ask) this.thresholds.ask = thresholds.ask
  }

  /**
   * Compute risk score for an action
   */
  computeRisk(context: RiskContext): number {
    let score = 0
    const factors: Array<{ reason: string; points: number }> = []

    // Bash command risks
    if (context.command) {
      // Destructive commands
      if (isDestructive({ command: context.command })) {
        const severity = getSeverityLevel({ command: context.command })
        const points =
          severity === "critical" ? 95 : severity === "high" ? 85 : severity === "medium" ? 60 : 30
        score += points
        factors.push({ reason: `Destructive command (${severity})`, points })
      }

      // Package installation
      if (/npm\s+install|yarn\s+install|apt-get\s+install|pip\s+install|brew\s+install/.test(context.command)) {
        score += 40
        factors.push({ reason: "Package installation can introduce dependencies", points: 40 })
      }

      // Network/external calls
      if (/curl|wget|fetch|http/.test(context.command)) {
        score += 30
        factors.push({ reason: "External network request", points: 30 })
      }

      // Sensitive file touches
      if (/\.env|\.key|\.pem|secret|password|token|credential/.test(context.command)) {
        score += 70
        factors.push({ reason: "References sensitive content", points: 70 })
      }
    }

    // File access risks
    if (context.filePath) {
      if (isSensitive(context.filePath)) {
        score += 70
        factors.push({ reason: "Sensitive file", points: 70 })
      }
    }

    // Large diffs (potential for significant changes)
    if (context.diffSize) {
      if (context.diffSize > 10000) {
        score += 50
        factors.push({ reason: "Very large file changes (10KB+)", points: 50 })
      } else if (context.diffSize > 1000) {
        score += 30
        factors.push({ reason: "Large file changes (1KB+)", points: 30 })
      }
    }

    // Deletion operations
    if (context.isDelete) {
      score += 40
      factors.push({ reason: "File deletion operation", points: 40 })
    }

    // Loop detection signals
    if (context.isRepeatedCommand) {
      score += 30
      factors.push({ reason: "Command repeated multiple times", points: 30 })
    }

    if (context.isRepeatedError) {
      score += 40
      factors.push({ reason: "Repeated error detected", points: 40 })
    }

    if (context.iterations && context.iterations > 10) {
      score += 20
      factors.push({ reason: `High iteration count (${context.iterations})`, points: 20 })
    }

    log.debug("Risk assessment computed", { score, factors: factors.length, context })

    return Math.min(100, score) // Cap at 100
  }

  /**
   * Assess complete risk for an action
   */
  assess(context: RiskContext): RiskAssessment {
    const score = this.computeRisk(context)
    const factors: Array<{ reason: string; points: number }> = []

    // Re-compute factors for the assessment
    if (context.command) {
      if (isDestructive({ command: context.command })) {
        const severity = getSeverityLevel({ command: context.command })
        const points =
          severity === "critical" ? 95 : severity === "high" ? 85 : severity === "medium" ? 60 : 30
        factors.push({ reason: `Destructive command (${severity})`, points })
      }

      if (/npm\s+install|yarn\s+install|apt-get\s+install|pip\s+install|brew\s+install/.test(context.command)) {
        factors.push({ reason: "Package installation", points: 40 })
      }

      if (/curl|wget|fetch|http/.test(context.command)) {
        factors.push({ reason: "External network request", points: 30 })
      }

      if (/\.env|\.key|\.pem|secret|password|token|credential/.test(context.command)) {
        factors.push({ reason: "References sensitive content", points: 70 })
      }
    }

    if (context.filePath && isSensitive(context.filePath)) {
      factors.push({ reason: "Sensitive file", points: 70 })
    }

    if (context.diffSize) {
      if (context.diffSize > 10000) {
        factors.push({ reason: "Very large file changes", points: 50 })
      } else if (context.diffSize > 1000) {
        factors.push({ reason: "Large file changes", points: 30 })
      }
    }

    if (context.isDelete) {
      factors.push({ reason: "File deletion", points: 40 })
    }

    if (context.isRepeatedCommand) {
      factors.push({ reason: "Repeated command", points: 30 })
    }

    if (context.isRepeatedError) {
      factors.push({ reason: "Repeated error", points: 40 })
    }

    // Determine level
    let level: "critical" | "high" | "medium" | "low"
    if (score >= 80) level = "critical"
    else if (score >= 60) level = "high"
    else if (score >= 40) level = "medium"
    else level = "low"

    // Determine recommendation
    const recommendation = this.riskDecision(score)

    return {
      score,
      factors,
      level,
      recommendation,
    }
  }

  /**
   * Convert risk score to permission decision
   */
  riskDecision(score: number): "deny" | "ask" | "allow" {
    if (score >= this.thresholds.deny) return "deny"
    if (score >= this.thresholds.ask) return "ask"
    return "allow"
  }

  /**
   * Set custom thresholds
   */
  setThresholds(thresholds: { deny?: number; ask?: number }): void {
    if (thresholds.deny !== undefined) this.thresholds.deny = thresholds.deny
    if (thresholds.ask !== undefined) this.thresholds.ask = thresholds.ask
  }
}

export const defaultRiskEngine = new RiskEngine()
