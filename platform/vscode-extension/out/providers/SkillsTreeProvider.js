"use strict";
// ---------------------------------------------------------------------------
// Skills Tree Provider — sidebar tree for browsing and applying skills
// ---------------------------------------------------------------------------
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillsTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
class SkillsTreeProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    _client;
    _skills = [];
    _categories = new Map();
    constructor(client) {
        this._client = client;
    }
    updateClient(client) {
        this._client = client;
        this.refresh();
    }
    refresh() {
        this._skills = [];
        this._categories.clear();
        this._onDidChangeTreeData.fire(undefined);
    }
    async getChildren(element) {
        if (!element) {
            try {
                this._skills = await this._client.listSkills();
                this._categories.clear();
                for (const s of this._skills) {
                    const cat = s.category || "General";
                    if (!this._categories.has(cat)) {
                        this._categories.set(cat, []);
                    }
                    this._categories.get(cat).push(s);
                }
                const items = [];
                for (const [cat, skills] of this._categories) {
                    items.push(new CategoryItem(cat, skills.length));
                }
                items.sort((a, b) => a.label.toString().localeCompare(b.label.toString()));
                return items;
            }
            catch {
                return [new CategoryItem("Cannot connect to Thirdwave", 0)];
            }
        }
        if (element instanceof CategoryItem) {
            const skills = this._categories.get(element.categoryName) ?? [];
            return skills.map((s) => new SkillItem(s));
        }
        return [];
    }
    getTreeItem(element) {
        return element;
    }
}
exports.SkillsTreeProvider = SkillsTreeProvider;
class CategoryItem extends vscode.TreeItem {
    categoryName;
    constructor(category, count) {
        super(category, count > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
        this.categoryName = category;
        this.description = `${count} skill${count !== 1 ? "s" : ""}`;
        this.iconPath = new vscode.ThemeIcon("folder");
        this.contextValue = "skillCategory";
    }
}
class SkillItem extends vscode.TreeItem {
    skillId;
    constructor(skill) {
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
//# sourceMappingURL=SkillsTreeProvider.js.map