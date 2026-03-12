/**
 * Safety Monitor
 * Enforces safety constraints on tasks and outputs
 */

import type { Task } from "../types/self-evaluating-agent"

export class SafetyMonitor {
  private static readonly FORBIDDEN_CONTENT = [
    "harmful",
    "hateful",
    "dangerous",
    "racist",
    "sexist",
    "violent",
    "exploit",
    "malicious",
  ]

  /**
   * Validate task for safety violations
   */
  static validateInput(task: unknown): [boolean, string] {
    const taskStr = JSON.stringify(task).toLowerCase()

    for (const forbiddenWord of this.FORBIDDEN_CONTENT) {
      if (taskStr.includes(forbiddenWord)) {
        return [false, `Task contains forbidden content: ${forbiddenWord}`]
      }
    }

    return [true, "Task is safe"]
  }

  /**
   * Validate output for safety violations
   */
  static validateOutput(output: unknown): [boolean, string] {
    const outputStr =
      typeof output === "string" ? output : JSON.stringify(output)
    const outputLower = outputStr.toLowerCase()

    for (const forbiddenWord of this.FORBIDDEN_CONTENT) {
      if (outputLower.includes(forbiddenWord)) {
        return [false, `Output contains forbidden content: ${forbiddenWord}`]
      }
    }

    return [true, "Output is safe"]
  }

  /**
   * Validate tool call parameters
   */
  static validateToolCall(tool: string, params?: Record<string, unknown>): [boolean, string] {
    const validTools = ["read", "write", "search", "execute", "evaluate", "plan"]

    if (!validTools.includes(tool)) {
      return [false, `Unknown tool: ${tool}`]
    }

    // Validate that destructive operations have confirmation
    if (tool === "write" && params && !params.confirmed) {
      return [false, "Write operations require explicit confirmation"]
    }

    return [true, "Tool call is safe"]
  }

  /**
   * Sanitize user input
   */
  static sanitizeInput(input: string): string {
    // Remove potentially dangerous patterns
    return input
      .replace(/<script[^>]*>.*?<\/script>/gi, "") // Remove scripts
      .replace(/javascript:/gi, "") // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, "") // Remove event handlers
      .trim()
  }

  /**
   * Check if content is appropriate
   */
  static isContentAppropriate(content: string): boolean {
    const [isValid] = this.validateOutput(content)
    return isValid
  }
}
