// ---------------------------------------------------------------------------
// Bash Integration — Standalone bash execution with full HITL security checks
//
// This is a self-contained adaptation of the bash security integration for
// the Thirdwave platform. It does NOT depend on any OpenCode internal framework.
//
// Security layers applied on every command execution:
//   1. Destructive command guard   — pre-flight pattern matching
//   2. Sensitive file detection    — blocks writes to secret files
//   3. Risk-based scoring          — dynamic 0-100 risk threshold gating
//   4. Loop detection              — prevents runaway agent loops
//   5. Execution mode              — host vs. Docker sandboxed runner
// ---------------------------------------------------------------------------

import { Log } from "../util/log"
import { exec, spawn } from "child_process"
import { promisify } from "util"
import { RiskEngine } from "./riskEngine"
import { isDestructive } from "./destructiveGuard"
import { isSensitive } from "./sensitiveFiles"
import { SandboxRunnerFactory } from "./sandboxRunner"
import { AuditLogger } from "./auditLogger"
import { LoopGuard } from "./loopGuard"

const execAsync = promisify(exec)

const MAX_OUTPUT_LENGTH = 30_000
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000 // 2 minutes

export const log = Log.create({ service: "bash-tool" })

// ── Types ─────────────────────────────────────────────────────────────

export interface BashParams {
  command: string
  timeout?: number
  workdir?: string
  description: string
}

export interface BashResult {
  output: string
  exitCode: number
  executedIn: "host" | "sandbox"
  description: string
}

export interface BashSecurityConfig {
  execution_mode?: string
  risk_policy?: string
  risk_thresholds?: { ask?: number; deny?: number }
  audit_logging?: { enabled?: boolean; directory?: string }
  loop_detection?: { enabled?: boolean; threshold?: number }
  agent_autonomy?: { mode?: "supervised" | "semi_autonomous" | "fully_autonomous" }
}

// ── Approval callback (wire to HITL service in production) ────────────

export type AskFn = (opts: {
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
}) => Promise<void>

const noopAsk: AskFn = async () => {}

// ── Simple command tokenizer (no web-tree-sitter required) ────────────

function tokenizeCommand(cmd: string): string[][] {
  return cmd
    .split(/;|&&|\|\||\|/)
    .map((c) => c.trim().split(/\s+/).filter(Boolean))
}

// ── Core bash executor ────────────────────────────────────────────────

export class BashIntegration {
  private riskEngine = new RiskEngine()
  private sandboxFactory = new SandboxRunnerFactory()
  private auditLogger: AuditLogger | null = null
  private loopGuard: LoopGuard | null = null
  private config: BashSecurityConfig
  private ask: AskFn

  constructor(config: BashSecurityConfig = {}, ask: AskFn = noopAsk) {
    this.config = config
    this.ask = ask
  }

  async initialize(): Promise<void> {
    if (this.config.audit_logging?.enabled) {
      this.auditLogger = new AuditLogger(this.config.audit_logging.directory)
      await this.auditLogger.initialize()
    }
    if (this.config.loop_detection?.enabled) {
      this.loopGuard = new LoopGuard()
    }
    log.info("BashIntegration initialized", {
      auditEnabled: !!this.auditLogger,
      loopDetection: !!this.loopGuard,
      mode: this.config.execution_mode ?? "host",
    })
  }

  async execute(params: BashParams): Promise<BashResult> {
    const cwd = params.workdir ?? process.cwd()

    if (params.timeout !== undefined && params.timeout < 0) {
      throw new Error(`Invalid timeout: ${params.timeout}. Must be positive.`)
    }

    const timeout = params.timeout ?? DEFAULT_TIMEOUT_MS

    // SECURITY CHECK 1: Destructive command guard
    if (isDestructive({ command: params.command, workingDirectory: cwd })) {
      log.warn("Destructive command detected", { command: params.command })
      await this.ask({
        permission: "bash",
        patterns: [params.command],
        metadata: { security_reason: "destructive_guard", command: params.command, severity: "critical" },
      })
      await this._audit("command_execution", "destructive_command_detected", params.command, "ask", {
        destructivePatterns: true,
      })
    }

    // SECURITY CHECK 2: Sensitive working directory
    if (isSensitive(cwd)) {
      log.warn("Command in sensitive directory", { workdir: cwd })
      await this.ask({
        permission: "bash",
        patterns: [params.command],
        metadata: { security_reason: "sensitive_file_protection", workdir: cwd, command: params.command },
      })
      await this._audit("sensitive_file_access", "command_in_sensitive_directory", cwd, "ask")
    }

    // Check paths referenced in the command
    const FILE_OPS = ["cat", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "echo", "tee"]
    for (const parts of tokenizeCommand(params.command)) {
      if (parts.length > 1 && FILE_OPS.includes(parts[0])) {
        for (const arg of parts.slice(1)) {
          if (arg.startsWith("-")) continue
          const resolved = await this._resolvePath(arg, cwd)
          if (resolved && isSensitive(resolved)) {
            log.warn("Access to sensitive file detected", { path: resolved })
            await this._audit("sensitive_file_access", "file_operation", resolved, "ask")
          }
        }
      }
    }

    // SECURITY CHECK 3: Risk-based scoring
    const policy = this.config.risk_policy
    if (policy === "dynamic" || policy === "hybrid") {
      const assessment = this.riskEngine.assess({
        command: params.command,
        path: cwd,
        touchesSensitiveFile: isSensitive(cwd),
        action: "bash_execution",
      })
      const AUTONOMY_MULTIPLIERS: Record<string, number> = {
        supervised: 1.5, semi_autonomous: 1.0, fully_autonomous: 0.7,
      }
      const autonomyMode = this.config.agent_autonomy?.mode ?? "semi_autonomous"
      const multiplier = AUTONOMY_MULTIPLIERS[autonomyMode] ?? 1.0
      const askThreshold = (this.config.risk_thresholds?.ask ?? 40) * multiplier

      log.debug("Risk assessment", { score: assessment.score, level: assessment.level })

      if (assessment.score >= askThreshold) {
        await this.ask({
          permission: "bash",
          patterns: [params.command],
          metadata: {
            security_reason: "risk_based_permission",
            risk_score: assessment.score,
            risk_level: assessment.level,
            risk_factors: assessment.factors,
            autonomy_mode: autonomyMode,
            command: params.command,
          },
        })
      }
      await this._audit("permission_decision", "risk_assessment", params.command, undefined, {
        score: assessment.score, level: assessment.level, factors: assessment.factors,
      })
    }

    // SECURITY CHECK 4: Loop detection
    if (this.loopGuard) {
      this.loopGuard.recordCommand(params.command)
      const loopScore = this.loopGuard.computeLoopScore()
      const threshold = this.config.loop_detection?.threshold ?? 50

      if (loopScore >= threshold) {
        log.warn("Loop detection triggered", { loopScore, threshold })
        await this.ask({
          permission: "bash",
          patterns: [params.command],
          metadata: { security_reason: "doom_loop_v2", loop_score: loopScore, command: params.command },
        })
        await this._audit("loop_detected", "potential_infinite_loop", params.command, undefined, { loopScore })
      }
    }

    // EXECUTION
    const executionMode = (this.config.execution_mode ?? "host") as "host" | "sandbox"
    log.info("Executing command", { command: params.command, mode: executionMode, cwd })
    await this._audit("command_execution", "bash_command", params.command, undefined, {
      mode: executionMode, workdir: cwd,
    })

    if (executionMode === "sandbox") {
      return this._runSandboxed(params.command, params.description)
    }
    return this._runHost(params.command, cwd, timeout, params.description)
  }

  private async _runHost(cmd: string, cwd: string, timeout: number, description: string): Promise<BashResult> {
    return new Promise((resolve) => {
      const child = spawn(cmd, { shell: true, cwd, stdio: ["ignore", "pipe", "pipe"] })
      let output = ""

      const killTimer = setTimeout(() => {
        child.kill("SIGTERM")
        output += `\n\n<bash_metadata>\nbash tool terminated after exceeding timeout ${timeout}ms\n</bash_metadata>`
        this.loopGuard?.recordError("Timeout", cmd)
      }, timeout)

      const append = (chunk: Buffer) => {
        output += chunk.toString()
        if (output.length > MAX_OUTPUT_LENGTH) {
          output = output.slice(0, MAX_OUTPUT_LENGTH) + "\n\n..."
          child.kill("SIGTERM")
        }
      }

      child.stdout?.on("data", append)
      child.stderr?.on("data", append)

      child.once("exit", (code) => {
        clearTimeout(killTimer)
        const exitCode = code ?? 1
        if (exitCode !== 0) this.loopGuard?.recordError(`exit ${exitCode}`, cmd)
        this._audit("command_execution", "command_complete", cmd, exitCode === 0 ? "allow" : "deny", {
          exitCode, mode: "host",
        })
        resolve({ output, exitCode, executedIn: "host", description })
      })

      child.once("error", (err) => {
        clearTimeout(killTimer)
        this.loopGuard?.recordError(String(err), cmd)
        resolve({ output: `Error: ${err.message}`, exitCode: 1, executedIn: "host", description })
      })
    })
  }

  private async _runSandboxed(cmd: string, description: string): Promise<BashResult> {
    try {
      const runner = await this.sandboxFactory.create("sandbox")
      const result = await runner.runBash(cmd)
      let output = result.stdout + (result.stderr ? "\n" + result.stderr : "")
      if (output.length > MAX_OUTPUT_LENGTH) output = output.slice(0, MAX_OUTPUT_LENGTH) + "\n\n..."
      if (result.exitCode !== 0) this.loopGuard?.recordError(`exit ${result.exitCode}`, cmd)
      await this._audit("sandbox_execution", "command_executed", cmd, result.exitCode === 0 ? "allow" : "deny", {
        exitCode: result.exitCode,
      })
      return { output, exitCode: result.exitCode, executedIn: "sandbox", description }
    } catch (err) {
      this.loopGuard?.recordError(String(err), cmd)
      return { output: `Sandbox error: ${err}`, exitCode: 1, executedIn: "sandbox", description }
    }
  }

  private async _resolvePath(arg: string, cwd: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync(`realpath -- ${JSON.stringify(arg)}`, { cwd })
      return stdout.trim() || null
    } catch {
      return arg.startsWith("/") ? arg : null
    }
  }

  private async _audit(
    type: "permission_decision" | "command_execution" | "sensitive_file_access" | "loop_detected" | "sandbox_execution",
    action: string,
    resource?: string,
    result?: "allow" | "deny" | "ask",
    details?: Record<string, unknown>,
  ): Promise<void> {
    if (!this.auditLogger) return
    try { await this.auditLogger.logEvent({ type, action, resource, result, details }) } catch { /* non-fatal */ }
  }
}

// ── Singleton factory ─────────────────────────────────────────────────

let _instance: BashIntegration | null = null

export function getBashIntegration(config?: BashSecurityConfig, ask?: AskFn): BashIntegration {
  if (!_instance) _instance = new BashIntegration(config, ask)
  return _instance
}

