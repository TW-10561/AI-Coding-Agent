import { execa } from "execa"
import { Log } from "../../util/log"
import path from "path"
import os from "os"
import z from "zod"

const log = Log.create({ service: "sandbox" })

/**
 * Execution modes for command execution
 * - host: Execute directly on host (existing behavior)
 * - sandbox: Execute in isolated Docker container
 */
export type ExecutionMode = "host" | "sandbox"

/**
 * Result of command execution
 */
export const ExecutionResult = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number(),
  command: z.string(),
  executedIn: z.enum(["host", "sandbox"]),
})
export type ExecutionResult = z.infer<typeof ExecutionResult>

/**
 * Abstract interface for command execution
 */
export interface SandboxRunner {
  /**
   * Execute bash command with guaranteed isolation level
   */
  runBash(cmd: string): Promise<ExecutionResult>

  /**
   * Get the execution mode
   */
  getMode(): ExecutionMode
}

/**
 * Host runner - executes directly on the host system
 * Uses existing behavior for backward compatibility
 */
export class HostRunner implements SandboxRunner {
  async runBash(cmd: string): Promise<ExecutionResult> {
    try {
      const result = await execa(cmd, { shell: true, reject: false })
      return {
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        exitCode: result.exitCode ?? 0,
        command: cmd,
        executedIn: "host",
      }
    } catch (error) {
      log.error("Host runner error", { command: cmd, error })
      throw error
    }
  }

  getMode(): ExecutionMode {
    return "host"
  }
}

/**
 * Docker sandbox runner - executes in isolated, limited container
 * - No network access (--network=none)
 * - Limited memory (512MB default, configurable)
 * - Limited CPU (1 core default, configurable)
 * - Read-only mount of workspace
 */
export class DockerRunner implements SandboxRunner {
  private memoryLimit: string = "512m"
  private cpuLimit: string = "1"
  private imageTag: string = "node:20-alpine"

  constructor(options?: { memoryLimit?: string; cpuLimit?: string; imageTag?: string }) {
    if (options?.memoryLimit) this.memoryLimit = options.memoryLimit
    if (options?.cpuLimit) this.cpuLimit = options.cpuLimit
    if (options?.imageTag) this.imageTag = options.imageTag
  }

  async runBash(cmd: string): Promise<ExecutionResult> {
    const workspaceDir = process.cwd()

    const dockerArgs = [
      "run",
      "--rm",
      "--network=none", // No network access
      `--memory=${this.memoryLimit}`,
      `--cpus=${this.cpuLimit}`,
      "-v",
      `${workspaceDir}:/workspace:ro`, // Read-only mount
      "-w",
      "/workspace",
      this.imageTag,
      "sh",
      "-c",
      cmd,
    ]

    try {
      log.debug("Running command in sandbox", { command: cmd, dockerArgs })
      const result = await execa("docker", dockerArgs, { reject: false })

      return {
        stdout: result.stdout || "",
        stderr: result.stderr || "",
        exitCode: result.exitCode ?? 0,
        command: cmd,
        executedIn: "sandbox",
      }
    } catch (error) {
      log.error("Docker sandbox error", { command: cmd, error })
      throw error
    }
  }

  getMode(): ExecutionMode {
    return "sandbox"
  }

  /**
   * Check if Docker is available
   */
  static async isAvailable(): Promise<boolean> {
    try {
      await execa("docker", ["--version"])
      return true
    } catch {
      return false
    }
  }
}

/**
 * Runner factory - creates appropriate runner based on execution mode
 */
export class SandboxRunnerFactory {
  private dockerRunner: DockerRunner | null = null
  private hostRunner: HostRunner | null = null
  private modeCache: ExecutionMode | null = null

  private async getDockerRunner(): Promise<DockerRunner> {
    if (!this.dockerRunner) {
      const available = await DockerRunner.isAvailable()
      if (!available) {
        log.warn("Docker not available, falling back to host runner")
        return new DockerRunner() // Will fail at runtime if needed
      }
      this.dockerRunner = new DockerRunner()
    }
    return this.dockerRunner
  }

  private getHostRunner(): HostRunner {
    if (!this.hostRunner) {
      this.hostRunner = new HostRunner()
    }
    return this.hostRunner
  }

  async create(mode: ExecutionMode): Promise<SandboxRunner> {
    if (mode === "sandbox") {
      return this.getDockerRunner()
    }
    return this.getHostRunner()
  }
}

export const defaultFactory = new SandboxRunnerFactory()