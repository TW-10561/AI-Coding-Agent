/**
 * Result Evaluator
 * Evaluates execution results and determines success
 */

import type { EvaluationResult, Task, ExecutionMetric } from "../types/self-evaluating-agent"
import { KnowledgeBase } from "./knowledge-base"
import { SafetyMonitor } from "./safety-monitor"

export class ResultEvaluator {
  constructor(private knowledgeBase: KnowledgeBase) {}

  /**
   * Comprehensively evaluate result
   */
  evaluate(
    result: unknown,
    task: Task,
    originalMetrics?: Record<string, unknown>,
  ): EvaluationResult {
    const evaluation: EvaluationResult = {
      timestamp: new Date().toISOString(),
      completenessScore: this.scoreCompleteness(result, task),
      qualityScore: this.scoreQuality(result),
      safetyValid: SafetyMonitor.validateOutput(result)[0],
      success: this.determineSuccess(result, task),
      confidence: this.calculateConfidence(result, task, originalMetrics || {}),
    }

    return evaluation
  }

  /**
   * Score if result completes the task (0.0 to 1.0)
   */
  private scoreCompleteness(result: unknown, task: Task): number {
    if (!result) {
      return 0.0
    }

    const resultStr = typeof result === "string" ? result : JSON.stringify(result)
    const resultLower = resultStr.toLowerCase()

    const requiredFields = task.requiredFields || []
    const foundFields = requiredFields.filter((field) =>
      resultLower.includes(field.toLowerCase()),
    ).length

    const completeness = requiredFields.length > 0 ? foundFields / requiredFields.length : 0.5

    return Math.min(1.0, completeness)
  }

  /**
   * Score result quality (0.0 to 1.0)
   */
  private scoreQuality(result: unknown): number {
    if (!result) {
      return 0.0
    }

    let qualityScore = 0.7 // Default

    const resultStr = typeof result === "string" ? result : JSON.stringify(result)

    // More detailed results = higher quality
    if (resultStr.length > 100) {
      qualityScore += 0.1
    }

    // Structured results = higher quality
    if (typeof result === "object" && result !== null) {
      qualityScore += 0.1
    }

    // Non-null arrays or populated objects
    if (Array.isArray(result) && result.length > 0) {
      qualityScore += 0.05
    } else if (
      typeof result === "object" &&
      result !== null &&
      Object.keys(result).length > 0
    ) {
      qualityScore += 0.05
    }

    return Math.min(1.0, qualityScore)
  }

  /**
   * Determine if task was successfully completed
   */
  private determineSuccess(result: unknown, task: Task): boolean {
    if (!result) {
      return false
    }

    const successThreshold = task.successThreshold || 0.75
    const completeness = this.scoreCompleteness(result, task)
    const quality = this.scoreQuality(result)

    const combinedScore = (completeness + quality) / 2

    return combinedScore >= successThreshold
  }

  /**
   * Calculate confidence in the result (0.0 to 1.0)
   */
  private calculateConfidence(
    result: unknown,
    task: Task,
    metrics: Record<string, unknown>,
  ): number {
    let confidence = 0.5

    // Boost confidence if we have multiple successful validations
    const validationsPassed = (metrics.validationsPasssed as number) || 0
    if (validationsPassed > 0) {
      confidence += validationsPassed * 0.15
    }

    // Reduce confidence based on retry count
    const retries = (metrics.retries as number) || 0
    if (retries > 0) {
      confidence -= retries * 0.1
    }

    // Boost confidence based on execution time (quick = probably right)
    const executionTimeMs = (metrics.executionTimeMs as number) || 1000
    if (executionTimeMs < 100) {
      confidence += 0.1
    }

    return Math.min(1.0, Math.max(0.1, confidence))
  }
}
