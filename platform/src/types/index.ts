// ---------------------------------------------------------------------------
// Shared type definitions consumed by both backend and SDK
// ---------------------------------------------------------------------------

export interface SessionInfo {
  id: string
  parentID?: string
  title: string
  agentID: string
  createdAt: number
  updatedAt: number
}

export interface MessageInfo {
  id: string
  sessionID: string
  role: "user" | "assistant"
  createdAt: number
}

export interface MessagePart {
  id: string
  type: string
  [key: string]: unknown
}

export interface MessageWithParts {
  info: MessageInfo
  parts: MessagePart[]
}

export interface ProjectInfo {
  id: string
  name: string
  directory: string
  icon?: string
}

export interface ProviderInfo {
  id: string
  name: string
  models: ModelInfo[]
}

export interface ModelInfo {
  id: string
  name: string
  provider: string
  limit?: { context: number; output: number }
}

export interface AgentInfo {
  id: string
  name: string
  description?: string
}

export interface FileNode {
  name: string
  type: "file" | "directory"
  path: string
}

export interface VcsInfo {
  branch: string
}

export interface PromptInput {
  content: string
  agentID?: string
  modelID?: string
  providerID?: string
  attachments?: Array<{
    filename: string
    url: string
    mediaType: string
  }>
}

export interface CommandInput {
  command: string
  args?: Record<string, unknown>
}

export interface ShellInput {
  command: string
  description?: string
}

// ── Platform-specific types (not in OpenCode) ────────────────────────

export interface PlatformUser {
  id: string
  email: string
  name?: string
  apiKey: string
  createdAt: number
}

export interface TaskRun {
  id: string
  userID: string
  sessionID: string
  status: "queued" | "running" | "completed" | "failed" | "aborted"
  prompt: string
  directory: string
  createdAt: number
  completedAt?: number
  error?: string
}

export interface HealthStatus {
  platform: "ok" | "degraded" | "down"
  opencode: "ok" | "unreachable"
  uptime: number
  version: string
}

// ── SSE event envelope ───────────────────────────────────────────────

export interface PlatformEvent<T = unknown> {
  type: string
  properties: T
  timestamp: number
}
