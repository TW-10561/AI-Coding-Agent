/**
 * Strategy Improver
 * Analyzes failures and generates improved strategies
 */

import type { FailureAnalysis, Task } from "../types/self-evaluating-agent"
import { KnowledgeBase } from "./knowledge-base"

export class StrategyImprover {
  constructor(private knowledgeBase: KnowledgeBase) {}

  /**
   * Analyze why a task failed
   */
  analyzeFailure(
    task: Task,
    result: unknown,
    error?: string,
  ): FailureAnalysis {
    const analysis: FailureAnalysis = {
      failureType: this.classifyFailure(error),
      rootCause: this.identifyRootCause(task, result, error),
      contributingFactors: this.identifyFactors(task, result),
      recoveryStrategies: this.generateRecoveryStrategies(task, error),
    }

    // Update knowledge
    this.knowledgeBase.recordErrorPattern(
      (task.tool || "unknown") as string,
      error || "unknown_error",
      task.type || "general",
    )

    return analysis
  }

  /**
   * Classify type of failure
   */
  private classifyFailure(error?: string): string {
    if (!error) {
      return "unknown"
    }

    const errorLower = error.toLowerCase()

    if (errorLower.includes("timeout")) {
      return "timeout"
    } else if (errorLower.includes("not found") || errorLower.includes("404")) {
      return "not_found"
    } else if (
      errorLower.includes("permission") ||
      errorLower.includes("denied")
    ) {
      return "permission_denied"
    } else if (errorLower.includes("invalid")) {
      return "invalid_input"
    } else {
      return "execution_error"
    }
  }

  /**
   * Identify root cause of failure
   */
  private identifyRootCause(task: Task, result: unknown, error?: string): string {
    if (error) {
      return `Tool error: ${error}`
    }

    if (!result) {
      return "No result returned"
    }

    return "Result validation failed"
  }

  /**
   * Identify contributing factors to failure
   */
  private identifyFactors(task: Task, result: unknown): string[] {
    const factors: string[] = []

    if (task.complexity === undefined) {
      throw new Error("Task complexity is undefined")
    }

    if (task.complexity > 0.7) {
      factors.push("High task complexity")
    }

    if (task.dependencies && task.dependencies.length > 0) {
      factors.push("Multiple dependencies")
    }

    if (
      result &&
      typeof result === "object" &&
      result !== null &&
      !("data" in result)
    ) {
      factors.push("Missing result data")
    }

    return factors
  }

  /**
   * Generate strategies to recover from failure
   */
  private generateRecoveryStrategies(task: Task, error?: string): string[] {
    const strategies: string[] = []
    const failureType = this.classifyFailure(error)

    if (failureType === "timeout") {
      strategies.push("Increase timeout threshold")
      strategies.push("Split task into smaller subtasks")
    } else if (failureType === "not_found") {
      strategies.push("Verify resource path")
      strategies.push("Check resource availability")
    } else if (failureType === "permission_denied") {
      strategies.push("Request elevated permissions")
      strategies.push("Use alternative approach")
    } else if (failureType === "invalid_input") {
      strategies.push("Sanitize input parameters")
      strategies.push("Validate input format")
    }

    strategies.push("Consult knowledge base for similar cases")
    return strategies
  }

  /**
   * Generate improved strategy based on failure analysis
   */
  generateImprovedStrategy(
    originalStrategy: string,
    failureAnalysis: FailureAnalysis,
  ): string {
    let improved = originalStrategy

    switch (failureAnalysis.failureType) {
      case "timeout":
        improved = "conservative" // Use slower but more reliable approach
        break
      case "permission_denied":
        improved = "escalate" // Request permissions first
        break
      case "invalid_input":
        improved = "validate_first" // Validate inputs before execution
        break
      case "not_found":
        improved = "search_first" // Search for resource before accessing
        break
      default:
        improved = "retry_with_backoff" // Retry with exponential backoff
    }

    return improved
  }

  /**
   * Learn from success - what works well
   */
  recordSuccess(taskType: string, strategy: string, metrics: Record<string, unknown>): void {
    // Boost the successful strategy for this task type
    const decisionStr = JSON.stringify({ taskType, strategy, metrics })
    // This would be recorded in the knowledge base
  }
}
