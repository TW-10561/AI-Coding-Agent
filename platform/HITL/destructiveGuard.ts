import { Log } from "../util/log"

const log = Log.create({ service: "destructive-guard" })

/**
 * Patterns for dangerous commands that should always require approval
 */
export const DESTRUCTIVE_PATTERNS = [
  // Recursive delete
  /rm\s+-.*rf/i,
  /rm\s*-.*r.*f/i,
  /rmdir\s+-.*p/i,

  // Permission changes to world-writable
  /chmod\s+777/i,
  /chmod\s+666/i,

  // Forced operations
  /git\s+push\s+--force/i,
  /git\s+push\s+-f/i,
  /git\s+reset\s+--hard/i,

  // Sudo operations (privilege escalation)
  /sudo\s+/i,

  // System-level changes
  /pkill\s+-9/i,
  /kill\s+-9\s+-1/i,

  // Format/wipe operations
  /mkfs/i,
  /dd\s+if=.*of=/i,
  /format\s+.*--force/i,

  // Destructive npm/yarn
  /npm\s+uninstall.*-g/i,

  // Database operations
  /drop\s+database/i,
  /truncate\s+table/i,
  /delete\s+from.*where/i,

  // Network reset
  /iptables\s+-F/i,

  // Shell options that disable safeguards
  /set\s+-o\s+ignoreeof/i,
]

/**
 * Context about the command being executed
 */
export interface DestructiveContext {
  command: string
  workingDirectory?: string
  user?: string
}

/**
 * Check if a command matches destructive patterns
 */
export function isDestructive(context: DestructiveContext): boolean {
  const cmd = context.command.trim()

  for (const pattern of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(cmd)) {
      log.warn("Detected destructive command", {
        command: cmd,
        pattern: pattern.source,
        cwd: context.workingDirectory,
      })
      return true
    }
  }

  return false
}

/**
 * Get the severity level of a destructive command
 * Used to determine if it should be auto-denied or just require extra confirmation
 */
export function getSeverityLevel(context: DestructiveContext): "critical" | "high" | "medium" | "low" | "none" {
  const cmd = context.command.trim().toLowerCase()

  // Critical - system-wide destruction
  if (/mkfs|dd\s+if.*of=|format\s+.*:|kill\s+-9\s+-1|rm\s+-.*rf\s+\/\s*$|rm\s+-.*rf\s+\/[^a-z]/.test(cmd)) {
    return "critical"
  }

  // High - data loss
  if (/rm\s+-.*rf|drop\s+database|truncate\s+table|git\s+push\s+--force|git\s+reset\s+--hard/.test(cmd)) {
    return "high"
  }

  // Medium - permission/security
  if (/chmod\s+777|chmod\s+666|sudo/.test(cmd)) {
    return "medium"
  }

  return "none"
}

/**
 * Get human-readable description of why a command is dangerous
 */
export function getDestructiveReason(context: DestructiveContext): string | null {
  const cmd = context.command.trim().toLowerCase()

  if (/rm\s+-.*rf|rmdir\s+-.*p/.test(cmd)) {
    return "Recursive file deletion can permanently remove entire directories"
  }

  if (/mkfs|format\s+.*:/.test(cmd)) {
    return "Filesystem formatting will erase all data on the device"
  }

  if (/chmod\s+777|chmod\s+666/.test(cmd)) {
    return "Setting world-writable permissions exposes files to unauthorized access"
  }

  if (/git\s+push\s+--force|git\s+push\s+-f/.test(cmd)) {
    return "Force push rewrites git history and can lose changes for other developers"
  }

  if (/git\s+reset\s+--hard/.test(cmd)) {
    return "Hard reset discards all uncommitted changes permanently"
  }

  if (/sudo/.test(cmd)) {
    return "Privilege escalation (sudo) can cause system-wide damage"
  }

  if (/drop\s+database/.test(cmd)) {
    return "Dropping a database permanently deletes all its data"
  }

  if (/truncate\s+table|delete\s+from/.test(cmd)) {
    return "Database deletion operations will remove data permanently"
  }

  return null
}
