/**
 * ============================================================================
 * COMPREHENSIVE SECURITY SYSTEM FOR AI CODING AGENT
 * ============================================================================
 *
 * A complete, enterprise-grade security framework with 10 integrated components
 * for sandboxing, access control, risk assessment, and monitoring.
 *
 * Build Order (Recommended):
 * 1. Execution Isolation (execution/*)
 * 2. Protective Guards (guards/*)
 * 3. Risk Engine (risk/*)
 * 4. Access Control (access-control/*)
 * 5. Network Policy (network/*)
 * 6. Monitoring (monitoring/*)
 * 7. Agent Autonomy (autonomy/*)
 *
 * ============================================================================
 */

// 1. Execution Isolation & Sandboxing
export * from "./execution"

// 2. Protective Guards
export * from "./guards"

// 3. Risk Assessment Engine
export * from "./risk"

// 4. Access Control System
export * from "./access-control"

// 5. Network Access Control
export * from "./network"

// 6. Monitoring & Detection
export * from "./monitoring"

// 7. Agent Autonomy Control
export * from "./autonomy"

/**
 * Quick Integration Guide
 * =======================
 *
 * // Initialize all security systems
 * import {
 *   DockerRunner, HostRunner,
 *   isSensitive, isDestructive,
 *   RiskEngine,
 *   RBACEngine, SkillTrustManager,
 *   NetworkGuard,
 *   AuditLogger, LoopGuard,
 *   AgentAutonomyController
 * } from '@/security-system'
 *
 * // Create instances with configuration
 * const sandbox = new DockerRunner()
 * const riskEngine = new RiskEngine({ deny: 80, ask: 40 })
 * const rbac = new RBACEngine()
 * const network = new NetworkGuard({ mode: 'allowlist' })
 * const audit = new AuditLogger()
 * const autonomy = new AgentAutonomyController()
 *
 * // Use in permission flow
 * const assessment = riskEngine.assess({
 *   command: userCommand,
 *   filePath: targetFile,
 *   touchesSensitiveFile: isSensitive(targetFile),
 *   isDestructive: isDestructive({ command: userCommand })
 * })
 *
 * // Apply RBAC + autonomy adjustments
 * const rbacDecision = rbac.getPermission(userRole, 'bash')
 * const adjustedThreshold = autonomy.adjustRiskThreshold(agentName, 40, 'ask')
 *
 * // Log decisions
 * await audit.logPermissionDecision({
 *   user: username,
 *   action: userCommand,
 *   result: assessment.recommendation,
 *   riskScore: assessment.score
 * })
 */
