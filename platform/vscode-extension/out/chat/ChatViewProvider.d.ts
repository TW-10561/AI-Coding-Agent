import * as vscode from "vscode";
import type { ThirdwaveClient } from "../sdk/ThirdwaveClient";
import type { WorkspaceManager } from "../workspace/WorkspaceManager";
export declare class ChatViewProvider implements vscode.WebviewViewProvider {
    private readonly _extensionUri;
    private readonly _context;
    private readonly _workspace;
    static readonly viewType = "thirdwave.chat";
    private _view?;
    private _client;
    private _history;
    private _sessions;
    private _currentSessionId;
    private _currentModel;
    private _currentAgent;
    private _isStreaming;
    constructor(_extensionUri: vscode.Uri, client: ThirdwaveClient, _context: vscode.ExtensionContext, _workspace: WorkspaceManager);
    updateClient(client: ThirdwaveClient): void;
    /** Persist chat history for a session in extension global state */
    private _saveSessionHistory;
    /** Load persisted chat history for a session */
    private _loadSessionHistory;
    /** Remove persisted history when session is deleted */
    private _deleteSessionHistory;
    /** Persist the sessions list to extension global state */
    private _persistSessions;
    /** Restore the sessions list from extension global state */
    private _restoreSessions;
    notifyModelChanged(model: string): void;
    notifyAgentChanged(agent: string): void;
    createSession(): Promise<void>;
    resolveWebviewView(webviewView: vscode.WebviewView, _ctx: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): void;
    private _loadModels;
    private _loadSkills;
    private _loadSessions;
    private _loadHitl;
    private _onUserMessage;
    private _post;
    private _html;
}
