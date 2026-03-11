import { Log } from "../../util/log"

const log = Log.create({ service: "loop-guard" })

/**
 * Loop detection and prevention system
 * Detects when an agent gets stuck in a loop or repeatedly fails
 */
export class LoopGuard {
  private commandHistory: Array<{ command: string; timestamp: number }> = []
  private errorHistory: Array<{ error: string; timestamp: number; command?: string }> = []
  private maxHistorySize = 50
  private windowMs = 60000 // 1 minute window for pattern detection

  /**
   * Score indicating loop likelihood
   */
  private score: number = 0

  /**
   * Record a command execution
   */
  recordCommand(command: string): void {
    this.commandHistory.push({
      command,
      timestamp: Date.now(),
    })

    // Keep history size manageable
    if (this.commandHistory.length > this.maxHistorySize) {
      this.commandHistory.shift()
    }

    log.debug("Command recorded", { command, historySize: this.commandHistory.length })
  }

  /**
   * Record an error
   */
  recordError(error: string, command?: string): void {
    this.errorHistory.push({
      error,
      timestamp: Date.now(),
      command,
    })

    // Keep history size manageable
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory.shift()
    }

    log.debug("Error recorded", { error, command, historySize: this.errorHistory.length })
  }

  /**
   * Compute loop score based on patterns
   */
  computeLoopScore(): number {
    this.score = 0
    const now = Date.now()

    // Check for repeated commands in recent history
    if (this.commandHistory.length >= 3) {
      const recentCommands = this.commandHistory.filter((c) => now - c.timestamp < this.windowMs)

      // Count duplicates
      const commandCounts = new Map<string, number>()
      for (const { command } of recentCommands) {
        commandCounts.set(command, (commandCounts.get(command) || 0) + 1)
      }

      for (const count of commandCounts.values()) {
        if (count >= 3) {
          this.score += 40
          log.warn("Detected repeated command pattern")
          break
        }
      }
    }

    // Check for repeated errors
    if (this.errorHistory.length >= 2) {
      const recentErrors = this.errorHistory.filter((e) => now - e.timestamp < this.windowMs)

      const errorCounts = new Map<string, number>()
      for (const { error } of recentErrors) {
        errorCounts.set(error, (errorCounts.get(error) || 0) + 1)
      }

      for (const count of errorCounts.values()) {
        if (count >= 2) {
          this.score += 50
          log.warn("Detected repeated error pattern")
          break
        }
      }
    }

    // Check if commands are changing (if not, likely a loop)
    if (this.commandHistory.length >= 5) {
      const recent = this.commandHistory.slice(-5)
      const unique = new Set(recent.map((c) => c.command))

      if (unique.size <= 1) {
        this.score += 35
        log.warn("All recent commands are identical")
      } else if (unique.size <= 2) {
        this.score += 20
        log.warn("Very few unique commands in recent history")
      }
    }

    // Check for high error rate
    if (this.commandHistory.length > 0 && this.errorHistory.length > 0) {
      const errorRate = this.errorHistory.length / (this.commandHistory.length + this.errorHistory.length)
      if (errorRate > 0.7) {
        this.score += 30
        log.warn("High error rate detected", { errorRate })
      }
    }

    // Cap score at 100
    this.score = Math.min(100, this.score)

    log.debug("Loop score computed", { score: this.score })
    return this.score
  }

  /**
   * Get current loop score
   */
  getScore(): number {
    return this.score
  }

  /**
   * Check if loop is likely (score above threshold)
   */
  isLoopLikely(threshold: number = 50): boolean {
    return this.computeLoopScore() >= threshold
  }

  /**
   * Get loop detection summary
   */
  getSummary(): {
    score: number
    isLoopLikely: boolean
    recentCommands: string[]
    recentErrors: string[]
    commandCount: number
    errorCount: number
  } {
    const now = Date.now()
    const recentWindowMs = 60000

    const recentCommands = this.commandHistory
      .filter((c) => now - c.timestamp < recentWindowMs)
      .map((c) => c.command)

    const recentErrors = this.errorHistory
      .filter((e) => now - e.timestamp < recentWindowMs)
      .map((e) => e.error)

    return {
      score: this.computeLoopScore(),
      isLoopLikely: this.isLoopLikely(),
      recentCommands: [...new Set(recentCommands)],
      recentErrors: [...new Set(recentErrors)],
      commandCount: this.commandHistory.length,
      errorCount: this.errorHistory.length,
    }
  }

  /**
   * Reset the loop guard
   */
  reset(): void {
    this.commandHistory = []
    this.errorHistory = []
    this.score = 0
    log.debug("Loop guard reset")
  }

  /**
   * Clear old entries outside the window
   */
  pruneOldEntries(windowMs: number = this.windowMs): void {
    const now = Date.now()

    this.commandHistory = this.commandHistory.filter((c) => now - c.timestamp < windowMs)
    this.errorHistory = this.errorHistory.filter((e) => now - e.timestamp < windowMs)

    log.debug("Pruned old entries", {
      commandHistorySize: this.commandHistory.length,
      errorHistorySize: this.errorHistory.length,
    })
  }
}

export const defaultLoopGuard = new LoopGuard()
