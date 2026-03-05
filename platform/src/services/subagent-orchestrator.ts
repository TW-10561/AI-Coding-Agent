// ---------------------------------------------------------------------------
// Subagent Orchestrator — manages multiple AI agent sessions working together.
// ---------------------------------------------------------------------------
// A subagent is an OpenCode session running with a specific agent role
// (e.g. "code", "build", "plan"). The orchestrator:
//  - Spawns child sessions under a parent plan
//  - Routes subtasks to appropriate agents
//  - Collects results and feeds them back to the coordinator
//  - Handles failures, retries, and cancellation
//  - Tracks dependency graphs between subtasks
// ---------------------------------------------------------------------------

import { ulid } from "ulid"
import { OpenCodeClient } from "./opencode-client"
import type { AuditLogger } from "./audit-logger"

export type SubagentStatus = "pending" | "running" | "completed" | "failed" | "cancelled"

export interface SubagentTask {
  id: string
  parentID?: string          // parent orchestration ID
  orchestrationID: string    // which orchestration this belongs to
  agentID: string            // OpenCode agent to use: "code", "build", "plan", etc.
  prompt: string
  sessionID?: string         // OpenCode session ID once created
  status: SubagentStatus
  result?: string            // final response text
  error?: string
  dependsOn: string[]        // task IDs that must complete first
  createdAt: number
  startedAt?: number
  completedAt?: number
  retries: number
  maxRetries: number
}

export interface Orchestration {
  id: string
  name: string
  userID: string
  workspaceID?: string
  coordinatorSessionID?: string  // the "plan" agent session
  status: SubagentStatus
  tasks: SubagentTask[]
  createdAt: number
  completedAt?: number
  error?: string
}

export interface OrchestrationPlan {
  name: string
  userID: string
  workspaceID?: string
  tasks: Array<{
    agentID: string
    prompt: string
    dependsOn?: string[]   // task IDs (use temp IDs like "t1", "t2")
    maxRetries?: number
  }>
}

type OrchestrationCallback = (orch: Orchestration) => void

export class SubagentOrchestrator {
  private orchestrations = new Map<string, Orchestration>()
  private client: OpenCodeClient
  private audit?: AuditLogger
  private maxConcurrentPerOrch: number
  private listeners = new Set<OrchestrationCallback>()

  constructor(opts: { client: OpenCodeClient; audit?: AuditLogger; maxConcurrentPerOrch?: number }) {
    this.client = opts.client
    this.audit = opts.audit
    this.maxConcurrentPerOrch = opts.maxConcurrentPerOrch ?? 3
  }

  /** Create and start an orchestration from a plan */
  async start(plan: OrchestrationPlan): Promise<Orchestration> {
    const orchID = ulid()

    // Map temp IDs to real IDs
    const idMap = new Map<string, string>()
    const tasks: SubagentTask[] = plan.tasks.map((t, i) => {
      const tempID = `t${i + 1}`
      const realID = ulid()
      idMap.set(tempID, realID)
      return {
        id: realID,
        orchestrationID: orchID,
        agentID: t.agentID,
        prompt: t.prompt,
        status: "pending" as SubagentStatus,
        dependsOn: [], // filled below
        createdAt: Date.now(),
        retries: 0,
        maxRetries: t.maxRetries ?? 2,
      }
    })

    // Resolve dependency references
    plan.tasks.forEach((t, i) => {
      if (t.dependsOn) {
        tasks[i].dependsOn = t.dependsOn.map(dep => idMap.get(dep) ?? dep)
      }
    })

    const orch: Orchestration = {
      id: orchID,
      name: plan.name,
      userID: plan.userID,
      workspaceID: plan.workspaceID,
      status: "running",
      tasks,
      createdAt: Date.now(),
    }

    this.orchestrations.set(orchID, orch)
    this.audit?.log({
      action: "subagent.spawn",
      userID: plan.userID,
      workspaceID: plan.workspaceID,
      metadata: { orchestrationID: orchID, taskCount: tasks.length },
      success: true,
    })

    this.emit(orch)
    this.tick(orchID)
    return orch
  }

  /** Get an orchestration by ID */
  get(id: string): Orchestration | undefined {
    return this.orchestrations.get(id)
  }

  /** List all orchestrations */
  list(opts?: { userID?: string; status?: SubagentStatus }): Orchestration[] {
    let result = [...this.orchestrations.values()]
    if (opts?.userID) result = result.filter(o => o.userID === opts.userID)
    if (opts?.status) result = result.filter(o => o.status === opts.status)
    return result.sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Cancel an orchestration and all pending/running tasks */
  async cancel(id: string): Promise<boolean> {
    const orch = this.orchestrations.get(id)
    if (!orch) return false
    if (orch.status !== "running") return false

    for (const task of orch.tasks) {
      if (task.status === "pending") {
        task.status = "cancelled"
      } else if (task.status === "running" && task.sessionID) {
        try {
          await this.client.abortSession(task.sessionID)
        } catch {}
        task.status = "cancelled"
        task.completedAt = Date.now()
      }
    }

    orch.status = "cancelled"
    orch.completedAt = Date.now()
    this.emit(orch)
    return true
  }

  /** Subscribe to orchestration updates */
  onUpdate(cb: OrchestrationCallback): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  // ── Internal scheduling ─────────────────────────────────────────

  private async tick(orchID: string) {
    const orch = this.orchestrations.get(orchID)
    if (!orch || orch.status !== "running") return

    const running = orch.tasks.filter(t => t.status === "running").length
    const ready = orch.tasks.filter(t => this.isReady(t, orch))

    const toStart = ready.slice(0, this.maxConcurrentPerOrch - running)
    for (const task of toStart) {
      this.executeTask(orch, task)
    }

    // Check if all done
    const allDone = orch.tasks.every(t => ["completed", "failed", "cancelled"].includes(t.status))
    if (allDone) {
      const anyFailed = orch.tasks.some(t => t.status === "failed")
      orch.status = anyFailed ? "failed" : "completed"
      orch.completedAt = Date.now()

      this.audit?.log({
        action: anyFailed ? "subagent.fail" : "subagent.complete",
        userID: orch.userID,
        workspaceID: orch.workspaceID,
        metadata: {
          orchestrationID: orch.id,
          completed: orch.tasks.filter(t => t.status === "completed").length,
          failed: orch.tasks.filter(t => t.status === "failed").length,
        },
        success: !anyFailed,
      })

      this.emit(orch)
    }
  }

  private isReady(task: SubagentTask, orch: Orchestration): boolean {
    if (task.status !== "pending") return false
    if (task.dependsOn.length === 0) return true
    return task.dependsOn.every(depID => {
      const dep = orch.tasks.find(t => t.id === depID)
      return dep?.status === "completed"
    })
  }

  private async executeTask(orch: Orchestration, task: SubagentTask) {
    task.status = "running"
    task.startedAt = Date.now()
    this.emit(orch)

    try {
      // Create a session for this subtask
      const session = await this.client.createSession({ agentID: task.agentID })
      task.sessionID = session.id

      // Build context from completed dependencies
      let contextPrefix = ""
      if (task.dependsOn.length > 0) {
        const depResults = task.dependsOn
          .map(id => orch.tasks.find(t => t.id === id))
          .filter(t => t?.result)
          .map(t => `[Result from ${t!.agentID}]: ${t!.result!.slice(0, 2000)}`)
        if (depResults.length > 0) {
          contextPrefix = `Context from previous steps:\n${depResults.join("\n")}\n\n`
        }
      }

      // Send prompt
      const response = await this.client.prompt(session.id, {
        content: contextPrefix + task.prompt,
      })

      // Extract text from response
      let text = ""
      const parts = response.parts ?? (response as any).message?.parts ?? []
      for (const part of parts) {
        if (part.type === "text" && part.text) {
          text += part.text
        }
      }

      task.result = text
      task.status = "completed"
      task.completedAt = Date.now()
    } catch (err) {
      task.retries++
      if (task.retries < task.maxRetries) {
        task.status = "pending"
        task.startedAt = undefined
        console.warn(`[orchestrator] Task ${task.id} failed (retry ${task.retries}/${task.maxRetries}): ${err}`)
      } else {
        task.status = "failed"
        task.completedAt = Date.now()
        task.error = err instanceof Error ? err.message : String(err)
      }
    }

    this.emit(orch)
    this.tick(orch.id) // Schedule next tasks
  }

  private emit(orch: Orchestration) {
    for (const cb of this.listeners) cb(orch)
  }
}
