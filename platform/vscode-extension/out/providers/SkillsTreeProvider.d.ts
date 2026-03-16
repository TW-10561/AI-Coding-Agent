import * as vscode from "vscode";
import type { ThirdwaveClient } from "../sdk/ThirdwaveClient";
interface SkillMeta {
    id: string;
    name: string;
    displayName: string;
    description: string;
    category?: string;
}
type SkillTreeItem = CategoryItem | SkillItem;
export declare class SkillsTreeProvider implements vscode.TreeDataProvider<SkillTreeItem> {
    private _onDidChangeTreeData;
    readonly onDidChangeTreeData: vscode.Event<SkillTreeItem | undefined>;
    private _client;
    private _skills;
    private _categories;
    constructor(client: ThirdwaveClient);
    updateClient(client: ThirdwaveClient): void;
    refresh(): void;
    getChildren(element?: SkillTreeItem): Promise<SkillTreeItem[]>;
    getTreeItem(element: SkillTreeItem): vscode.TreeItem;
}
declare class CategoryItem extends vscode.TreeItem {
    categoryName: string;
    constructor(category: string, count: number);
}
declare class SkillItem extends vscode.TreeItem {
    skillId: string;
    constructor(skill: SkillMeta);
}
export {};
