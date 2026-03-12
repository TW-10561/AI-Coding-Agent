/**
 * Self-Evaluating Subagent Module - Barrel Export
 * Exports all public APIs for the self-evaluating subagent system
 */

// Types
export type {
  ExecutionMetric,
  StrategyDecision,
  KnowledgeEntry,
  Task,
  ProcessedTask,
  TaskAnalysis,
  Strategy,
  ExecutionResult,
  EvaluationResult,
  FailureAnalysis,
  AuditEntry,
  ExecutionData,
  AgentStatus,
  KnowledgeExport,
  SelfEvaluatingAgentOptions,
  KnowledgeBaseOptions,
} from "../types/self-evaluating-agent"

export {
  TaskStatus,
  ToolType,
} from "../types/self-evaluating-agent"

// Core Services
export { KnowledgeBase } from "./knowledge-base"
export { Reasoner } from "./reasoner"
export { ResultEvaluator } from "./result-evaluator"
export { StrategyImprover } from "./strategy-improver"
export { SafetyMonitor } from "./safety-monitor"
export { SelfEvaluatingSubagent } from "./self-evaluating-subagent"

// Orchestration
export {
  SelfEvaluatingSubagentPool,
  SelfEvaluatingOrchestrator,
} from "./self-evaluating-orchestrator"

export type {
  IntegratedSubagentTask,
  IntegratedOrchestrationConfig,
} from "./self-evaluating-orchestrator"

// Examples
export {
  exampleBasicAgent,
  examplePersistentAgent,
  exampleOrchestratorPool,
  exampleErrorHandling,
  exampleKnowledgeSharing,
  runAllExamples,
} from "./examples"
