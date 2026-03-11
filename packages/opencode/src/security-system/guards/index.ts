/**
 * Security Guards
 *
 * Protective mechanisms for:
 * - Sensitive file detection (.env, .key, credentials, etc.)
 * - Destructive command detection (rm -rf, git push --force, etc.)
 */

export * from "./sensitiveFiles"
export * from "./destructiveGuard"
