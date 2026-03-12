/**
 * Self-Evaluating Subagent
 * Autonomous agent that follows soul.md principles:
 * Input → Reason → Tool → Output → Evaluate → Improve → Update Knowledge
 */

import { randomBytes } from "crypto"
import type {
  Task,
  ExecutionData,
  AgentStatus,
  AuditEntry,
  SelfEvaluatingAgentOptions,
} from "../types/self-evaluating-agent"
import { KnowledgeBase } from "./knowledge-base"
import { Reasoner } from "./reasoner"
import { ResultEvaluator } from "./result-evaluator"
import { StrategyImprover } from "./strategy-improver"
import { SafetyMonitor } from "./safety-monitor"

export class SelfEvaluatingSubagent {
  private agentId: string
  private knowledgeBase: KnowledgeBase
  private reasoner: Reasoner
  private evaluator: ResultEvaluator
  private strategyImprover: StrategyImprover
  private executionCount: number = 0
  private auditLog: AuditEntry[] = []
  private maxAuditLog: number
  private persistenceEnabled: boolean
  private persistencePath?: string

  constructor(options: SelfEvaluatingAgentOptions) {
    this.agentId = options.agentId
    this.maxAuditLog = options.maxAuditLog || 500
    this.persistenceEnabled = options.persistenceEnabled || false
    this.persistencePath = options.persistencePath

    this.knowledgeBase = new KnowledgeBase({
      persistenceEnabled: this.persistenceEnabled,
      persistencePath: this.persistencePath ? `${this.persistencePath}/knowledge.json` : undefined,
      autoSyncInterval: 5000, // Auto-save every 5 seconds
    })

    this.reasoner = new Reasoner(this.knowledgeBase)
    this.evaluator = new ResultEvaluator(this.knowledgeBase)
    this.strategyImprover = new StrategyImprover(this.knowledgeBase)
  }

  /**
   * Execute a task following the soul cycle:
   * Input → Reason → Tool → Output → Evaluate → Improve → Update Knowledge
   */
  async executeTask(task: Task): Promise<[unknown, ExecutionData]> {
    const executionId = this.generateExecutionId()

    try {
      // Safety first: Validate input
      const [safe, message] = SafetyMonitor.validateInput(task)
      if (!safe) {
        this.logAudit(executionId, "INPUT_VALIDATION_FAILED", message)
        return [
          null,
          {
            output: null,
            executionId,
            evaluation: {
              timestamp: new Date().toISOString(),
              completenessScore: 0,
              qualityScore: 0,
              safetyValid: false,
              success: false,
              confidence: 0,
              error: message,
            },
            auditTrail: this.getAuditLog(10),
            error: message,
          } as ExecutionData,
        ]
      }

      this.logAudit(executionId, "EXECUTION_START", `Task: ${task.type || "unknown"}`)

      // 1. INPUT PROCESSING
      this.logAudit(executionId, "PHASE", "INPUT_PROCESSING")
      const processedTask = this.processInput(task)

      // 2. REASONING PHASE
      this.logAudit(executionId, "PHASE", "REASONING")
      const analysis = this.reasoner.analyzeTask(processedTask)
      const strategies = this.reasoner.generateStrategies(analysis)
      const selectedStrategy = strategies[0].name // Choose best-priority strategy

      const reasoningRecord = {
        analysis,
        selectedStrategy,
        timestamp: new Date().toISOString(),
      }
      this.logAudit(executionId, "REASONING_COMPLETE", reasoningRecord)

      // 3. TOOL EXECUTION
      this.logAudit(executionId, "PHASE", "TOOL_EXECUTION")
      const executionStart = Date.now()
      const [result, executionMetrics] = await this.executeWithStrategy(
        processedTask,
        selectedStrategy,
      )
      const executionTime = (Date.now() - executionStart) / 1000

      const metrics = {
        ...executionMetrics,
        executionTimeMs: executionTime * 1000,
      }

      this.logAudit(executionId, "EXECUTION_COMPLETE", {
        status: result ? "success" : "empty_result",
        timeMs: metrics.executionTimeMs,
      })

      // 4. OUTPUT GENERATION
      this.logAudit(executionId, "PHASE", "OUTPUT_GENERATION")
      const output = this.formatOutput(result)

      // 5. RESULT EVALUATION
      this.logAudit(executionId, "PHASE", "RESULT_EVALUATION")
      const evaluation = this.evaluator.evaluate(output, processedTask, metrics)
      this.logAudit(executionId, "EVALUATION_RESULTS", evaluation)

      // 6. STRATEGY IMPROVEMENT
      this.logAudit(executionId, "PHASE", "STRATEGY_IMPROVEMENT")
      if (!evaluation.success) {
        const failureAnalysis = this.strategyImprover.analyzeFailure(
          processedTask,
          result,
          evaluation.error,
        )
        const improvedStrategy = this.strategyImprover.generateImprovedStrategy(
          selectedStrategy,
          failureAnalysis,
        )
        this.logAudit(executionId, "STRATEGY_IMPROVED", {
          from: selectedStrategy,
          to: improvedStrategy,
          reason: failureAnalysis.rootCause,
        })
      } else {
        this.strategyImprover.recordSuccess(
          processedTask.type,
          selectedStrategy,
          metrics,
        )
      }

      // 7. KNOWLEDGE UPDATE
      this.logAudit(executionId, "PHASE", "KNOWLEDGE_UPDATE")
      this.knowledgeBase.recordExecution({
        toolUsed: processedTask.tool || "default",
        success: evaluation.success,
        timeTaken: executionTime,
        tokensUsed: 0,
        confidenceScore: evaluation.confidence,
      })

      this.knowledgeBase.recordDecision({
        taskType: processedTask.type,
        chosenStrategy: selectedStrategy,
        alternativesConsidered: strategies.map((s) => s.name),
        reasoning: analysis.recommendedStrategy,
        outcome: evaluation.success ? "success" : "failure",
        success: evaluation.success,
        timestamp: new Date().toISOString(),
      })

      this.logAudit(executionId, "KNOWLEDGE_UPDATED", {
        executionCount: this.executionCount,
        strategyWeights: Object.keys(this.knowledgeBase.exportKnowledge().strategyWeights).length,
      })

      // 8. COMPLETION
      this.logAudit(executionId, "EXECUTION_END", "Task completed")

      const resultData: ExecutionData = {
        output,
        executionId,
        evaluation,
        metrics: {
          toolUsed: processedTask.tool || "default",
          success: evaluation.success,
          timeTaken: executionTime,
          tokensUsed: 0,
          confidenceScore: evaluation.confidence,
        },
        auditTrail: this.getAuditLog(20),
      }

      return [output, resultData]
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logAudit(executionId, "EXECUTION_ERROR", errorMessage)

      return [
        null,
        {
          output: null,
          executionId,
          evaluation: {
            timestamp: new Date().toISOString(),
            completenessScore: 0,
            qualityScore: 0,
            safetyValid: false,
            success: false,
            confidence: 0,
            error: errorMessage,
          },
          auditTrail: this.getAuditLog(20),
          error: errorMessage,
        } as ExecutionData,
      ]
    }
  }

  /**
   * Process and normalize input task
   */
  private processInput(task: Task): Task {
    return {
      type: task.type || "general",
      description: task.description || "",
      tool: task.tool || "read",
      requiresAnalysis: task.requiresAnalysis || false,
      requiresModification: task.requiresModification || false,
      requiresExecution: task.requiresExecution || false,
      requiresEvaluation: task.requiresEvaluation !== false,
      requiredFields: task.requiredFields || [],
      successThreshold: task.successThreshold || 0.75,
      dependencies: task.dependencies || [],
      retries: task.retries || 0,
      complexity: task.complexity || 0.5,
      metadata: task.metadata || {},
    }
  }

  /**
   * Execute task using selected strategy
   */
  private async executeWithStrategy(
    task: Task,
    strategy: string,
  ): Promise<[unknown, Record<string, unknown>]> {
    const metrics = { validationsPasssed: 0, retries: 0 }

    let result: unknown

    // Simulate tool execution with strategy
    switch (strategy) {
      case "parallel":
        result = await this.executeParallel(task)
        break
      case "sequential_cached":
        result = await this.executeSequential(task)
        break
      default:
        result = await this.executeConservative(task)
    }

    if (result) {
      metrics.validationsPasssed = 1
    } else {
      metrics.retries = 1
    }

    return [result, metrics]
  }

  /**
   * Execute task in parallel mode
   */
  private async executeParallel(task: Task): Promise<unknown> {
    // Simulate parallel execution
    await new Promise((resolve) => setTimeout(resolve, 10))
    return { strategy: "parallel", data: `Result for ${task.type}` }
  }

  /**
   * Execute task sequentially with caching
   */
  private async executeSequential(task: Task): Promise<unknown> {
    // Simulate sequential execution
    await new Promise((resolve) => setTimeout(resolve, 20))
    return { strategy: "sequential", cached: true, data: `Result for ${task.type}` }
  }

  /**
   * Execute task conservatively with max validation
   */
  private async executeConservative(task: Task): Promise<unknown> {
    // Simulate conservative execution
    await new Promise((resolve) => setTimeout(resolve, 30))
    return { strategy: "conservative", validated: true, data: `Result for ${task.type}` }
  }

  /**
   * Format output for user consumption
   */
  private formatOutput(result: unknown): unknown {
    if (!result) {
      return { status: "no_result" }
    }

    return {
      status: "success",
      data: result,
      formattedAt: new Date().toISOString(),
    }
  }

  /**
   * Generate unique execution ID
   */
  private generateExecutionId(): string {
    this.executionCount++
    const timestamp = Date.now()
    const random = randomBytes(4).toString("hex")
    return `${this.agentId.substring(0, 4)}-${this.executionCount}-${timestamp}-${random}`.substring(0, 12)
  }

  /**
   * Log audit entry for transparency
   */
  private logAudit(executionId: string, eventType: string, details: unknown): void {
    this.auditLog.push({
      executionId,
      timestamp: new Date().toISOString(),
      eventType,
      details:
        typeof details === "string" || typeof details === "object"
          ? details
          : String(details),
    })

    // Prune old entries if exceeding max
    if (this.auditLog.length > this.maxAuditLog) {
      this.auditLog = this.auditLog.slice(-this.maxAuditLog)
    }
  }

  /**
   * Export learned knowledge
   */
  getKnowledgeExport() {
    return this.knowledgeBase.exportKnowledge()
  }

  /**
   * Get recent audit log entries
   */
  getAuditLog(lastN: number = 50): AuditEntry[] {
    return this.auditLog.slice(-lastN)
  }

  /**
   * Get current agent status
   */
  getStatus(): AgentStatus {
    const stats = this.knowledgeBase.getStatistics()
    return {
      agentId: this.agentId,
      executionsCompleted: this.executionCount,
      strategyCount: stats.toolsLearned,
      errorPatternsLearned: stats.errorPatternsLearned,
      knowledgeExport: this.getKnowledgeExport(),
    }
  }

  /**
   * Save knowledge to persistent storage
   */
  async saveKnowledge(): Promise<void> {
    await this.knowledgeBase.save()
  }

  /**
   * Load knowledge from persistent storage
   */
  async loadKnowledge(): Promise<void> {
    await this.knowledgeBase.load()
  }

  /**
   * Clean up resources
   */
  async destroy(): Promise<void> {
    await this.saveKnowledge()
    this.knowledgeBase.destroy()
  }
}
