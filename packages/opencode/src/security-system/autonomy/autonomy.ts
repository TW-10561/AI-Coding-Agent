import { Log } from "../../util/log"
import z from "zod"

const log = Log.create({ service: "autonomy" })

/**
 * Agent autonomy modes
 */
export const AgentAutonomyMode = z.enum(["supervised", "semi_autonomous", "fully_autonomous"])
export type AgentAutonomyMode = z.infer<typeof AgentAutonomyMode>

/**
 * Behavior mapping for autonomy modes
 * Affects how aggressively the permission risk thresholds are applied
 */
export const AUTONOMY_BEHAVIOR: Record<
  AgentAutonomyMode,
  {
    askMultiplier: number
    denyMultiplier: number
    maxIterations: number
    description: string
  }
> = {
  supervised: {
    askMultiplier: 1.5,
    denyMultiplier: 1.2,
    maxIterations: 5,
    description: "Agent requires frequent user approval. Use for critical operations.",
  },
  semi_autonomous: {
    askMultiplier: 1.0,
    denyMultiplier: 1.0,
    maxIterations: 10,
    description: "Balanced mode with standard approval requirements.",
  },
  fully_autonomous: {
    askMultiplier: 0.7,
    denyMultiplier: 0.8,
    maxIterations: 20,
    description: "Agent operates with minimal interruption. Use only for trusted agents.",
  },
}

/**
 * Agent autonomy configuration
 */
export interface AgentAutonomyConfig {
  mode: AgentAutonomyMode
  maxIterations?: number
  requireApprovalOnHighRisk?: boolean
  requireApprovalOnLoopDetection?: boolean
  allowSandboxExecution?: boolean
}

/**
 * Agent autonomy controller
 * Manages how much independent action an agent can take
 */
export class AgentAutonomyController {
  private agents: Map<string, AgentAutonomyConfig> = new Map()

  /**
   * Register an agent with autonomy configuration
   */
  registerAgent(agentName: string, config: AgentAutonomyConfig): void {
    this.agents.set(agentName, config)
    log.info("Agent registered", { agentName, mode: config.mode })
  }

  /**
   * Get autonomy configuration for an agent
   */
  getConfig(agentName: string): AgentAutonomyConfig {
    return this.agents.get(agentName) || {
      mode: "semi_autonomous",
    }
  }

  /**
   * Get autonomy mode for an agent
   */
  getMode(agentName: string): AgentAutonomyMode {
    return this.getConfig(agentName).mode
  }

  /**
   * Get behavior parameters for an agent
   */
  getBehavior(agentName: string) {
    const mode = this.getMode(agentName)
    return AUTONOMY_BEHAVIOR[mode]
  }

  /**
   * Check if agent is in supervised mode
   */
  isSupervised(agentName: string): boolean {
    return this.getMode(agentName) === "supervised"
  }

  /**
   * Check if agent is fully autonomous
   */
  isFullyAutonomous(agentName: string): boolean {
    return this.getMode(agentName) === "fully_autonomous"
  }

  /**
   * Get max iterations for an agent
   */
  getMaxIterations(agentName: string): number {
    const config = this.getConfig(agentName)
    if (config.maxIterations) return config.maxIterations

    const behavior = this.getBehavior(agentName)
    return behavior.maxIterations
  }

  /**
   * Check if high-risk actions require approval
   */
  requiresApprovalOnHighRisk(agentName: string): boolean {
    const config = this.getConfig(agentName)
    if (config.requireApprovalOnHighRisk !== undefined) {
      return config.requireApprovalOnHighRisk
    }
    // Default: supervised mode requires approval on high risk
    return this.isSupervised(agentName)
  }

  /**
   * Check if loop detection requires approval
   */
  requiresApprovalOnLoopDetection(agentName: string): boolean {
    const config = this.getConfig(agentName)
    if (config.requireApprovalOnLoopDetection !== undefined) {
      return config.requireApprovalOnLoopDetection
    }
    // Default: all modes require approval on loop
    return true
  }

  /**
   * Check if sandbox execution is allowed
   */
  allowsSandboxExecution(agentName: string): boolean {
    const config = this.getConfig(agentName)
    if (config.allowSandboxExecution !== undefined) {
      return config.allowSandboxExecution
    }
    // Default: allow sandbox for all modes
    return true
  }

  /**
   * Calculate risk threshold multiplier for permission decisions
   */
  getRiskThresholdMultiplier(agentName: string, thresholdType: "ask" | "deny"): number {
    const behavior = this.getBehavior(agentName)
    return thresholdType === "ask" ? behavior.askMultiplier : behavior.denyMultiplier
  }

  /**
   * Apply autonomy-based threshold adjustments to risk scores
   */
  adjustRiskThreshold(agentName: string, baseThreshold: number, thresholdType: "ask" | "deny"): number {
    const multiplier = this.getRiskThresholdMultiplier(agentName, thresholdType)
    return Math.round(baseThreshold * multiplier)
  }

  /**
   * Update autonomy configuration for an agent
   */
  updateConfig(agentName: string, config: Partial<AgentAutonomyConfig>): void {
    const current = this.getConfig(agentName)
    const updated = { ...current, ...config }
    this.registerAgent(agentName, updated)
    log.info("Agent autonomy config updated", { agentName, mode: updated.mode })
  }

  /**
   * Set global autonomy mode for all agents
   */
  setGlobalMode(mode: AgentAutonomyMode): void {
    for (const [agentName, config] of this.agents) {
      config.mode = mode
    }
    log.info("Global autonomy mode set", { mode })
  }

  /**
   * Get all registered agents
   */
  getRegisteredAgents(): string[] {
    return Array.from(this.agents.keys())
  }

  /**
   * Get summary of all agent autonomy configurations
   */
  getSummary(): Array<{
    name: string
    mode: AgentAutonomyMode
    maxIterations: number
    requiresApprovalOnHighRisk: boolean
    requiresApprovalOnLoopDetection: boolean
  }> {
    return Array.from(this.agents.entries()).map(([name, config]) => ({
      name,
      mode: config.mode,
      maxIterations: this.getMaxIterations(name),
      requiresApprovalOnHighRisk: this.requiresApprovalOnHighRisk(name),
      requiresApprovalOnLoopDetection: this.requiresApprovalOnLoopDetection(name),
    }))
  }

  /**
   * Get description for a mode
   */
  getModeDescription(mode: AgentAutonomyMode): string {
    return AUTONOMY_BEHAVIOR[mode].description
  }

  /**
   * Check if agent has reached maximum iterations
   */
  hasReachedMaxIterations(agentName: string, currentIterations: number): boolean {
    return currentIterations >= this.getMaxIterations(agentName)
  }

  /**
   * Get remaining iterations for an agent
   */
  getRemainingIterations(agentName: string, currentIterations: number): number {
    const max = this.getMaxIterations(agentName)
    return Math.max(0, max - currentIterations)
  }
}

export const defaultAgentAutonomyController = new AgentAutonomyController()
