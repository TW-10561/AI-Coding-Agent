import * as vscode from "vscode";
import type { ThirdwaveClient } from "../sdk/ThirdwaveClient";
export declare class ChatViewProvider implements vscode.WebviewViewProvider {
    private readonly _extensionUri;
    private readonly _context;
    static readonly viewType = "thirdwave.chat";
    private _view?;
    private _client;
    private _history;
    private _currentSessionId;
    private _currentModel;
    private _currentAgent;
    private _isStreaming;
    constructor(_extensionUri: vscode.Uri, client: ThirdwaveClient, _context: vscode.ExtensionContext);
    updateClient(client: ThirdwaveClient): void;
    notifyModelChanged(model: string): void;
    notifyAgentChanged(agent: string): void;
    createSession(): Promise<void>;
    resolveWebviewView(webviewView: vscode.WebviewView, _ctx: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken): void;
    private _loadModels;
    private _loadSkills;
    private _loadSessions;
    private _onUserMessage;
    private _post;
    private _html;
}
