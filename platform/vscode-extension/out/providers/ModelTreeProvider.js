"use strict";
// ---------------------------------------------------------------------------
// Model Tree Provider — sidebar tree showing available models & providers
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
exports.ModelTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
class ModelTreeProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    _client;
    _registry = null;
    constructor(client) {
        this._client = client;
    }
    updateClient(client) {
        this._client = client;
        this.refresh();
    }
    refresh() {
        this._registry = null;
        this._onDidChangeTreeData.fire(undefined);
    }
    async getChildren(element) {
        if (!element) {
            // Root: show providers
            try {
                this._registry = await this._client.registry();
                const items = [];
                for (const p of this._registry.local) {
                    items.push(new ProviderItem(p.name, p.status, p.isPrimary, "local", p.id, p.models.length, p.latencyMs));
                }
                for (const p of this._registry.cloud) {
                    if (p.configured) {
                        items.push(new ProviderItem(p.name, "online", false, "cloud", p.id, p.models.length));
                    }
                }
                return items;
            }
            catch {
                return [];
            }
        }
        if (element instanceof ProviderItem && this._registry) {
            // Children: models under provider
            const local = this._registry.local.find((p) => p.id === element.providerId);
            if (local) {
                return local.models.map((m) => new ModelItem(m.name || m.id, m.id, m.contextLimit, m.outputLimit, "local"));
            }
            const cloud = this._registry.cloud.find((p) => p.id === element.providerId);
            if (cloud) {
                return cloud.models.map((m) => new ModelItem(m.name || m.id, m.id, m.contextLimit, m.outputLimit, "cloud", m.costIn, m.costOut));
            }
        }
        return [];
    }
    getTreeItem(element) {
        return element;
    }
}
exports.ModelTreeProvider = ModelTreeProvider;
class ProviderItem extends vscode.TreeItem {
    providerId;
    constructor(name, status, isPrimary, source, providerId, modelCount, latencyMs) {
        super(name + (isPrimary ? " ⭐" : ""), vscode.TreeItemCollapsibleState.Expanded);
        this.providerId = providerId;
        const statusText = status === "online" ? "Online" : status;
        const latency = latencyMs ? ` • ${latencyMs}ms` : "";
        this.description = `${statusText}${latency} • ${modelCount} model${modelCount !== 1 ? "s" : ""}`;
        this.iconPath = new vscode.ThemeIcon(source === "cloud" ? "cloud" : status === "online" ? "vm-running" : "vm-outline");
        this.contextValue = "provider";
    }
}
class ModelItem extends vscode.TreeItem {
    constructor(name, modelId, contextLimit, outputLimit, source, costIn, costOut) {
        super(name, vscode.TreeItemCollapsibleState.None);
        this.description = `ctx:${contextLimit} out:${outputLimit}`;
        if (costIn !== undefined && costOut !== undefined) {
            this.description += ` • $${costIn}/$${costOut}`;
        }
        this.tooltip = `Model: ${name}\nID: ${modelId}\nContext: ${contextLimit}\nOutput: ${outputLimit}`;
        this.iconPath = new vscode.ThemeIcon(source === "cloud" ? "cloud" : "server");
        this.contextValue = "model";
        // Click to select model
        this.command = {
            command: "thirdwave.selectModelById",
            title: "Select Model",
            arguments: [modelId, name],
        };
    }
}
//# sourceMappingURL=ModelTreeProvider.js.map