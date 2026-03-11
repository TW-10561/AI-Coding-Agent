/**
 * Agent Autonomy Control
 *
 * Manages agent independence levels:
 * - Supervised: Frequent approvals (1.5x ask threshold, max 5 iterations)
 * - Semi-autonomous: Balanced (1.0x ask threshold, max 10 iterations)
 * - Fully autonomous: Minimal interruptions (0.7x ask threshold, max 20 iterations)
 */

export * from "./autonomy"
