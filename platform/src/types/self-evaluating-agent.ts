/**
 * Self-Evaluating Subagent Types
 * Autonomous agent that follows soul.md principles:
 * Input → Reason → Tool → Output → Evaluate → Improve → Update Knowledge
 */

export enum TaskStatus {
  PENDING = "pending",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  FAILED = "failed",
  RETRYING = "retrying",
}

export enum ToolType {
  READ = "read",
  WRITE = "write",
  SEARCH = "search",
  EXECUTE = "execute",
  EVALUATE = "evaluate",
  PLAN = "plan",
}

export interface ExecutionMetric {
  toolUsed: string
  success: boolean
  timeTaken: number // seconds
  tokensUsed?: number
  errorMessage?: string
  confidenceScore?: number
}

export interface StrategyDecision {
  taskType: string
  chosenStrategy: string
  alternativesConsidered: string[]
  reasoning: string
  outcome?: string
  success: boolean
  timestamp: string
}

export interface KnowledgeEntry {
  pattern: string
  taskTypes: string[]
  successRate: number
  toolChain: string[]
  failureModes: string[]
  confidence: number
  lastUpdated: string
}

export interface Task {
  type: string
  description: string
  tool?: string
  requiresAnalysis?: boolean
  requiresModification?: boolean
  requiresExecution?: boolean
  requiresEvaluation?: boolean
  requiredFields?: string[]
  successThreshold?: number
  dependencies?: string[]
  retries?: number
  complexity?: number
  metadata?: Record<string, unknown>
}

export interface ProcessedTask extends Task {
  processedAt: string
  uniqueId: string
}

export interface TaskAnalysis {
  taskType: string
  complexity: number
  recommendedStrategy: string
  recommendedTools: string[]
  antiPatternsToAvoid: string[]
  estimatedEffort: "low" | "medium" | "high"
}

export interface Strategy {
  name: string
  description: string
  priority: number
  expectedEfficiency: number
}

export interface ExecutionResult {
  status: "success" | "empty_result" | "error"
  data?: unknown
  error?: string
  timeTaken?: number
}

export interface EvaluationResult {
  timestamp: string
  completenessScore: number
  qualityScore: number
  safetyValid: boolean
  success: boolean
  confidence: number
  error?: string
}

export interface FailureAnalysis {
  failureType: string
  rootCause: string
  contributingFactors: string[]
  recoveryStrategies: string[]
}

export interface AuditEntry {
  executionId: string
  timestamp: string
  eventType: string
  details: unknown
}

export interface ExecutionData {
  output: unknown
  executionId: string
  evaluation: EvaluationResult
  metrics?: ExecutionMetric
  auditTrail: AuditEntry[]
  error?: string
}

export interface AgentStatus {
  agentId: string
  executionsCompleted: number
  strategyCount: number
  errorPatternsLearned: number
  knowledgeExport: KnowledgeExport
}

export interface KnowledgeExport {
  strategyWeights: Record<string, number>
  errorPatterns: Record<string, number>
  executionCount: number
  decisionCount: number
  decisionHistory?: StrategyDecision[]
}

export interface SelfEvaluatingAgentOptions {
  agentId: string
  maxAuditLog?: number
  persistenceEnabled?: boolean
  persistencePath?: string
}

export interface KnowledgeBaseOptions {
  persistenceEnabled?: boolean
  persistencePath?: string
  autoSyncInterval?: number // milliseconds
}
