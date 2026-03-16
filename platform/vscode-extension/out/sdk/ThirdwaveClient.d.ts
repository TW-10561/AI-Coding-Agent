export interface ThirdwaveClientOptions {
    baseUrl: string;
    apiKey?: string;
}
export interface SessionInfo {
    id: string;
    parentID?: string;
    title: string;
    agentID: string;
    createdAt: number;
    updatedAt: number;
}
export interface MessagePart {
    id: string;
    type: string;
    [key: string]: unknown;
}
export interface MessageWithParts {
    info: {
        id: string;
        sessionID: string;
        role: "user" | "assistant";
        createdAt: number;
    };
    parts: MessagePart[];
}
export interface DirectChatRequest {
    message: string;
    modelID?: string;
    providerID?: string;
    system?: string;
    maxTokens?: number;
    temperature?: number;
    history?: Array<{
        role: "user" | "assistant";
        content: string;
    }>;
    tools?: boolean;
    maxToolRounds?: number;
}
export interface DirectChatResponse {
    text: string;
    reasoning?: string;
    model: string;
    provider: string;
    tokens: {
        input: number;
        output: number;
    };
    latencyMs: number;
    toolCalls?: Array<{
        tool: string;
        args: Record<string, unknown>;
        result: string;
        success: boolean;
    }>;
}
export interface RegistryResponse {
    local: Array<{
        id: string;
        name: string;
        endpoint: string;
        status: "online" | "offline" | "unknown";
        latencyMs?: number;
        models: Array<{
            id: string;
            name: string;
            contextLimit: number;
            outputLimit: number;
        }>;
        isPrimary: boolean;
    }>;
    cloud: Array<{
        id: string;
        name: string;
        apiUrl: string;
        docUrl: string;
        keyEnvVar: string;
        configured: boolean;
        models: Array<{
            id: string;
            name: string;
            contextLimit: number;
            outputLimit: number;
            costIn: number;
            costOut: number;
        }>;
    }>;
    activeModel: string;
    generatedAt: string;
}
export interface HealthStatus {
    platform: "ok" | "degraded" | "down";
    opencode: "ok" | "unreachable";
    uptime: number;
    version: string;
}
export declare class ThirdwaveClient {
    private base;
    private headers;
    constructor(opts: ThirdwaveClientOptions);
    private url;
    private request;
    health(): Promise<HealthStatus>;
    listSessions(opts?: {
        limit?: number;
    }): Promise<SessionInfo[]>;
    createSession(opts?: {
        parentID?: string;
        title?: string;
        agentID?: string;
    }): Promise<SessionInfo>;
    deleteSession(id: string): Promise<void>;
    listMessages(sessionID: string, opts?: {
        limit?: number;
    }): Promise<MessageWithParts[]>;
    directChat(opts: DirectChatRequest): Promise<DirectChatResponse>;
    /**
     * Stream chat via SSE — returns an async iterator of text chunks.
     * Falls back to non-streaming direct chat on error.
     */
    chatStream(opts: {
        message: string;
        model?: string;
        agent?: string;
        maxTokens?: number;
        temperature?: number;
        history?: Array<{
            role: string;
            content: string;
        }>;
    }): Promise<AsyncIterable<string>>;
    chatModels(): Promise<{
        models: Array<{
            id: string;
            name: string;
            provider: string;
            providerName: string;
            source: "local" | "cloud";
            contextLimit: number;
            outputLimit: number;
        }>;
        activeModel: string;
    }>;
    registry(refresh?: boolean): Promise<RegistryResponse>;
    refreshRegistry(): Promise<{
        ok: boolean;
        probed: number;
        generatedAt: string;
    }>;
    queryAudit(opts?: {
        action?: string;
        limit?: number;
        offset?: number;
    }): Promise<unknown[]>;
    auditStats(): Promise<unknown>;
    budgetSummary(userID?: string): Promise<unknown>;
    policyStatus(): Promise<unknown>;
    listSkills(): Promise<Array<{
        id: string;
        name: string;
        displayName: string;
        description: string;
        category?: string;
    }>>;
    getSkill(id: string): Promise<{
        id: string;
        name: string;
        displayName: string;
        description: string;
        content: string;
        category?: string;
    }>;
    searchSkills(query: string): Promise<Array<{
        skill: {
            id: string;
            name: string;
            displayName: string;
            description: string;
            content: string;
        };
        relevance: number;
    }>>;
    skillCategories(): Promise<Record<string, Array<{
        id: string;
        name: string;
        displayName: string;
        description: string;
    }>>>;
}
