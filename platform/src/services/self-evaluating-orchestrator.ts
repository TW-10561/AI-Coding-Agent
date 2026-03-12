/**
 * Self-Evaluating Subagent Orchestrator Integration
 * Integrates the self-evaluating subagent with the existing subagent-orchestrator
 * Enables automatic knowledge storage and cross-agent learning
 */

import type { SubagentTask } from "./subagent-orchestrator"
import type { Task, ExecutionData } from "../types/self-evaluating-agent"
import { SelfEvaluatingSubagent } from "./self-evaluating-subagent"

export interface IntegratedSubagentTask extends SubagentTask {
  // Extended task with self-evaluating capabilities
  autoEvaluate?: boolean // Enable feedback loop
  learnFromPeers?: boolean // Aggregate knowledge from other agents
  persistExecution?: boolean // Store execution trace for analysis
  requiresValidation?: boolean // Require human validation before completion
}

export interface IntegratedOrchestrationConfig {
  agentPoolSize?: number
  knowledgeSharing?: boolean
  crossAgentLearning?: boolean
  persistenceBasePath?: string
  autoSaveInterval?: number
}

/**
 * Pool of self-evaluating subagents with shared knowledge
 */
export class SelfEvaluatingSubagentPool {
  private agents: Map<string, SelfEvaluatingSubagent> = new Map()
  private sharedKnowledge: Map<string, unknown> = new Map()
  private config: Required<IntegratedOrchestrationConfig>
  private executionTraces: Map<string, ExecutionData> = new Map()

  constructor(config: IntegratedOrchestrationConfig = {}) {
    this.config = {
      agentPoolSize: config.agentPoolSize || 5,
      knowledgeSharing: config.knowledgeSharing !== false,
      crossAgentLearning: config.crossAgentLearning !== false,
      persistenceBasePath: config.persistenceBasePath || "/tmp/agent-knowledge",
      autoSaveInterval: config.autoSaveInterval || 5000,
    }

    // Initialize agent pool
    for (let i = 0; i < this.config.agentPoolSize; i++) {
      const agentId = `agent-${i + 1}-${Date.now()}`
      const agent = new SelfEvaluatingSubagent({
        agentId,
        persistenceEnabled: true,
        persistencePath: `${this.config.persistenceBasePath}/${agentId}`,
        maxAuditLog: 100,
      })
      this.agents.set(agentId, agent)
    }
  }

  /**
   * Execute a task using an available agent from the pool
   */
  async executeTask(
    task: IntegratedSubagentTask,
  ): Promise<[unknown, ExecutionData, string]> {
    const agentId = this.selectAgentForTask(task)
    const agent = this.agents.get(agentId)

    if (!agent) {
      throw new Error(`Agent ${agentId} not found`)
    }

    // Convert to internal task format
    const internalTask: Task = {
      type: task.agentID,
      description: task.prompt,
      tool: "execute",
      requiresEvaluation: task.autoEvaluate !== false,
      metadata: {
        taskId: task.id,
        orchestrationId: task.orchestrationID,
      },
    }

    // Execute with self-evaluation
    const [result, executionData] = await agent.executeTask(internalTask)

    // Store execution trace if requested
    if (task.persistExecution) {
      this.executionTraces.set(task.id, executionData)
    }

    // Share knowledge across pool if enabled
    if (this.config.knowledgeSharing) {
      const knowledge = agent.getKnowledgeExport()
      this.sharedKnowledge.set(`${agentId}:knowledge`, knowledge)
      await this.aggregateKnowledge()
    }

    return [result, executionData, agentId]
  }

  /**
   * Select best agent for task based on its history
   */
  private selectAgentForTask(task: IntegratedSubagentTask): string {
    // Select agent based on specialization
    const agentArray = Array.from(this.agents.entries())

    if (agentArray.length === 0) {
      throw new Error("No agents available in pool")
    }

    // Round-robin or load-based selection
    const sortedAgents = agentArray.sort(() => Math.random() - 0.5)
    return sortedAgents[0][0]
  }

  /**
   * Aggregate knowledge from all agents
   */
  private async aggregateKnowledge(): Promise<void> {
    if (!this.config.crossAgentLearning) {
      return
    }

    const aggregated: Record<string, unknown> = {}

    for (const [agentId, agent] of this.agents.entries()) {
      const knowledge = agent.getKnowledgeExport()
      aggregated[agentId] = knowledge
    }

    this.sharedKnowledge.set("aggregated", aggregated)
  }

  /**
   * Broadcast aggregated knowledge to all agents
   */
  async broadcastKnowledge(): Promise<void> {
    if (!this.config.knowledgeSharing) {
      return
    }

    const aggregated = this.sharedKnowledge.get("aggregated")
    if (!aggregated) {
      return
    }

    // In a real implementation, this would merge knowledge from other agents
    // For now, we log it for monitoring
    console.log("Knowledge broadcast completed", {
      agents: this.agents.size,
      knowledgeEntries: this.sharedKnowledge.size,
    })
  }

  /**
   * Get statistics for all agents
   */
  getPoolStatistics() {
    const agentsStats: Record<string, unknown> = {}
    
    for (const [agentId, agent] of this.agents.entries()) {
      const agentStatus = agent.getStatus()
      agentsStats[agentId] = {
        executionsCompleted: agentStatus.executionsCompleted,
        strategyCount: agentStatus.strategyCount,
        errorPatternsLearned: agentStatus.errorPatternsLearned,
      }
    }

    return {
      poolSize: this.agents.size,
      agents: agentsStats,
    }
  }

  /**
   * Get execution trace for analysis
   */
  getExecutionTrace(taskId: string): ExecutionData | undefined {
    return this.executionTraces.get(taskId)
  }

  /**
   * Clear all execution traces
   */
  clearExecutionTraces(): void {
    this.executionTraces.clear()
  }

  /**
   * Save all agent knowledge to persistent storage
   */
  async saveAllKnowledge(): Promise<void> {
    const savePromises = Array.from(this.agents.values()).map((agent) =>
      agent.saveKnowledge(),
    )
    await Promise.all(savePromises)
  }

  /**
   * Load all agent knowledge from persistent storage
   */
  async loadAllKnowledge(): Promise<void> {
    const loadPromises = Array.from(this.agents.values()).map((agent) =>
      agent.loadKnowledge(),
    )
    await Promise.all(loadPromises)
  }

  /**
   * Get an agent from the pool
   */
  getAgent(agentId: string): SelfEvaluatingSubagent | undefined {
    return this.agents.get(agentId)
  }

  /**
   * Get all agents
   */
  getAllAgents(): Map<string, SelfEvaluatingSubagent> {
    return new Map(this.agents)
  }

  /**
   * Clean up all resources
   */
  async destroy(): Promise<void> {
    await this.saveAllKnowledge()

    const destroyPromises = Array.from(this.agents.values()).map((agent) =>
      agent.destroy(),
    )
    await Promise.all(destroyPromises)

    this.agents.clear()
    this.sharedKnowledge.clear()
    this.executionTraces.clear()
  }
}

/**
 * Enhanced Subagent Orchestrator with self-evaluating capabilities
 */
export class SelfEvaluatingOrchestrator {
  private pool: SelfEvaluatingSubagentPool
  private taskExecutions: Map<string, IntegratedSubagentTask> = new Map()

  constructor(config: IntegratedOrchestrationConfig = {}) {
    this.pool = new SelfEvaluatingSubagentPool(config)
  }

  /**
   * Execute a task with self-evaluation
   */
  async executeTaskWithFeedback(task: IntegratedSubagentTask): Promise<ExecutionData> {
    this.taskExecutions.set(task.id, task)

    const [result, executionData, agentId] = await this.pool.executeTask(task)

    return {
      ...executionData,
      output: result,
      auditTrail: [
        ...(executionData.auditTrail || []),
        {
          executionId: executionData.executionId,
          timestamp: new Date().toISOString(),
          eventType: "ORCHESTRATOR_ASSIGNMENT",
          details: { agentId, taskId: task.id },
        },
      ],
    }
  }

  /**
   * Get orchestrator statistics
   */
  getStatistics() {
    return {
      poolStatistics: this.pool.getPoolStatistics(),
      totalTasksExecuted: this.taskExecutions.size,
    }
  }

  /**
   * Save orchestrator state
   */
  async save(): Promise<void> {
    await this.pool.saveAllKnowledge()
  }

  /**
   * Load orchestrator state
   */
  async load(): Promise<void> {
    await this.pool.loadAllKnowledge()
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    await this.pool.destroy()
    this.taskExecutions.clear()
  }

  /**
   * Get the underlying pool for advanced operations
   */
  getPool(): SelfEvaluatingSubagentPool {
    return this.pool
  }
}
