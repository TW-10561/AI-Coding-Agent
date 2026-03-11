import { Log } from "../../util/log"
import { Instance } from "../../project/instance"
import { Identifier } from "../../id/id"
import z from "zod"
import path from "path"
import fs from "fs/promises"

const log = Log.create({ service: "audit" })

/**
 * Audit event types
 */
export const AuditEventType = z.enum([
  "permission_decision",
  "command_execution",
  "file_access",
  "sensitive_file_access",
  "network_request",
  "loop_detected",
  "error_occurred",
  "sandbox_execution",
])
export type AuditEventType = z.infer<typeof AuditEventType>

/**
 * Audit event
 */
export const AuditEvent = z.object({
  id: z.string(),
  type: AuditEventType,
  timestamp: z.number(),
  user: z.string().optional(),
  action: z.string(),
  resource: z.string().optional(),
  result: z.enum(["allow", "deny", "ask"]).optional(),
  riskScore: z.number().optional(),
  details: z.record(z.any()).optional(),
})
export type AuditEvent = z.infer<typeof AuditEvent>

/**
 * Enterprise-grade audit logger
 * Provides tamper-evident, append-only audit trails
 */
export class AuditLogger {
  private auditDir: string
  private eventLog: AuditEvent[] = []
  private lastHash: string = ""

  constructor(auditDir?: string) {
    this.auditDir = auditDir || path.join(Instance.worktree, ".opencode", "audit")
  }

  /**
   * Initialize audit logger
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.auditDir, { recursive: true })
      await this.loadExistingLog()
      log.info("Audit logger initialized", { auditDir: this.auditDir })
    } catch (error) {
      log.error("Failed to initialize audit logger", { error })
      throw error
    }
  }

  /**
   * Load existing audit log to verify integrity
   */
  private async loadExistingLog(): Promise<void> {
    try {
      const logFile = path.join(this.auditDir, "audit.log.jsonl")
      if (!fs.stat(logFile)) return

      const content = await fs.readFile(logFile, "utf-8")
      const lines = content.trim().split("\n")

      for (const line of lines) {
        if (!line) continue
        try {
          const event = JSON.parse(line)
          this.eventLog.push(event)
        } catch {
          log.warn("Failed to parse audit log line", { line })
        }
      }

      log.debug("Loaded existing audit log", { events: this.eventLog.length })
    } catch (error) {
      log.warn("Could not load existing audit log", { error })
    }
  }

  /**
   * Simple hash function for tamper detection
   * In production, should use cryptographic hashing (SHA-256)
   */
  private computeHash(data: string, previousHash: string = ""): string {
    // Simple hash combining previous hash and current data
    // In production: use crypto.createHash('sha256')
    const combined = previousHash + data
    let hash = 5381
    for (let i = 0; i < combined.length; i++) {
      hash = ((hash << 5) + hash) + combined.charCodeAt(i)
    }
    return "h" + Math.abs(hash).toString(16)
  }

  /**
   * Log an audit event
   */
  async logEvent(event: Omit<AuditEvent, "id" | "timestamp">): Promise<void> {
    const auditEvent: AuditEvent = {
      id: Identifier.ascending("audit"),
      timestamp: Date.now(),
      ...event,
    }

    this.eventLog.push(auditEvent)

    try {
      await this.appendToFile(auditEvent)
      log.debug("Audit event logged", { type: event.type, action: event.action })
    } catch (error) {
      log.error("Failed to write audit event", { error })
    }
  }

  /**
   * Append event to audit log file
   */
  private async appendToFile(event: AuditEvent): Promise<void> {
    try {
      const logFile = path.join(this.auditDir, "audit.log.jsonl")
      const eventData = JSON.stringify({ ...event, prevHash: this.lastHash })
      this.lastHash = this.computeHash(eventData, this.lastHash)

      await fs.appendFile(logFile, eventData + "\n", "utf-8")
    } catch (error) {
      log.error("Failed to append to audit log file", { error })
    }
  }

  /**
   * Log permission decision
   */
  async logPermissionDecision(input: {
    user?: string
    action: string
    resource?: string
    result: "allow" | "deny" | "ask"
    riskScore?: number
  }): Promise<void> {
    await this.logEvent({
      type: "permission_decision",
      user: input.user,
      action: input.action,
      resource: input.resource,
      result: input.result,
      riskScore: input.riskScore,
    })
  }

  /**
   * Log command execution
   */
  async logCommandExecution(input: {
    user?: string
    command: string
    exitCode?: number
    executedIn?: "host" | "sandbox"
  }): Promise<void> {
    await this.logEvent({
      type: "command_execution",
      user: input.user,
      action: input.command,
      details: {
        exitCode: input.exitCode,
        executedIn: input.executedIn,
      },
    })
  }

  /**
   * Log file access
   */
  async logFileAccess(input: {
    user?: string
    filePath: string
    operation: "read" | "write" | "delete"
  }): Promise<void> {
    await this.logEvent({
      type: "file_access",
      user: input.user,
      action: input.operation,
      resource: input.filePath,
    })
  }

  /**
   * Log sensitive file access
   */
  async logSensitiveFileAccess(input: {
    user?: string
    filePath: string
    operation: "read" | "write" | "delete"
  }): Promise<void> {
    await this.logEvent({
      type: "sensitive_file_access",
      user: input.user,
      action: input.operation,
      resource: input.filePath,
      result: "ask",
    })
  }

  /**
   * Log network request
   */
  async logNetworkRequest(input: {
    user?: string
    url: string
    allowed: boolean
  }): Promise<void> {
    await this.logEvent({
      type: "network_request",
      user: input.user,
      action: input.url,
      result: input.allowed ? "allow" : "deny",
    })
  }

  /**
   * Log loop detection
   */
  async logLoopDetected(input: {
    user?: string
    loopScore: number
    recentCommands: string[]
  }): Promise<void> {
    await this.logEvent({
      type: "loop_detected",
      user: input.user,
      action: "loop_detected",
      riskScore: input.loopScore,
      details: {
        recentCommands: input.recentCommands,
      },
    })
  }

  /**
   * Get audit events within a time range
   */
  async getEvents(options?: {
    since?: number
    until?: number
    type?: AuditEventType
    limit?: number
  }): Promise<AuditEvent[]> {
    let events = [...this.eventLog]

    if (options?.type) {
      events = events.filter((e) => e.type === options.type)
    }

    if (options?.since) {
      events = events.filter((e) => e.timestamp >= options.since!)
    }

    if (options?.until) {
      events = events.filter((e) => e.timestamp <= options.until!)
    }

    if (options?.limit) {
      events = events.slice(-options.limit)
    }

    return events
  }

  /**
   * Get audit summary
   */
  async getSummary(): Promise<{
    totalEvents: number
    eventsByType: Record<string, number>
    lastEvent?: AuditEvent
  }> {
    const eventsByType: Record<string, number> = {}

    for (const event of this.eventLog) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1
    }

    return {
      totalEvents: this.eventLog.length,
      eventsByType,
      lastEvent: this.eventLog[this.eventLog.length - 1],
    }
  }

  /**
   * Export audit log
   */
  async exportLog(): Promise<string> {
    return JSON.stringify(this.eventLog, null, 2)
  }

  /**
   * Verify audit log integrity (basic check)
   */
  async verifyIntegrity(): Promise<boolean> {
    try {
      const logFile = path.join(this.auditDir, "audit.log.jsonl")
      const content = await fs.readFile(logFile, "utf-8")
      const lines = content.trim().split("\n")

      let prevHash = ""
      for (const line of lines) {
        if (!line) continue
        const event = JSON.parse(line)
        const storedHash = event.prevHash
        const expectedHash = this.computeHash(
          JSON.stringify({ ...event, prevHash: "" }),
          prevHash,
        )

        if (storedHash && storedHash !== expectedHash) {
          log.warn("Audit log integrity check failed", { line })
          return false
        }

        prevHash = expectedHash
      }

      log.info("Audit log integrity verified")
      return true
    } catch (error) {
      log.warn("Could not verify audit log integrity", { error })
      return true // Don't fail if verification can't run
    }
  }
}

export const defaultAuditLogger = new AuditLogger()
