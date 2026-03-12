/**
 * Reasoner Engine
 * Strategic reasoning for task analysis and tool selection
 */

import type { Task, TaskAnalysis, Strategy } from "../types/self-evaluating-agent"
import { KnowledgeBase } from "./knowledge-base"

export class Reasoner {
  constructor(private knowledgeBase: KnowledgeBase) {}

  /**
   * Analyze task and generate strategy options
   */
  analyzeTask(task: Task): TaskAnalysis {
    const taskType = task.type || "general"
    const taskComplexity = this.estimateComplexity(task)
    const antiPatterns = this.knowledgeBase.getAntiPatterns(taskType)

    return {
      taskType,
      complexity: taskComplexity,
      recommendedStrategy: this.knowledgeBase.getBestStrategy(taskType),
      recommendedTools: this.selectTools(task),
      antiPatternsToAvoid: antiPatterns,
      estimatedEffort:
        taskComplexity > 0.7 ? "high" : taskComplexity > 0.4 ? "medium" : "low",
    }
  }

  /**
   * Estimate task complexity (0.0 to 1.0)
   */
  private estimateComplexity(task: Task): number {
    let complexity = 0.5 // Default medium

    // Adjust based on task characteristics
    if (task.dependencies && task.dependencies.length > 0) {
      complexity += task.dependencies.length * 0.1
    }

    if (task.retries && task.retries > 0) {
      complexity -= task.retries * 0.1 // Simpler if retried
    }

    if (task.complexity !== undefined) {
      complexity = task.complexity
    }

    if (task.requiredFields && task.requiredFields.length > 5) {
      complexity += 0.1
    }

    return Math.min(1.0, Math.max(0.0, complexity))
  }

  /**
   * Select optimal tool chain for task
   */
  private selectTools(task: Task): string[] {
    const tools: string[] = []

    if (task.requiresAnalysis) {
      tools.push("read", "search")
    }

    if (task.requiresModification) {
      tools.push("write")
    }

    if (task.requiresExecution) {
      tools.push("execute")
    }

    if (task.requiresEvaluation !== false) {
      if (!tools.includes("evaluate")) {
        tools.push("evaluate")
      }
    }

    return tools.length > 0 ? tools : ["read", "evaluate"]
  }

  /**
   * Generate multiple strategy options
   */
  generateStrategies(analysis: TaskAnalysis): Strategy[] {
    const strategies: Strategy[] = []

    // Strategy 1: Parallel execution (if low complexity)
    if (analysis.complexity < 0.5) {
      strategies.push({
        name: "parallel",
        description: "Execute independent operations in parallel",
        priority: 1,
        expectedEfficiency: 0.9,
      })
    }

    // Strategy 2: Sequential with caching
    strategies.push({
      name: "sequential_cached",
      description: "Execute sequentially with result caching",
      priority: 2,
      expectedEfficiency: 0.7,
    })

    // Strategy 3: Conservative (highest safety)
    strategies.push({
      name: "conservative",
      description: "Execute with maximum validation steps",
      priority: 3,
      expectedEfficiency: 0.5,
    })

    // Sort by priority
    return strategies.sort((a, b) => a.priority - b.priority)
  }

  /**
   * Recommend tool based on task type
   */
  recommendTool(taskType: string): string {
    return this.knowledgeBase.getToolForTask(taskType)
  }
}
