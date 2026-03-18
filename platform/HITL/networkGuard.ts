import { Log } from "../util/log"
import z from "zod"

const log = Log.create({ service: "network-policy" })

/**
 * Network access mode
 */
export type NetworkMode = "allow" | "deny" | "allowlist"

/**
 * Network policy configuration
 */
export const NetworkPolicy = z.object({
  mode: z.enum(["allow", "deny", "allowlist"]).default("allow"),
  allowDomains: z.array(z.string()).optional(),
  deniedDomains: z.array(z.string()).optional(),
})
export type NetworkPolicy = z.infer<typeof NetworkPolicy>

/**
 * Network access guard
 * Prevents data exfiltration and unauthorized network access
 */
export class NetworkGuard {
  private policy: NetworkPolicy

  constructor(policy?: NetworkPolicy) {
    this.policy = policy || { mode: "allow" }
  }

  /**
   * Update the network policy
   */
  updatePolicy(policy: NetworkPolicy): void {
    this.policy = policy
    log.debug("Network policy updated", { policy })
  }

  /**
   * Get current policy
   */
  getPolicy(): NetworkPolicy {
    return this.policy
  }

  /**
   * Extract domain from URL
   */
  private extractDomain(url: string): string {
    try {
      const parsed = new URL(url)
      return parsed.hostname || parsed.href
    } catch {
      // If not a valid URL, try to extract domain manually
      const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^/?]+)/)
      return match ? match[1] : url
    }
  }

  /**
   * Check if a domain is an IP address
   */
  private isIP(domain: string): boolean {
    return /^\d+\.\d+\.\d+\.\d+$/.test(domain) || /^::1$|^::|^\[/.test(domain) // IPv4 or IPv6
  }

  /**
   * Check if domain matches a pattern (supports wildcards)
   */
  private matchesDomain(domain: string, pattern: string): boolean {
    if (pattern === "*") return true
    if (pattern === domain) return true

    // Wildcard domain matching
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1)
      return domain.endsWith(suffix) || domain === pattern.slice(2)
    }

    return false
  }

  /**
   * Check if a URL is allowed (simplified method)
   */
  isAllowed(url: string): boolean {
    return this.checkUrl(url).allowed
  }

  /**
   * Check if a URL is allowed by the policy
   */
  checkUrl(url: string): { allowed: boolean; reason?: string } {
    const domain = this.extractDomain(url)

    log.debug("Checking URL access", { url, domain, policy: this.policy.mode })

    // "allow" mode - allow all access
    if (this.policy.mode === "allow") {
      return { allowed: true }
    }

    // "deny" mode - deny all access
    if (this.policy.mode === "deny") {
      return {
        allowed: false,
        reason: `Network access is disabled. URL: ${url}`,
      }
    }

    // "allowlist" mode - check against allowed domains
    if (this.policy.mode === "allowlist") {
      const allowDomains = this.policy.allowDomains || []

      // Check denied domains first
      if (this.policy.deniedDomains) {
        for (const denied of this.policy.deniedDomains) {
          if (this.matchesDomain(domain, denied)) {
            return {
              allowed: false,
              reason: `Domain is explicitly denied: ${domain}`,
            }
          }
        }
      }

      // Check if domain is in allowlist
      let isAllowed = false
      for (const allowed of allowDomains) {
        if (this.matchesDomain(domain, allowed)) {
          isAllowed = true
          break
        }
      }

      if (!isAllowed) {
        return {
          allowed: false,
          reason: `Domain not in allowlist: ${domain}. Allowed domains: ${allowDomains.join(", ")}`,
        }
      }

      return { allowed: true }
    }

    return { allowed: true }
  }

  /**
   * Check if localhost/internal access
   */
  isInternalAccess(url: string): boolean {
    const domain = this.extractDomain(url)
    return (
      domain === "localhost" ||
      domain === "127.0.0.1" ||
      domain === "::1" ||
      domain.startsWith("192.168.") ||
      domain.startsWith("10.") ||
      domain.startsWith("172.16.") ||
      domain === "0.0.0.0"
    )
  }

  /**
   * Get isolation command for Docker (when sandboxing)
   */
  getDockerNetworkArgs(): string[] {
    if (this.policy.mode !== "allow") {
      // In deny or allowlist mode, disable network in Docker
      return ["--network=none"]
    }
    // In allow mode, allow network
    return []
  }
}

export const defaultNetworkGuard = new NetworkGuard()
