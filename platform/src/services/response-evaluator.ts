/**
 * Self-Evaluation Service for Platform Responses
 * 
 * Automatically evaluates responses from OpenCode/vLLM and provides:
 * - Confidence score (0-1)
 * - Quality metrics
 * - Suggested improvements
 * - Pattern learning
 * - Knowledge persistence
 */

import { readdir, writeFile, readFile, mkdir } from "fs/promises"
import { join } from "path"

export interface EvaluationMetrics {
  timestamp: string
  queryLength: number
  responseLength: number
  completenessScore: number // 0-1 based on response length relative to query
  coherenceScore: number // 0-1 based on structure
  relevanceScore: number // 0-1 estimated
  confidenceScore: number // overall: 0-1
  quality: "low" | "medium" | "high"
  hasConcerns: boolean
  concerns: string[]
  suggestedImprovements: string[]
  toolsUsed: string[]
  errorPatternsDetected: string[]
  learned: boolean
}

export interface EvaluationResult {
  query: string
  response: string
  evaluation: EvaluationMetrics
  metadata: {
    agentID?: string
    modelID?: string
    duration?: number
  }
}

export class ResponseEvaluator {
  private storePath: string
  private patterns: Map<string, number> = new Map()
  private successHistory: EvaluationMetrics[] = []
  private storageReady: boolean = false

  constructor(storagePath: string = "/tmp/platform-evaluations") {
    this.storePath = storagePath
    // Initialize storage asynchronously without blocking
    this.initStorage().catch(e => {
      console.warn("[ResponseEvaluator] Could not initialize storage:", e)
    })
  }

  private async initStorage() {
    try {
      await mkdir(this.storePath, { recursive: true })
      await this.loadPatterns()
      this.storageReady = true
    } catch (e) {
      console.warn("[ResponseEvaluator] Could not initialize storage:", e)
      this.storageReady = false
    }
  }

  /**
   * Main evaluation method - called after response is generated
   */
  async evaluate(
    query: string,
    response: string,
    metadata?: { agentID?: string; modelID?: string; duration?: number }
  ): Promise<EvaluationResult> {
    const concerns = this.identifyConcerns(query, response)
    const improvements = this.suggestImprovements(response, concerns)
    const tools = this.extractToolsUsed(response)
    const errorPatterns = this.detectErrorPatterns(response)

    const evaluation: EvaluationMetrics = {
      timestamp: new Date().toISOString(),
      queryLength: query.length,
      responseLength: response.length,
      completenessScore: this.calculateCompleteness(query, response),
      coherenceScore: this.calculateCoherence(response),
      relevanceScore: this.estimateRelevance(query, response),
      confidenceScore: 0, // Will be calculated below
      quality: "medium",
      hasConcerns: concerns.length > 0,
      concerns,
      suggestedImprovements: improvements,
      toolsUsed: tools,
      errorPatternsDetected: errorPatterns,
      learned: false,
    }

    // Calculate overall confidence
    evaluation.confidenceScore =
      evaluation.completenessScore * 0.4 +
      evaluation.coherenceScore * 0.3 +
      evaluation.relevanceScore * 0.3

    // Determine quality level
    if (evaluation.confidenceScore > 0.8) evaluation.quality = "high"
    else if (evaluation.confidenceScore > 0.6) evaluation.quality = "medium"
    else evaluation.quality = "low"

    // Learn from this response
    await this.learnFromResponse(query, response, evaluation)

    this.successHistory.push(evaluation)

    return {
      query,
      response,
      evaluation,
      metadata: metadata || {},
    }
  }

  /**
   * Calculate completeness score based on query vs response length
   */
  private calculateCompleteness(query: string, response: string): number {
    const minRatio = response.length / Math.max(query.length, 50)
    const ratio = Math.min(minRatio / 5, 1) // Normalize to 0-1 where 5x is "complete"
    return Math.max(0.3, ratio) // Minimum 0.3 for any response
  }

  /**
   * Estimate coherence based on structure indicators
   */
  private calculateCoherence(response: string): number {
    let score = 0.6 // Base score

    // Check for structured sections
    if (
      response.includes("\n\n") ||
      response.includes("##") ||
      response.includes("===")
    )
      score += 0.2
    if (
      response.includes("```") ||
      response.includes("import ") ||
      response.includes("function ")
    )
      score += 0.1

    // Check for coherence indicators
    const sentences = response.split(/[.!?]+/).filter((s) => s.trim().length > 20)
    if (sentences.length > 3) score += 0.1

    return Math.min(score, 1)
  }

  /**
   * Estimate relevance (basic heuristics)
   */
  private estimateRelevance(query: string, response: string): number {
    const queryWords = query.toLowerCase().split(/\s+/)
    const responseWords = response.toLowerCase().split(/\s+/)

    let matches = 0
    for (const word of queryWords) {
      if (
        word.length > 3 &&
        responseWords.some((rw) => rw.includes(word) || word.includes(rw))
      ) {
        matches++
      }
    }

    const relevance = matches / Math.max(queryWords.length, 1)
    return Math.min(relevance, 1)
  }

  /**
   * Identify potential concerns in response
   */
  private identifyConcerns(query: string, response: string): string[] {
    const concerns: string[] = []

    // Check for common issues
    if (response.length < 50)
      concerns.push("Response seems very brief for this query")
    if (
      response.includes("I don't know") ||
      response.includes("I'm not sure")
    )
      concerns.push("Response contains uncertainty markers")
    if (
      response.includes("ERROR") ||
      response.includes("error") ||
      response.includes("undefined")
    )
      concerns.push("Response may contain error indicators")
    if (response.includes("TODO") || response.includes("FIXME"))
      concerns.push("Response contains TODO/FIXME markers")

    // Check for completeness
    if (query.toLowerCase().includes("list") && !response.includes("- ")) {
      concerns.push("Query asks for list but response may not be formatted as one")
    }

    return concerns
  }

  /**
   * Suggest improvements based on concerns
   */
  private suggestImprovements(response: string, concerns: string[]): string[] {
    const suggestions: string[] = []

    if (response.length < 100)
      suggestions.push("Consider providing more detailed explanation")
    if (!response.includes("```") && response.toLowerCase().includes("code"))
      suggestions.push("Consider adding code examples for clarity")
    if (!response.includes("-") && !response.includes("•"))
      suggestions.push("Consider formatting with bullet points for readability")

    if (concerns.some((c) => c.includes("brief")))
      suggestions.push("Expand with concrete examples or steps")
    if (concerns.some((c) => c.includes("uncertainty")))
      suggestions.push("Be more definitive or clearly state limitations")

    return suggestions
  }

  /**
   * Extract tools/functions mentioned in response
   */
  private extractToolsUsed(response: string): string[] {
    const tools: string[] = []
    const patterns = [
      /\b(read|write|execute|analyze|optimize|create|delete|update)\b/gi,
      /\b(query|search|find|filter|sort|map|reduce|transform)\b/gi,
      /function\s+(\w+)/gi,
      /import\s+.*\sfrom\s+['"]([^'"]+)['"]/gi,
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(response)) !== null) {
        if (match[1]) tools.push(match[1])
      }
    }

    return [...new Set(tools)] // Deduplicate
  }

  /**
   * Detect error patterns
   */
  private detectErrorPatterns(response: string): string[] {
    const patterns: string[] = []

    if (/undefined|null|nan/i.test(response))
      patterns.push("Potential undefined/null references")
    if (/throw|error|exception/i.test(response) && response.length < 200)
      patterns.push("May be error response")
    if (/syntax|parse|invalid/i.test(response))
      patterns.push("May indicate syntax errors")

    return patterns
  }

  /**
   * Learn from responses - update pattern weights
   */
  private async learnFromResponse(
    _query: string,
    response: string,
    metrics: EvaluationMetrics
  ) {
    // Extract keywords and update weights
    const keywords = response
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 10)

    for (const keyword of keywords) {
      const current = this.patterns.get(keyword) || 0
      this.patterns.set(keyword, current + metrics.confidenceScore)
    }

    // Track success patterns
    if (metrics.confidenceScore > 0.7) {
      if (metrics.quality === "high") {
        const pattern = `high_quality_${metrics.toolsUsed.join("_")}`
        this.patterns.set(pattern, (this.patterns.get(pattern) || 0) + 1)
      }
    }

    metrics.learned = true

    // Persist patterns
    await this.savePatterns()
  }

  /**
   * Load learned patterns from storage
   */
  private async loadPatterns() {
    try {
      const filePath = join(this.storePath, "patterns.json")
      const data = await readFile(filePath, "utf-8")
      const loaded = JSON.parse(data) as Record<string, number>
      this.patterns = new Map(Object.entries(loaded))
    } catch {
      // File doesn't exist or is invalid, start fresh
    }
  }

  /**
   * Save learned patterns to storage
   */
  private async savePatterns() {
    try {
      const filePath = join(this.storePath, "patterns.json")
      const data = Object.fromEntries(this.patterns)
      await writeFile(filePath, JSON.stringify(data, null, 2))
    } catch (e) {
      console.warn("[ResponseEvaluator] Could not save patterns:", e)
    }
  }

  /**
   * Get evaluation summary
   */
  getStats() {
    if (this.successHistory.length === 0) {
      return {
        totalEvaluations: 0,
        averageConfidence: 0,
        highQualityCount: 0,
        learnedPatterns: 0,
      }
    }

    const avgConfidence =
      this.successHistory.reduce((sum, m) => sum + m.confidenceScore, 0) /
      this.successHistory.length
    const highQuality = this.successHistory.filter(
      (m) => m.quality === "high"
    ).length

    return {
      totalEvaluations: this.successHistory.length,
      averageConfidence: parseFloat(avgConfidence.toFixed(3)),
      highQualityCount: highQuality,
      learnedPatterns: this.patterns.size,
    }
  }

  /**
   * Format evaluation for display
   */
  formatForDisplay(result: EvaluationResult): string {
    const e = result.evaluation
    const confidence = Math.round(e.confidenceScore * 100)

    let output = `
╔════════════════════════════════════════════════════════════════╗
║                    🤖 SELF-EVALUATION REPORT                  ║
╚════════════════════════════════════════════════════════════════╝

📊 Metrics:
  • Confidence:            ${confidence}%
  • Quality Level:         ${e.quality.toUpperCase()}
  • Completeness:          ${Math.round(e.completenessScore * 100)}%
  • Coherence:             ${Math.round(e.coherenceScore * 100)}%
  • Relevance:             ${Math.round(e.relevanceScore * 100)}%

📝 Response Stats:
  • Query Length:          ${e.queryLength} chars
  • Response Length:       ${e.responseLength} chars
  • Tools Used:            ${e.toolsUsed.length > 0 ? e.toolsUsed.join(", ") : "None"}

${e.concerns.length > 0 ? `⚠️  Concerns:\n${e.concerns.map((c) => `  • ${c}`).join("\n")}\n` : ""}${e.errorPatternsDetected.length > 0 ? `🔴 Error Patterns:\n${e.errorPatternsDetected.map((p) => `  • ${p}`).join("\n")}\n` : ""}${e.suggestedImprovements.length > 0 ? `💡 Improvements:\n${e.suggestedImprovements.map((s) => `  • ${s}`).join("\n")}\n` : ""}✅ Status:
  • Learned:               ${e.learned ? "Yes" : "No"}
  • Timestamp:             ${e.timestamp}

╚════════════════════════════════════════════════════════════════╝
`

    return output
  }
}

// Singleton instance
let evaluator: ResponseEvaluator | null = null

export function getEvaluator(): ResponseEvaluator {
  if (!evaluator) {
    evaluator = new ResponseEvaluator()
  }
  return evaluator
}
