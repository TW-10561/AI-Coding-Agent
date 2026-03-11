import { Log } from "../util/log"
import z from "zod"

const log = Log.create({ service: "skill-trust" })

/**
 * Trust levels for skills
 */
export const SkillTrustLevel = z.enum(["trusted", "restricted", "untrusted"])
export type SkillTrustLevel = z.infer<typeof SkillTrustLevel>

/**
 * Behavior mapping for trust levels
 */
export const TRUST_BEHAVIOR: Record<SkillTrustLevel, "allow" | "ask" | "sandbox"> = {
  trusted: "allow",
  restricted: "ask",
  untrusted: "sandbox",
}

/**
 * Skill metadata with trust information
 */
export interface SkillInfo {
  name: string
  description?: string
  trustLevel: SkillTrustLevel
  version?: string
  author?: string
  verified?: boolean
  riskFactors?: string[]
}

/**
 * Skill trust system
 * Manages trust levels and determines execution context for skills
 */
export class SkillTrustManager {
  private skillTrustMap: Map<string, SkillTrustLevel> = new Map()
  private skillMetadata: Map<string, SkillInfo> = new Map()

  /**
   * Register a skill with a trust level
   */
  registerSkill(skillName: string, trustLevel: SkillTrustLevel, metadata?: Omit<SkillInfo, "name" | "trustLevel">): void {
    this.skillTrustMap.set(skillName, trustLevel)

    const info: SkillInfo = {
      name: skillName,
      trustLevel,
      ...metadata,
    }

    this.skillMetadata.set(skillName, info)

    log.info("Skill registered", { skillName, trustLevel })
  }

  /**
   * Get trust level for a skill
   */
  getTrustLevel(skillName: string): SkillTrustLevel {
    return this.skillTrustMap.get(skillName) || "restricted"
  }

  /**
   * Get behavior for a skill (allow/ask/sandbox)
   */
  getBehavior(skillName: string): "allow" | "ask" | "sandbox" {
    const trustLevel = this.getTrustLevel(skillName)
    return TRUST_BEHAVIOR[trustLevel]
  }

  /**
   * Check if skill is trusted
   */
  isTrusted(skillName: string): boolean {
    return this.getTrustLevel(skillName) === "trusted"
  }

  /**
   * Check if skill is restricted
   */
  isRestricted(skillName: string): boolean {
    return this.getTrustLevel(skillName) === "restricted"
  }

  /**
   * Check if skill should run in sandbox
   */
  shouldSandbox(skillName: string): boolean {
    return this.getTrustLevel(skillName) === "untrusted"
  }

  /**
   * Get skill metadata
   */
  getMetadata(skillName: string): SkillInfo | undefined {
    return this.skillMetadata.get(skillName)
  }

  /**
   * Alias for getMetadata
   */
  getSkillInfo(skillName: string): SkillInfo | undefined {
    return this.getMetadata(skillName)
  }

  /**
   * Update trust level for a skill
   */
  updateTrustLevel(skillName: string, trustLevel: SkillTrustLevel): void {
    this.skillTrustMap.set(skillName, trustLevel)

    const metadata = this.skillMetadata.get(skillName)
    if (metadata) {
      metadata.trustLevel = trustLevel
    }

    log.info("Skill trust level updated", { skillName, trustLevel })
  }

  /**
   * Set custom trust level mapping (for configuration)
   */
  setTrustMap(trustMap: Record<string, SkillTrustLevel>): void {
    for (const [name, level] of Object.entries(trustMap)) {
      this.registerSkill(name, level)
    }

    log.info("Skill trust map updated", { count: Object.keys(trustMap).length })
  }

  /**
   * Get all registered skills
   */
  getRegisteredSkills(): string[] {
    return Array.from(this.skillTrustMap.keys())
  }

  /**
   * Get all skills with a specific trust level
   */
  getSkillsByTrustLevel(trustLevel: SkillTrustLevel): string[] {
    return Array.from(this.skillTrustMap.entries())
      .filter(([_, level]) => level === trustLevel)
      .map(([name]) => name)
  }

  /**
   * Check skill execution requirements
   */
  getExecutionRequirements(skillName: string): {
    requiresApproval: boolean
    requiresSandbox: boolean
    trustLevel: SkillTrustLevel
  } {
    const trustLevel = this.getTrustLevel(skillName)
    const behavior = TRUST_BEHAVIOR[trustLevel]

    return {
      requiresApproval: behavior === "ask",
      requiresSandbox: behavior === "sandbox",
      trustLevel,
    }
  }

  /**
   * Report risk factors for a skill
   */
  getRiskFactors(skillName: string): string[] {
    const metadata = this.skillMetadata.get(skillName)
    return metadata?.riskFactors || []
  }

  /**
   * Build a trust report for a skill
   */
  buildReport(skillName: string): {
    name: string
    trustLevel: SkillTrustLevel
    behavior: "allow" | "ask" | "sandbox"
    riskFactors: string[]
    verified: boolean
    recommendation: string
  } {
    const metadata = this.getMetadata(skillName)
    const trustLevel = this.getTrustLevel(skillName)
    const behavior = TRUST_BEHAVIOR[trustLevel]
    const riskFactors = this.getRiskFactors(skillName)

    let recommendation = ""
    switch (trustLevel) {
      case "trusted":
        recommendation = "This skill is fully trusted and can execute with full permissions"
        break
      case "restricted":
        recommendation = "This skill requires approval for each execution"
        break
      case "untrusted":
        recommendation = "This skill should only execute in a sandboxed environment"
        break
    }

    return {
      name: skillName,
      trustLevel,
      behavior,
      riskFactors,
      verified: metadata?.verified || false,
      recommendation,
    }
  }
}

export const defaultSkillTrustManager = new SkillTrustManager()
