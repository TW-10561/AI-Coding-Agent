// ---------------------------------------------------------------------------
// OpenCode process manager — spawns and supervises the self-hosted OpenCode
// server as a child process of the platform.
// ---------------------------------------------------------------------------

import { env, findFreePort, isPortFree } from "../config/env"
import { OpenCodeClient } from "./opencode-client"

export class OpenCodeProcess {
  private proc: ReturnType<typeof Bun.spawn> | undefined
  private _url: string | undefined
  private _ready = false

  get url() {
    return this._url ?? env.OPENCODE_URL
  }
  get ready() {
    return this._ready
  }

  /**
   * Start the OpenCode server if not already running.
   * Waits until it prints its listen line, then marks ready.
   */
  async start(opts?: {
    port?: number
    hostname?: string
    directory?: string
    config?: Record<string, unknown>
  }): Promise<string> {
    if (this._ready) return this.url

    let port = Number(opts?.port ?? new URL(env.OPENCODE_URL).port ?? "4096")
    const hostname = opts?.hostname ?? "127.0.0.1"
    const dir = opts?.directory ?? env.OPENCODE_DIR

    // ── Pre-check: is the port already in use? ──────────────────
    if (!isPortFree(port, hostname)) {
      if (env.AUTO_PORT) {
        // Auto-find a free port starting from the default
        const freePort = findFreePort(port, hostname, 20)
        console.log(`[opencode-process] Port ${port} busy — auto-switching to ${freePort}`)
        port = freePort
        // Update env so platform client / index.ts uses the correct URL
        const newUrl = `http://${hostname}:${port}`
        ;(env as any).OPENCODE_URL = newUrl
      } else {
        throw new Error(
          `Port ${port} is already in use. Another Thirdwave instance may be running.\n` +
          `  Option 1: THIRDWAVE_PORT_OFFSET=10 bun run start   (shift all ports)\n` +
          `  Option 2: AUTO_PORT=true bun run start            (auto-find free ports)\n` +
          `  Option 3: lsof -i :${port}  →  kill <PID>`
        )
      }
    }

    const envVars: Record<string, string> = {
      ...process.env as Record<string, string>,
      HOME: process.env.HOME ?? "/root",
    }

    // Forward server auth
    if (env.OPENCODE_SERVER_USERNAME) envVars.OPENCODE_SERVER_USERNAME = env.OPENCODE_SERVER_USERNAME
    if (env.OPENCODE_SERVER_PASSWORD) envVars.OPENCODE_SERVER_PASSWORD = env.OPENCODE_SERVER_PASSWORD

    // Inject vLLM config so OpenCode uses the local LLM
    const opencodeConfig = opts?.config ?? buildVllmConfig()
    envVars.OPENCODE_CONFIG_CONTENT = JSON.stringify(opencodeConfig)

    const args = [
      env.OPENCODE_BIN,
      "serve",
      `--port=${port}`,
      `--hostname=${hostname}`,
    ]

    console.log(`[opencode-process] starting: ${args.join(" ")}`)

    this.proc = Bun.spawn(args, {
      cwd: dir,
      env: envVars,
      stdout: "pipe",
      stderr: "pipe",
    })

    // Wait for the server to print its listen URL (max 30 s)
    const url = await this.waitForReady(30_000)
    this._url = url
    this._ready = true
    console.log(`[opencode-process] ready at ${url}`)

    // Keep draining stderr in background
    this.drainStderr()

    return url
  }

  /**
   * Gracefully stop the OpenCode server.
   */
  async stop() {
    if (!this.proc) return
    console.log("[opencode-process] stopping")
    try {
      // Try graceful dispose first
      const client = new OpenCodeClient({ url: this.url })
      await client.dispose().catch(() => {})
    } catch {}
    this.proc.kill("SIGTERM")
    await this.proc.exited
    this._ready = false
    this.proc = undefined
    console.log("[opencode-process] stopped")
  }

  // ── Internal helpers ─────────────────────────────────────────────

  private async waitForReady(timeout: number): Promise<string> {
    if (!this.proc?.stdout) throw new Error("No stdout on child process")

    const stdout = this.proc.stdout
    if (typeof stdout === "number") throw new Error("stdout is a file descriptor, not a stream")

    const decoder = new TextDecoder()
    let buffer = ""
    const reader = stdout.getReader()
    const deadline = Date.now() + timeout

    // Detect early process exit (e.g. port conflict): the exited promise
    // resolves with the exit code when the process dies.
    let earlyExit = false
    let earlyExitCode: number | null = null
    this.proc.exited.then((code) => {
      earlyExit = true
      earlyExitCode = code ?? null
    }).catch(() => {})

    try {
      while (Date.now() < deadline) {
        // If the process already exited, don't keep waiting for stdout
        if (earlyExit && earlyExitCode !== 0) {
          throw new Error(`OpenCode process exited with code ${earlyExitCode} (port conflict?). Output: ${buffer.trim()}`)
        }

        const remaining = Math.max(200, deadline - Date.now())
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise<{ value: undefined; done: true }>((resolve) =>
            setTimeout(() => resolve({ value: undefined, done: true }), remaining),
          ),
        ])

        if (done && !value) {
          // Timeout tick or stream ended — keep looping unless deadline passed
          continue
        }
        if (value) {
          buffer += decoder.decode(value, { stream: true })
          // OpenCode prints: "opencode server listening on http://..."
          const match = buffer.match(/listening on (https?:\/\/\S+)/)
          if (match) {
            reader.releaseLock()
            return match[1]
          }
        }
      }
    } catch (e: any) {
      reader.releaseLock()
      throw e
    }

    reader.releaseLock()
    throw new Error(`OpenCode server did not become ready within ${timeout}ms.\nOutput: ${buffer.trim()}`)
  }

  private async drainStderr() {
    if (!this.proc?.stderr) return
    const stderr = this.proc.stderr
    if (typeof stderr === "number") return
    const decoder = new TextDecoder()
    const reader = stderr.getReader()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) {
          const text = decoder.decode(value, { stream: true })
          if (env.LOG_LEVEL === "debug") {
            process.stderr.write(`[opencode] ${text}`)
          }
        }
      }
    } catch {}
  }
}

/**
 * Build an OpenCode config object that points to the local vLLM server.
 * Reads connection details from platform env vars.
 */
function buildVllmConfig(): Record<string, unknown> {
  const modelKey = env.VLLM_MODEL_NAME.replace(/\s+/g, "-")
  // Prefer gateway URL over direct vLLM URL
  const baseURL = env.VLLM_GATEWAY_URL ?? env.VLLM_BASE_URL ?? "http://localhost:8000/v1"
  const apiKey = env.VLLM_GATEWAY_KEY ?? env.VLLM_API_KEY ?? ""
  return {
    "$schema": "https://opencode.ai/config.json",
    provider: {
      vllm: {
        name: "vLLM",
        npm: "@ai-sdk/openai-compatible",
        env: [],
        options: {
          baseURL,
          apiKey,
        },
        models: {
          [modelKey]: {
            id: env.VLLM_MODEL_ID,
            name: env.VLLM_MODEL_NAME,
            tool_call: true,
            cost: { input: 0, output: 0 },
            limit: {
              context: env.VLLM_CONTEXT_LIMIT,
              output: env.VLLM_OUTPUT_LIMIT,
            },
          },
        },
      },
    },
    model: `vllm/${modelKey}`,
    enabled_providers: ["vllm"],
  }
}

/** Singleton process manager */
export const opencode = new OpenCodeProcess()
