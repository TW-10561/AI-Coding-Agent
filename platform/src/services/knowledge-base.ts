/**
 * Knowledge Base Service
 * Manages learned patterns, strategies, and execution history
 * Automatically stores and updates knowledge
 */

import type {
  ExecutionMetric,
  StrategyDecision,
  KnowledgeEntry,
  KnowledgeExport,
  KnowledgeBaseOptions,
} from "../types/self-evaluating-agent"

export class KnowledgeBase {
  private patterns: Map<string, KnowledgeEntry> = new Map()
  private strategyWeights: Map<string, number> = new Map()
  private errorPatterns: Map<string, number> = new Map()
  private executionHistory: ExecutionMetric[] = []
  private decisionHistory: StrategyDecision[] = []
  private persistenceEnabled: boolean
  private persistencePath?: string
  private autoSyncInterval?: NodeJS.Timeout
  private dirty: boolean = false

  constructor(options: KnowledgeBaseOptions = {}) {
    this.persistenceEnabled = options.persistenceEnabled ?? false
    this.persistencePath = options.persistencePath
    this.autoSyncInterval = options.autoSyncInterval
      ? setInterval(() => this.save(), options.autoSyncInterval)
      : undefined
  }

  /**
   * Record execution metric for learning
   */
  recordExecution(metric: ExecutionMetric): void {
    this.executionHistory.push(metric)
    this.dirty = true

    // Update tool success rates
    const tool = metric.toolUsed
    const currentWeight = this.strategyWeights.get(tool) ?? 0.5

    if (metric.success) {
      this.strategyWeights.set(tool, Math.min(1.0, currentWeight + 0.1))
    } else {
      this.strategyWeights.set(tool, Math.max(0.0, currentWeight - 0.1))

      if (metric.errorMessage) {
        const key = `${metric.toolUsed}:${metric.errorMessage.substring(0, 50)}`
        const count = this.errorPatterns.get(key) ?? 0
        this.errorPatterns.set(key, count + 1)
      }
    }

    this.save()
  }

  /**
   * Record strategic decision
   */
  recordDecision(decision: StrategyDecision): void {
    this.decisionHistory.push(decision)
    this.dirty = true
    this.save()
  }

  /**
   * Learn from error patterns
   */
  recordErrorPattern(tool: string, error: string, taskType: string): void {
    const patternKey = `${taskType}:${tool}:${error.substring(0, 30)}`
    const count = this.errorPatterns.get(patternKey) ?? 0
    this.errorPatterns.set(patternKey, count + 1)
    this.dirty = true
    this.save()
  }

  /**
   * Get best strategy for task type based on history
   */
  getBestStrategy(taskType: string): string {
    const relevantDecisions = this.decisionHistory.filter(
      (d) => d.taskType === taskType && d.success,
    )

    if (relevantDecisions.length === 0) {
      return "default"
    }

    // Count successes by strategy
    const strategyScores: Record<string, number> = {}
    for (const decision of relevantDecisions) {
      strategyScores[decision.chosenStrategy] =
        (strategyScores[decision.chosenStrategy] ?? 0) + 1
    }

    return Object.entries(strategyScores).sort(([, a], [, b]) => b - a)[0][0]
  }

  /**
   * Get most reliable tool for task type
   */
  getToolForTask(taskType: string): string {
    const entries = Array.from(this.strategyWeights.entries())

    if (entries.length === 0) {
      return "default_tool"
    }

    return entries.sort(([, a], [, b]) => b - a)[0][0]
  }

  /**
   * Get known failures to avoid
   */
  getAntiPatterns(taskType: string): string[] {
    const matchingErrors = Array.from(this.errorPatterns.keys()).filter((pattern) =>
      pattern.startsWith(taskType),
    )

    return matchingErrors
      .sort((a, b) => (this.errorPatterns.get(b) ?? 0) - (this.errorPatterns.get(a) ?? 0))
      .slice(0, 5) // Top 5 anti-patterns
  }

  /**
   * Export knowledge for persistence and sharing
   */
  exportKnowledge(): KnowledgeExport {
    return {
      strategyWeights: Object.fromEntries(this.strategyWeights),
      errorPatterns: Object.fromEntries(this.errorPatterns),
      executionCount: this.executionHistory.length,
      decisionCount: this.decisionHistory.length,
      decisionHistory: this.decisionHistory.slice(-10), // Last 10 decisions
    }
  }

  /**
   * Import knowledge from external source
   */
  importKnowledge(knowledge: KnowledgeExport): void {
    this.strategyWeights = new Map(Object.entries(knowledge.strategyWeights))
    this.errorPatterns = new Map(Object.entries(knowledge.errorPatterns))
    if (knowledge.decisionHistory) {
      // Merge decisions, avoiding duplicates
      const existingIds = new Set(this.decisionHistory.map((d) => d.reasoning))
      this.decisionHistory.push(
        ...knowledge.decisionHistory.filter((d) => !existingIds.has(d.reasoning)),
      )
    }
    this.dirty = true
    this.save()
  }

  /**
   * Get execution history
   */
  getExecutionHistory(limit?: number): ExecutionMetric[] {
    if (limit) {
      return this.executionHistory.slice(-limit)
    }
    return [...this.executionHistory]
  }

  /**
   * Get decision history
   */
  getDecisionHistory(limit?: number): StrategyDecision[] {
    if (limit) {
      return this.decisionHistory.slice(-limit)
    }
    return [...this.decisionHistory]
  }

  /**
   * Clear old data to prevent memory bloat
   */
  prune(maxHistorySize: number = 1000): void {
    if (this.executionHistory.length > maxHistorySize) {
      this.executionHistory = this.executionHistory.slice(-maxHistorySize)
      this.dirty = true
    }
    if (this.decisionHistory.length > maxHistorySize) {
      this.decisionHistory = this.decisionHistory.slice(-maxHistorySize)
      this.dirty = true
    }
    this.save()
  }

  /**
   * Save knowledge to persistent storage
   */
  async save(): Promise<void> {
    if (!this.persistenceEnabled || !this.dirty || !this.persistencePath) {
      return
    }

    try {
      // Dynamic import to avoid issues in non-Node environments
      const fs = await import("fs/promises")
      const knowledge = this.exportKnowledge()
      await fs.writeFile(this.persistencePath, JSON.stringify(knowledge, null, 2))
      this.dirty = false
    } catch (error) {
      console.error("Failed to save knowledge:", error)
    }
  }

  /**
   * Load knowledge from persistent storage
   */
  async load(): Promise<void> {
    if (!this.persistenceEnabled || !this.persistencePath) {
      return
    }

    try {
      // Dynamic import to avoid issues in non-Node environments
      const fs = await import("fs/promises")
      const data = await fs.readFile(this.persistencePath, "utf-8")
      const knowledge = JSON.parse(data) as KnowledgeExport
      this.importKnowledge(knowledge)
      this.dirty = false
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("Failed to load knowledge:", error)
      }
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval)
    }
  }

  /**
   * Get knowledge statistics
   */
  getStatistics() {
    return {
      totalExecutions: this.executionHistory.length,
      totalDecisions: this.decisionHistory.length,
      successRate:
        this.executionHistory.length > 0
          ? this.executionHistory.filter((m) => m.success).length /
            this.executionHistory.length
          : 0,
      toolsLearned: this.strategyWeights.size,
      errorPatternsLearned: this.errorPatterns.size,
      averageConfidence:
        this.executionHistory.length > 0
          ? this.executionHistory.reduce((sum, m) => sum + (m.confidenceScore ?? 0), 0) /
            this.executionHistory.length
          : 0,
    }
  }
}
