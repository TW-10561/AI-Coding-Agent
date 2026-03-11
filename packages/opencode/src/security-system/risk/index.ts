/**
 * Risk Assessment Engine
 *
 * Dynamic risk scoring for actions:
 * - Command analysis (destructive patterns, package installs, network calls)
 * - File operations (sensitive files, large diffs, deletions)
 * - Loop detection signals (repeated commands, errors, high iterations)
 * - Automatic thresholds: deny (80), ask (40), allow (0)
 */

export * from "./riskEngine"
