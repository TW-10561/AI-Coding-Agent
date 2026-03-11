import { Log } from "../../util/log"
import z from "zod"

const log = Log.create({ service: "rbac" })

/**
 * User roles in the system
 */
export const Role = z.enum(["admin", "developer", "readonly", "autonomous_agent"])
export type Role = z.infer<typeof Role>

/**
 * Role-based policy rules
 */
export interface RolePolicy {
  bash?: "allow" | "ask" | "deny"
  edit?: "allow" | "ask" | "deny"
  read?: "allow" | "ask" | "deny"
  webfetch?: "allow" | "ask" | "deny"
  external_directory?: "allow" | "ask" | "deny"
  doom_loop?: "allow" | "ask" | "deny"
  skill?: "allow" | "ask" | "deny"
}

/**
 * Role-based access control (RBAC) system
 * Desktop implementations can extend this for LDAP, OAuth, etc.
 */
export class RBACEngine {
  private rolePolicies: Record<Role, RolePolicy> = {
    admin: {
      bash: "allow",
      edit: "allow",
      read: "allow",
      webfetch: "allow",
      external_directory: "allow",
      doom_loop: "allow",
      skill: "allow",
    },
    developer: {
      bash: "ask",
      edit: "allow",
      read: "allow",
      webfetch: "ask",
      external_directory: "ask",
      doom_loop: "ask",
      skill: "allow",
    },
    readonly: {
      bash: "deny",
      edit: "deny",
      read: "allow",
      webfetch: "deny",
      external_directory: "deny",
      doom_loop: "deny",
      skill: "deny",
    },
    autonomous_agent: {
      bash: "allow",
      edit: "allow",
      read: "allow",
      webfetch: "allow",
      external_directory: "allow",
      doom_loop: "ask",
      skill: "allow",
    },
  }

  private customPolicies: Map<Role, Partial<RolePolicy>> = new Map()

  /**
   * Get the policy for a role
   */
  getPolicy(role: Role): RolePolicy {
    const basePolicy = this.rolePolicies[role]
    const customPolicy = this.customPolicies.get(role)

    if (!customPolicy) return basePolicy

    return {
      ...basePolicy,
      ...customPolicy,
    }
  }

  /**
   * Get permission for a specific permission type and role
   */
  getPermission(role: Role, permission: string): "allow" | "ask" | "deny" {
    const policy = this.getPolicy(role)
    return (policy as any)[permission] || "ask"
  }

  /**
   * Check if a user with a given role can perform an action
   */
  canAccess(role: Role, permission: string): boolean {
    const perm = this.getPermission(role, permission)
    return perm === "allow"
  }

  /**
   * Check if a user with a given role needs to be asked for permission
   */
  needsApproval(role: Role, permission: string): boolean {
    const perm = this.getPermission(role, permission)
    return perm === "ask"
  }

  /**
   * Check if a user with a given role is denied access
   */
  isDenied(role: Role, permission: string): boolean {
    const perm = this.getPermission(role, permission)
    return perm === "deny"
  }

  /**
   * Set custom policy for a role
   */
  setCustomPolicy(role: Role, policy: Partial<RolePolicy>): void {
    this.customPolicies.set(role, policy)
    log.info("Custom policy set", { role, policy })
  }

  /**
   * Reset custom policies
   */
  resetCustomPolicies(): void {
    this.customPolicies.clear()
    log.info("Custom policies reset")
  }

  /**
   * Get all available roles
   */
  getAllRoles(): Role[] {
    return ["admin", "developer", "readonly", "autonomous_agent"]
  }

  /**
   * Get all permissions that can be controlled by RBAC
   */
  getAllPermissions(): string[] {
    return ["bash", "edit", "read", "webfetch", "external_directory", "doom_loop", "skill"]
  }

  /**
   * Check if a role is higher privilege than another
   */
  isHigherPrivilege(role1: Role, role2: Role): boolean {
    const hierarchy: Record<Role, number> = {
      readonly: 1,
      developer: 2,
      autonomous_agent: 2,
      admin: 3,
    }
    return hierarchy[role1] > hierarchy[role2]
  }
}

/**
 * Context for RBAC decisions
 */
export interface RBACContext {
  userRole: Role
  permission: string
  resource?: string
}

/**
 * Make an RBAC decision
 */
export class RBACDecisionEngine {
  private rbac: RBACEngine

  constructor(rbac?: RBACEngine) {
    this.rbac = rbac || new RBACEngine()
  }

  /**
   * Make access decision based on user role
   */
  decide(context: RBACContext): "allow" | "ask" | "deny" {
    const permission = this.rbac.getPermission(context.userRole, context.permission)

    log.debug("RBAC decision made", {
      role: context.userRole,
      permission: context.permission,
      decision: permission,
      resource: context.resource,
    })

    return permission
  }

  /**
   * Get decision explanation
   */
  explain(context: RBACContext): string {
    const decision = this.decide(context)
    const role = context.userRole

    if (decision === "allow") {
      return `Role "${role}" has permission to ${context.permission}`
    } else if (decision === "ask") {
      return `Role "${role}" can ${context.permission} but requires approval`
    } else {
      return `Role "${role}" is not permitted to ${context.permission}`
    }
  }
}

export const defaultRBACEngine = new RBACEngine()
export const defaultRBACDecisionEngine = new RBACDecisionEngine()
