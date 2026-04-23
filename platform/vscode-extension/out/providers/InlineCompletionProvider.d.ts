import * as vscode from "vscode";
import type { ThirdwaveClient } from "../sdk/ThirdwaveClient";
export declare class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private _client;
    private _debounceTimer;
    private _lastRequest;
    constructor(client: ThirdwaveClient);
    updateClient(client: ThirdwaveClient): void;
    provideInlineCompletionItems(document: vscode.TextDocument, position: vscode.Position, _context: vscode.InlineCompletionContext, token: vscode.CancellationToken): Promise<vscode.InlineCompletionList | null>;
}
