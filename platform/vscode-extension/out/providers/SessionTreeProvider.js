"use strict";
// ---------------------------------------------------------------------------
// Session Tree Provider — sidebar tree showing conversation sessions
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
exports.SessionTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
class SessionTreeProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    _client;
    _sessions = [];
    constructor(client) {
        this._client = client;
    }
    updateClient(client) {
        this._client = client;
        this.refresh();
    }
    refresh() {
        this._onDidChangeTreeData.fire(undefined);
    }
    async getChildren() {
        try {
            this._sessions = await this._client.listSessions({ limit: 30 });
            return this._sessions.map((s) => new SessionItem(s));
        }
        catch {
            return [new SessionItem({ id: "", title: "Cannot connect to Thirdwave", agentID: "", createdAt: 0, updatedAt: 0 })];
        }
    }
    getTreeItem(element) {
        return element;
    }
}
exports.SessionTreeProvider = SessionTreeProvider;
class SessionItem extends vscode.TreeItem {
    sessionId;
    constructor(session) {
        const label = session.title || `Session ${session.id.slice(0, 8)}`;
        super(label, vscode.TreeItemCollapsibleState.None);
        this.sessionId = session.id;
        this.tooltip = `${label}\nAgent: ${session.agentID}\nCreated: ${session.createdAt ? new Date(session.createdAt).toLocaleString() : "—"}`;
        this.description = session.agentID || "";
        this.contextValue = "session";
        const agentIcons = {
            build: "tools",
            plan: "book",
            explore: "search",
            general: "lightbulb",
        };
        this.iconPath = new vscode.ThemeIcon(agentIcons[session.agentID] || "comment-discussion");
        if (session.id) {
            this.command = {
                command: "thirdwave.openChat",
                title: "Open Session",
                arguments: [session.id],
            };
        }
    }
}
//# sourceMappingURL=SessionTreeProvider.js.map