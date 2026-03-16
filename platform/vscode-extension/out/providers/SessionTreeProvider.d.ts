import * as vscode from "vscode";
import type { ThirdwaveClient, SessionInfo } from "../sdk/ThirdwaveClient";
export declare class SessionTreeProvider implements vscode.TreeDataProvider<SessionItem> {
    private _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<SessionItem | undefined>;
    private _client;
    private _sessions;
    constructor(client: ThirdwaveClient);
    updateClient(client: ThirdwaveClient): void;
    refresh(): void;
    getChildren(): Promise<SessionItem[]>;
    getTreeItem(element: SessionItem): vscode.TreeItem;
}
declare class SessionItem extends vscode.TreeItem {
    sessionId: string;
    constructor(session: SessionInfo);
}
export {};
