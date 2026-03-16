import * as vscode from "vscode";
import type { ThirdwaveClient } from "../sdk/ThirdwaveClient";
type ModelTreeItem = ProviderItem | ModelItem;
export declare class ModelTreeProvider implements vscode.TreeDataProvider<ModelTreeItem> {
    private _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<ModelTreeItem | undefined>;
    private _client;
    private _registry;
    constructor(client: ThirdwaveClient);
    updateClient(client: ThirdwaveClient): void;
    refresh(): void;
    getChildren(element?: ModelTreeItem): Promise<ModelTreeItem[]>;
    getTreeItem(element: ModelTreeItem): vscode.TreeItem;
}
declare class ProviderItem extends vscode.TreeItem {
    providerId: string;
    constructor(name: string, status: string, isPrimary: boolean, source: "local" | "cloud", providerId: string, modelCount: number, latencyMs?: number);
}
declare class ModelItem extends vscode.TreeItem {
    constructor(name: string, modelId: string, contextLimit: number, outputLimit: number, source: "local" | "cloud", costIn?: number, costOut?: number);
}
export {};
