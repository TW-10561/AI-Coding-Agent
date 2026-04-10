import { RiskEngine } from "@/risk/engine"
import { Config } from "@/config/config"
import { Log } from "@/util/log"

/**
 * Risk-aware tool execution utilities.
 * 
 * This module provides utilities for integrating risk classification
 * into tool execution without modifying the core tool.ts file.
 */
export namespace ToolRisk {
  const log = Log.create({ service: "tool-risk" })

  /**
   * Get risk configuration
   */
  export async function getConfig(): Promise<{
    enabled: boolean
    autoApproveLowRisk: boolean
  }> {
    try {
      const cfg = await Config.get()
      const riskConfig = (cfg as any).risk
      return {
        enabled: riskConfig?.enabled ?? true,
        autoApproveLowRisk: riskConfig?.autoApproveLowRisk ?? false,
      }
    } catch {
      return {
        enabled: true,
        autoApproveLowRisk: false,
      }
    }
  }

  /**
   * Classify risk for a tool operation
   */
  export function classify(
    tool: string,
    args: Record<string, any>
  ): RiskEngine.Classification {
    const context: RiskEngine.Context = {
      tool,
      command: args.command as string | undefined,
      filePath: args.filePath as string | undefined || args.path as string | undefined,
      patterns: args.patterns as string[] | undefined,
      metadata: args,
    }
    return RiskEngine.classify(context)
  }

  /**
   * Check if an operation should be auto-approved based on risk
   */
  export async function shouldAutoApprove(
    tool: string,
    args: Record<string, any>
  ): Promise<boolean> {
    const config = await getConfig()
    if (!config.enabled || !config.autoApproveLowRisk) {
      return false
    }

    const classification = classify(tool, args)
    return classification.level === "low"
  }

  /**
   * Get risk metadata to include in permission request
   */
  export function getRiskMetadata(
    tool: string,
    args: Record<string, any>
  ): {
    risk: RiskEngine.Level
    riskReason: string
    approvalType: "local" | "global"
  } {
    const classification = classify(tool, args)
    return {
      risk: classification.level,
      riskReason: classification.reason,
      approvalType: RiskEngine.getApprovalType(classification),
    }
  }

  /**
   * Enhance permission request with risk information
   */
  export function enhancePermissionRequest(
    tool: string,
    args: Record<string, any>,
    request: Record<string, any>
  ): Record<string, any> {
    const riskInfo = getRiskMetadata(tool, args)
    return {
      ...request,
      metadata: {
        ...request.metadata,
        _risk: riskInfo.risk,
        _riskReason: riskInfo.riskReason,
        _approvalType: riskInfo.approvalType,
      },
    }
  }

  /**
   * Log risk classification for debugging
   */
  export function logClassification(
    tool: string,
    args: Record<string, any>
  ): void {
    const classification = classify(tool, args)
    log.info("tool risk classification", {
      tool,
      risk: classification.level,
      reason: classification.reason,
      requiresGlobalApproval: classification.requiresGlobalApproval,
    })
  }
}
