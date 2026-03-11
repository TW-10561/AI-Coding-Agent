import z from "zod"
import { spawn } from "child_process"
import { Tool } from "./tool"
import path from "path"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"

import { $ } from "bun"
import { Filesystem } from "@/util/filesystem"
import { fileURLToPath } from "url"
import { Flag } from "@/flag/flag.ts"
import { Shell } from "@/shell/shell"

import { BashArity } from "@/permission/arity"
import { Truncate } from "./truncation"
import { Plugin } from "@/plugin"
import { Config } from "@/config/config"
import { RiskEngine } from "@/permission/riskEngine"
import { isDestructive } from "@/security/destructiveGuard"
import { isSensitive } from "@/security/sensitiveFiles"
import { SandboxRunnerFactory } from "@/sandbox/sandboxRunner"
import { AuditLogger } from "@/audit/auditLogger"
import { LoopGuard } from "@/agent/loopGuard"

const MAX_METADATA_LENGTH = 30_000
const DEFAULT_TIMEOUT = Flag.OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000

export const log = Log.create({ service: "bash-tool" })

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const bashLanguage = await Language.load(bashPath)
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define("bash", async () => {
  const shell = Shell.acceptable()
  log.info("bash tool using shell", { shell })

  // Initialize security systems
  const riskEngine = new RiskEngine()
  const sandboxFactory = new SandboxRunnerFactory()
  let auditLogger: AuditLogger | null = null
  let loopGuard: LoopGuard | null = null

  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES)),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
      workdir: z
        .string()
        .describe(
          `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`,
        )
        .optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
    }),
    async execute(params, ctx) {
      const cwd = params.workdir || Instance.directory
      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }
      const timeout = params.timeout ?? DEFAULT_TIMEOUT

      // Load security configuration
      const config = await Config.state()
      const securityConfig = config.security || {}
      const autonomyConfig = config.agent_autonomy || { mode: "semi_autonomous" }

      // Initialize audit logger if enabled
      if (securityConfig.audit_logging?.enabled && !auditLogger) {
        auditLogger = new AuditLogger(securityConfig.audit_logging?.directory)
        await auditLogger.initialize()
      }

      // Initialize loop guard if enabled
      if (securityConfig.loop_detection?.enabled && !loopGuard) {
        loopGuard = new LoopGuard()
      }

      // SECURITY CHECK 1: Destructive command guard (always checked first)
      if (isDestructive({ command: params.command, workingDirectory: cwd })) {
        log.warn("Destructive command detected, requiring approval", { command: params.command })
        await ctx.ask({
          permission: "bash",
          patterns: [params.command],
          metadata: {
            security_reason: "destructive_guard",
            command: params.command,
            severity: "critical",
          },
        })

        // Audit the destructive command check
        if (auditLogger) {
          await auditLogger.logEvent({
            type: "command_execution",
            action: "destructive_command_detected",
            resource: params.command,
            result: "ask",
            details: { destructivePatterns: true },
          })
        }
      }

      // SECURITY CHECK 2: Sensitive file detection
      if (isSensitive(cwd)) {
        log.warn("Command in sensitive directory detected", { workdir: cwd })
        await ctx.ask({
          permission: "bash",
          patterns: [params.command],
          metadata: {
            security_reason: "sensitive_file_protection",
            workdir: cwd,
            command: params.command,
          },
        })

        if (auditLogger) {
          await auditLogger.logEvent({
            type: "sensitive_file_access",
            action: "command_in_sensitive_directory",
            resource: cwd,
            result: "ask",
          })
        }
      }

      // SECURITY CHECK 3: Risk-based permission system
      if (securityConfig.risk_policy === "dynamic" || securityConfig.risk_policy === "hybrid") {
        const riskContext = {
          command: params.command,
          path: cwd,
          touchesSensitiveFile: isSensitive(cwd),
          action: "bash_execution",
        }

        const assessment = riskEngine.assess(riskContext)
        log.debug("Risk assessment", { command: params.command, score: assessment.score, level: assessment.level })

        // Apply autonomy mode multipliers to thresholds
        const AUTONOMY_MULTIPLIERS = {
          supervised: 1.5,
          semi_autonomous: 1.0,
          fully_autonomous: 0.7,
        }
        const multiplier = AUTONOMY_MULTIPLIERS[autonomyConfig.mode || "semi_autonomous"] || 1.0
        const adjustedAskThreshold = (securityConfig.risk_thresholds?.ask || 40) * multiplier

        if (assessment.score >= adjustedAskThreshold) {
          log.info("Risk score requires approval", {
            score: assessment.score,
            threshold: adjustedAskThreshold,
            factors: assessment.factors,
          })

          await ctx.ask({
            permission: "bash",
            patterns: [params.command],
            metadata: {
              security_reason: "risk_based_permission",
              risk_score: assessment.score,
              risk_level: assessment.level,
              risk_factors: assessment.factors,
              autonomy_mode: autonomyConfig.mode,
              command: params.command,
            },
          })
        }

        if (auditLogger) {
          await auditLogger.logEvent({
            type: "permission_decision",
            action: "risk_assessment",
            resource: params.command,
            riskScore: assessment.score,
            details: { factors: assessment.factors, level: assessment.level },
          })
        }
      }

      // SECURITY CHECK 4: Loop detection
      if (loopGuard) {
        loopGuard.recordCommand(params.command)
        const loopScore = loopGuard.computeLoopScore()
        const loopThreshold = securityConfig.loop_detection?.threshold || 50

        if (loopScore >= loopThreshold) {
          log.warn("Loop detection triggered, requiring approval", { loopScore, threshold: loopThreshold })
          await ctx.ask({
            permission: "bash",
            patterns: [params.command],
            metadata: {
              security_reason: "doom_loop_v2",
              loop_score: loopScore,
              command: params.command,
            },
          })

          if (auditLogger) {
            await auditLogger.logEvent({
              type: "loop_detected",
              action: "potential_infinite_loop",
              resource: params.command,
              riskScore: loopScore,
            })
          }
        }
      }

      // Parse command for permission patterns
      const tree = await parser().then((p) => p.parse(params.command))
      if (!tree) {
        throw new Error("Failed to parse command")
      }
      const directories = new Set<string>()
      if (!Instance.containsPath(cwd)) directories.add(cwd)
      const patterns = new Set<string>()
      const always = new Set<string>()

      for (const node of tree.rootNode.descendantsOfType("command")) {
        if (!node) continue

        // Get full command text including redirects if present
        let commandText = node.parent?.type === "redirected_statement" ? node.parent.text : node.text

        const command = []
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (!child) continue
          if (
            child.type !== "command_name" &&
            child.type !== "word" &&
            child.type !== "string" &&
            child.type !== "raw_string" &&
            child.type !== "concatenation"
          ) {
            continue
          }
          command.push(child.text)
        }

        // not an exhaustive list, but covers most common cases
        if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "cat"].includes(command[0])) {
          for (const arg of command.slice(1)) {
            if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
            const resolved = await $`realpath ${arg}`
              .cwd(cwd)
              .quiet()
              .nothrow()
              .text()
              .then((x) => x.trim())
            log.info("resolved path", { arg, resolved })
            if (resolved) {
              const normalized =
                process.platform === "win32" ? Filesystem.windowsPath(resolved).replace(/\//g, "\\") : resolved
              if (!Instance.containsPath(normalized)) {
                const dir = (await Filesystem.isDir(normalized)) ? normalized : path.dirname(normalized)
                directories.add(dir)

                // Check if accessing sensitive file
                if (isSensitive(dir)) {
                  log.warn("Access to sensitive file detected", { path: normalized })
                  if (auditLogger) {
                    await auditLogger.logEvent({
                      type: "sensitive_file_access",
                      action: "file_operation",
                      resource: normalized,
                      result: "ask",
                    })
                  }
                }
              }
            }
          }
        }

        // cd covered by above check
        if (command.length && command[0] !== "cd") {
          patterns.add(commandText)
          always.add(BashArity.prefix(command).join(" ") + " *")
        }
      }

      if (directories.size > 0) {
        const globs = Array.from(directories).map((dir) => {
          // Preserve POSIX-looking paths with /s, even on Windows
          if (dir.startsWith("/")) return `${dir.replace(/[\\/]+$/, "")}/*`
          return path.join(dir, "*")
        })
        await ctx.ask({
          permission: "external_directory",
          patterns: globs,
          always: globs,
          metadata: {},
        })
      }

      if (patterns.size > 0) {
        await ctx.ask({
          permission: "bash",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: {},
        })
      }

      // Get execution mode and create appropriate runner
      const executionMode = securityConfig.execution_mode || "host"
      const runner = await sandboxFactory.create(executionMode)

      log.info("Executing command", { command: params.command, mode: executionMode, workdir: cwd })

      if (auditLogger) {
        await auditLogger.logEvent({
          type: "command_execution",
          action: "bash_command",
          resource: params.command,
          details: { mode: executionMode, workdir: cwd },
        })
      }

      const shellEnv = await Plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )

      // Execute using appropriate runner (host or sandbox)
      let output = ""
      let proc: any = null
      let exitCode = 0

      if (executionMode === "sandbox") {
        // Use sandboxed execution
        try {
          log.debug("Using sandboxed execution mode")
          const result = await runner.runBash(params.command)
          output = result.stdout + (result.stderr ? "\n" + result.stderr : "")
          exitCode = result.exitCode

          if (auditLogger) {
            await auditLogger.logEvent({
              type: "sandbox_execution",
              action: "command_executed",
              resource: params.command,
              result: exitCode === 0 ? "allow" : "deny",
              details: { exitCode, mode: "sandbox" },
            })
          }
        } catch (error) {
          loopGuard?.recordError(String(error), params.command)
          log.error("Sandbox execution failed", { command: params.command, error })
          output = `Sandbox execution error: ${error}`
          exitCode = 1

          if (auditLogger) {
            await auditLogger.logEvent({
              type: "command_execution",
              action: "sandbox_error",
              resource: params.command,
              result: "deny",
              details: { error: String(error) },
            })
          }
        }
      } else {
        // Use host execution (existing behavior)
        proc = spawn(params.command, {
          shell,
          cwd,
          env: {
            ...process.env,
            ...shellEnv.env,
          },
          stdio: ["ignore", "pipe", "pipe"],
          detached: process.platform !== "win32",
        })

        // Initialize metadata with empty output
        ctx.metadata({
          metadata: {
            output: "",
            description: params.description,
          },
        })

        const append = (chunk: Buffer) => {
          output += chunk.toString()
          ctx.metadata({
            metadata: {
              // truncate the metadata to avoid GIANT blobs of data (has nothing to do w/ what agent can access)
              output:
                output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
              description: params.description,
            },
          })
        }

        proc.stdout?.on("data", append)
        proc.stderr?.on("data", append)

        let timedOut = false
        let aborted = false
        let exited = false

        const kill = () => Shell.killTree(proc, { exited: () => exited })

        if (ctx.abort.aborted) {
          aborted = true
          await kill()
        }

        const abortHandler = () => {
          aborted = true
          void kill()
        }

        ctx.abort.addEventListener("abort", abortHandler, { once: true })

        const timeoutTimer = setTimeout(() => {
          timedOut = true
          void kill()
        }, timeout + 100)

        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timeoutTimer)
            ctx.abort.removeEventListener("abort", abortHandler)
          }

          proc.once("exit", (code: number) => {
            exitCode = code || 0
            exited = true
            cleanup()
            resolve()
          })

          proc.once("error", (error: any) => {
            exited = true
            cleanup()
            reject(error)
          })
        })

        const resultMetadata: string[] = []

        if (timedOut) {
          resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
          loopGuard?.recordError("Timeout", params.command)
        }

        if (aborted) {
          resultMetadata.push("User aborted the command")
        }

        if (resultMetadata.length > 0) {
          output += "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
        }
      }

      return {
        title: params.description,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          exit: exitCode,
          description: params.description,
          execution_mode: executionMode,
        },
        output,
      }
    },
  }
})
