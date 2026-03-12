/**
 * Self-Evaluating Subagent - Integration Examples and Tests
 */

import { SelfEvaluatingSubagent } from "./self-evaluating-subagent"
import { SelfEvaluatingOrchestrator } from "./self-evaluating-orchestrator"
import type { Task } from "../types/self-evaluating-agent"
import type { IntegratedSubagentTask } from "./self-evaluating-orchestrator"

/**
 * Example 1: Basic self-evaluating subagent
 */
export async function exampleBasicAgent() {
  console.log("=".repeat(70))
  console.log("EXAMPLE 1: Basic Self-Evaluating Subagent")
  console.log("=".repeat(70))

  const agent = new SelfEvaluatingSubagent({
    agentId: "example-agent-1",
  })

  const task: Task = {
    type: "analysis",
    description: "Analyze code quality",
    tool: "read",
    requiresAnalysis: true,
    requiredFields: ["quality", "metrics"],
    successThreshold: 0.7,
    complexity: 0.5,
  }

  console.log("Executing task:", task.type)
  const [result, executionData] = await agent.executeTask(task)

  console.log("\n✓ Result:", result)
  console.log("✓ Success:", executionData.evaluation.success)
  console.log("✓ Confidence:", (executionData.evaluation.confidence * 100).toFixed(1) + "%")
  console.log("✓ Execution Time:", executionData.metrics?.timeTaken.toFixed(3) + "s")

  const status = agent.getStatus()
  console.log("\n📊 Agent Status:")
  console.log("  - Executions Completed:", status.executionsCompleted)
  console.log("  - Strategy Count:", status.strategyCount)
  console.log("  - Error Patterns Learned:", status.errorPatternsLearned)

  await agent.destroy()
}

/**
 * Example 2: Subagent with persistent knowledge
 */
export async function examplePersistentAgent() {
  console.log("\n" + "=".repeat(70))
  console.log("EXAMPLE 2: Subagent with Persistent Knowledge")
  console.log("=".repeat(70))

  const persistencePath = "/tmp/example-agent-persistent"

  // Create agent with persistence
  const agent = new SelfEvaluatingSubagent({
    agentId: "persistent-agent",
    persistenceEnabled: true,
    persistencePath,
  })

  // Execute multiple tasks to build knowledge
  const tasks: Task[] = [
    {
      type: "code_review",
      description: "Review code quality",
      tool: "read",
      requiresAnalysis: true,
      complexity: 0.6,
    },
    {
      type: "testing",
      description: "Test execution",
      tool: "execute",
      requiresExecution: true,
      complexity: 0.7,
    },
    {
      type: "documentation",
      description: "Generate documentation",
      tool: "write",
      requiresModification: true,
      complexity: 0.4,
    },
  ]

  console.log("Executing", tasks.length, "tasks to build knowledge...")

  for (const task of tasks) {
    const [result, executionData] = await agent.executeTask(task)
    console.log(`  ✓ ${task.type}: ${executionData.evaluation.success ? "SUCCESS" : "FAILED"}`)
  }

  // Save knowledge
  await agent.saveKnowledge()
  console.log("\n💾 Knowledge saved to:", persistencePath)

  const knowledge = agent.getKnowledgeExport()
  console.log("   - Strategy Weights:", Object.keys(knowledge.strategyWeights).length)
  console.log("   - Error Patterns:", Object.keys(knowledge.errorPatterns).length)
  console.log("   - Decisions Recorded:", knowledge.decisionCount)

  await agent.destroy()
}

/**
 * Example 3: Orchestrator with agent pool
 */
export async function exampleOrchestratorPool() {
  console.log("\n" + "=".repeat(70))
  console.log("EXAMPLE 3: Orchestrator with Agent Pool")
  console.log("=".repeat(70))

  const orchestrator = new SelfEvaluatingOrchestrator({
    agentPoolSize: 3,
    knowledgeSharing: true,
    crossAgentLearning: true,
    persistenceBasePath: "/tmp/agent-pool",
  })

  // Execute multiple tasks
  const tasks: IntegratedSubagentTask[] = [
    {
      id: "task-1",
      orchestrationID: "orch-1",
      agentID: "code",
      prompt: "Review pull request changes",
      status: "pending",
      dependsOn: [],
      createdAt: Date.now(),
      retries: 0,
      maxRetries: 2,
      autoEvaluate: true,
      persistExecution: true,
    },
    {
      id: "task-2",
      orchestrationID: "orch-1",
      agentID: "build",
      prompt: "Run build and tests",
      status: "pending",
      dependsOn: ["task-1"],
      createdAt: Date.now(),
      retries: 0,
      maxRetries: 2,
      autoEvaluate: true,
      persistExecution: true,
    },
    {
      id: "task-3",
      orchestrationID: "orch-1",
      agentID: "deploy",
      prompt: "Deploy to staging environment",
      status: "pending",
      dependsOn: ["task-2"],
      createdAt: Date.now(),
      retries: 0,
      maxRetries: 2,
      autoEvaluate: true,
      persistExecution: true,
    },
  ]

  console.log("Executing", tasks.length, "tasks with orchestrator...")

  for (const task of tasks) {
    const executionData = await orchestrator.executeTaskWithFeedback(task)
    console.log(
      `  ✓ ${task.agentID}: ${executionData.evaluation.success ? "SUCCESS" : "FAILED"} (Agent: ${executionData.auditTrail.find((e) => e.eventType === "ORCHESTRATOR_ASSIGNMENT")?.details})`,
    )
  }

  const stats = orchestrator.getStatistics()
  console.log("\n📊 Orchestrator Statistics:")
  console.log("  - Pool Size:", stats.poolStatistics.poolSize)
  console.log("  - Total Tasks Executed:", stats.totalTasksExecuted)

  // Save state
  await orchestrator.save()
  console.log("\n💾 Orchestrator state saved")

  await orchestrator.destroy()
}

/**
 * Example 4: Error handling and recovery
 */
export async function exampleErrorHandling() {
  console.log("\n" + "=".repeat(70))
  console.log("EXAMPLE 4: Error Handling and Recovery")
  console.log("=".repeat(70))

  const agent = new SelfEvaluatingSubagent({
    agentId: "error-handling-agent",
  })

  // Task with high complexity and dependencies
  const difficultTask: Task = {
    type: "complex_integration",
    description: "Complex integration task",
    tool: "execute",
    requiresAnalysis: true,
    requiresExecution: true,
    requiresEvaluation: true,
    requiredFields: ["integration_result", "validation_passed"],
    successThreshold: 0.8,
    complexity: 0.9,
    dependencies: ["dep1", "dep2", "dep3"],
    retries: 2,
  }

  console.log("Executing difficult task:")
  const [result, executionData] = await agent.executeTask(difficultTask)

  console.log("\nExecution Details:")
  console.log("  - Status:", executionData.evaluation.success ? "SUCCESS" : "FAILED")
  console.log("  - Confidence:", (executionData.evaluation.confidence * 100).toFixed(1) + "%")
  console.log("  - Completeness:", (executionData.evaluation.completenessScore * 100).toFixed(1) + "%")
  console.log("  - Quality:", (executionData.evaluation.qualityScore * 100).toFixed(1) + "%")

  console.log("\nAudit Trail (Last 10 events):")
  const auditTrail = agent.getAuditLog(10)
  for (const entry of auditTrail) {
    console.log(`  - ${entry.timestamp}: [${entry.eventType}]`)
  }

  const knowledge = agent.getKnowledgeExport()
  console.log("\nLearned Strategies:")
  for (const [tool, weight] of Object.entries(knowledge.strategyWeights)) {
    console.log(`  - ${tool}: ${(weight * 100).toFixed(1)}%`)
  }

  await agent.destroy()
}

/**
 * Example 5: Knowledge sharing across agents
 */
export async function exampleKnowledgeSharing() {
  console.log("\n" + "=".repeat(70))
  console.log("EXAMPLE 5: Knowledge Sharing Across Agents")
  console.log("=".repeat(70))

  const agent1 = new SelfEvaluatingSubagent({
    agentId: "agent-1",
    persistenceEnabled: true,
    persistencePath: "/tmp/agent-1",
  })

  const agent2 = new SelfEvaluatingSubagent({
    agentId: "agent-2",
    persistenceEnabled: true,
    persistencePath: "/tmp/agent-2",
  })

  // Agent 1 learns from successful pattern
  console.log("Agent 1 executing learning task...")
  await agent1.executeTask({
    type: "pattern_learning",
    description: "Learn a successful pattern",
    tool: "read",
    complexity: 0.3,
  })

  // Export knowledge from agent 1
  const agent1Knowledge = agent1.getKnowledgeExport()
  console.log("Agent 1 exported knowledge:")
  console.log("  - Decisions made:", agent1Knowledge.decisionCount)
  console.log("  - Strategies learned:", Object.keys(agent1Knowledge.strategyWeights).length)

  // Agent 2 could use this knowledge (in a real scenario, through shared storage)
  console.log("\nAgent 2 would use agent 1's knowledge for:")
  console.log("  - Better strategy selection")
  console.log("  - Avoiding known error patterns")
  console.log("  - Faster convergence on optimal solutions")

  await agent1.saveKnowledge()
  await agent1.destroy()
  await agent2.destroy()

  console.log("\n✓ Knowledge sharing example complete")
}

/**
 * Run all examples
 */
export async function runAllExamples() {
  try {
    await exampleBasicAgent()
    await examplePersistentAgent()
    await exampleOrchestratorPool()
    await exampleErrorHandling()
    await exampleKnowledgeSharing()

    console.log("\n" + "=".repeat(70))
    console.log("✓ All examples completed successfully")
    console.log("=".repeat(70))
  } catch (error) {
    console.error("Error running examples:", error)
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  runAllExamples().catch(console.error)
}
