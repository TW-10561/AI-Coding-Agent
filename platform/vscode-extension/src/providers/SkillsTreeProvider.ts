// ---------------------------------------------------------------------------
// Skills Tree Provider — sidebar tree for browsing and applying skills
// ---------------------------------------------------------------------------

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

export class SkillsTreeProvider implements vscode.TreeDataProvider<SkillTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SkillTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _client: ThirdwaveClient;
  private _skills: SkillMeta[] = [];
  private _categories: Map<string, SkillMeta[]> = new Map();

  constructor(client: ThirdwaveClient) {
    this._client = client;
  }

  updateClient(client: ThirdwaveClient) {
    this._client = client;
    this.refresh();
  }

  refresh() {
    this._skills = [];
    this._categories.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  async getChildren(element?: SkillTreeItem): Promise<SkillTreeItem[]> {
    if (!element) {
      try {
        this._skills = await this._client.listSkills();
        this._categories.clear();
        for (const s of this._skills) {
          const cat = s.category || "General";
          if (!this._categories.has(cat)) { this._categories.set(cat, []); }
          this._categories.get(cat)!.push(s);
        }
        const items: CategoryItem[] = [];
        for (const [cat, skills] of this._categories) {
          items.push(new CategoryItem(cat, skills.length));
        }
        items.sort((a, b) => a.label!.toString().localeCompare(b.label!.toString()));
        return items;
      } catch {
        return [new CategoryItem("Cannot connect to Thirdwave", 0)];
      }
    }

    if (element instanceof CategoryItem) {
      const skills = this._categories.get(element.categoryName) ?? [];
      return skills.map((s) => new SkillItem(s));
    }

    return [];
  }

  getTreeItem(element: SkillTreeItem): vscode.TreeItem {
    return element;
  }
}

class CategoryItem extends vscode.TreeItem {
  public categoryName: string;

  constructor(category: string, count: number) {
    super(category, count > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.categoryName = category;
    this.description = `${count} skill${count !== 1 ? "s" : ""}`;
    this.iconPath = new vscode.ThemeIcon("folder");
    this.contextValue = "skillCategory";
  }
}

class SkillItem extends vscode.TreeItem {
  public skillId: string;

  constructor(skill: SkillMeta) {
    super(skill.displayName || skill.name, vscode.TreeItemCollapsibleState.None);
    this.skillId = skill.id;
    this.description = skill.description;
    this.tooltip = `${skill.displayName || skill.name}\n${skill.description}`;
    this.iconPath = new vscode.ThemeIcon("book");
    this.contextValue = "skill";

    this.command = {
      command: "thirdwave.viewSkill",
      title: "View Skill",
      arguments: [skill.id, skill.displayName || skill.name],
    };
  }
}
