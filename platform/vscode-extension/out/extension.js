"use strict";
// ---------------------------------------------------------------------------
// Thirdwave AI — VS Code Extension entry point
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const ChatViewProvider_1 = require("./chat/ChatViewProvider");
const ChatParticipant_1 = require("./chat/ChatParticipant");
const ThirdwaveClient_1 = require("./sdk/ThirdwaveClient");
let client;
let chatProvider;
let modelStatusBar;
let agentStatusBar;
function activate(context) {
    const config = vscode.workspace.getConfiguration("thirdwave");
    const baseUrl = config.get("platformUrl", "http://localhost:3100");
    const apiKey = config.get("apiKey", "");
    client = new ThirdwaveClient_1.ThirdwaveClient({ baseUrl, apiKey: apiKey || undefined });
    // ── Chat Webview Provider (unified sidebar) ────────────────────
    chatProvider = new ChatViewProvider_1.ChatViewProvider(context.extensionUri, client, context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider("thirdwave.chat", chatProvider, {
        webviewOptions: { retainContextWhenHidden: true },
    }));
    // ── Chat Participant (@thirdwave in VS Code Chat) ──────────────
    (0, ChatParticipant_1.registerChatParticipant)(context, () => client);
    // ── Status Bar: Model ──────────────────────────────────────────
    modelStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    modelStatusBar.command = "thirdwave.selectModel";
    modelStatusBar.tooltip = "Thirdwave: Active Model";
    updateModelStatusBar();
    modelStatusBar.show();
    context.subscriptions.push(modelStatusBar);
    // ── Status Bar: Agent ──────────────────────────────────────────
    agentStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    agentStatusBar.command = "thirdwave.selectAgent";
    agentStatusBar.tooltip = "Thirdwave: Active Agent";
    updateAgentStatusBar();
    agentStatusBar.show();
    context.subscriptions.push(agentStatusBar);
    // ── Commands ───────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand("thirdwave.openChat", () => {
        vscode.commands.executeCommand("thirdwave.chat.focus");
    }), vscode.commands.registerCommand("thirdwave.newSession", async () => {
        await chatProvider.createSession();
    }), vscode.commands.registerCommand("thirdwave.selectModel", async () => {
        await selectModel();
    }), vscode.commands.registerCommand("thirdwave.selectAgent", async () => {
        await selectAgent();
    }), vscode.commands.registerCommand("thirdwave.refreshSessions", () => {
        // Handled inside the webview now
    }), vscode.commands.registerCommand("thirdwave.deleteSession", async (item) => {
        if (item?.sessionId) {
            const confirm = await vscode.window.showWarningMessage(`Delete session "${item.label}"?`, { modal: true }, "Delete");
            if (confirm === "Delete") {
                await client.deleteSession(item.sessionId);
                vscode.window.showInformationMessage("Session deleted.");
            }
        }
    }), vscode.commands.registerCommand("thirdwave.refreshRegistry", async () => {
        try {
            await client.refreshRegistry();
            vscode.window.showInformationMessage("Model registry refreshed.");
        }
        catch (e) {
            vscode.window.showErrorMessage(`Registry refresh failed: ${e.message}`);
        }
    }), vscode.commands.registerCommand("thirdwave.showRegistry", async () => {
        await showRegistryPanel();
    }), vscode.commands.registerCommand("thirdwave.showBudget", async () => {
        await showBudgetPanel();
    }), vscode.commands.registerCommand("thirdwave.showAudit", async () => {
        await showAuditPanel();
    }), vscode.commands.registerCommand("thirdwave.showPolicies", async () => {
        await showPoliciesPanel();
    }), vscode.commands.registerCommand("thirdwave.selectModelById", async (modelId, modelName) => {
        const config = vscode.workspace.getConfiguration("thirdwave");
        await config.update("defaultModel", modelId, vscode.ConfigurationTarget.Workspace);
        updateModelStatusBar();
        chatProvider.notifyModelChanged(modelId);
        vscode.window.showInformationMessage(`Model set to ${modelName || modelId}`);
    }), vscode.commands.registerCommand("thirdwave.viewSkill", async (skillId, skillName) => {
        await showSkillPanel(skillId, skillName);
    }), vscode.commands.registerCommand("thirdwave.searchSkills", async () => {
        const query = await vscode.window.showInputBox({
            prompt: "Search skills by keyword",
            placeHolder: "e.g. debugging, typescript, api...",
        });
        if (!query) {
            return;
        }
        try {
            const results = await client.searchSkills(query);
            if (results.length === 0) {
                vscode.window.showInformationMessage(`No skills found for "${query}".`);
                return;
            }
            const pick = await vscode.window.showQuickPick(results.map((r) => ({
                label: r.skill.displayName || r.skill.name,
                description: `relevance: ${(r.relevance * 100).toFixed(0)}%`,
                detail: r.skill.description,
                skillId: r.skill.id,
            })), { placeHolder: "Select a skill to view" });
            if (pick) {
                await showSkillPanel(pick.skillId, pick.label);
            }
        }
        catch (e) {
            vscode.window.showErrorMessage(`Skill search failed: ${e.message}`);
        }
    }), vscode.commands.registerCommand("thirdwave.refreshSkills", () => {
        // Handled inside the webview now
    }));
    // ── Watch config changes ───────────────────────────────────────
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("thirdwave")) {
            const cfg = vscode.workspace.getConfiguration("thirdwave");
            client = new ThirdwaveClient_1.ThirdwaveClient({
                baseUrl: cfg.get("platformUrl", "http://localhost:3100"),
                apiKey: cfg.get("apiKey", "") || undefined,
            });
            chatProvider.updateClient(client);
        }
    }));
    // Health check on activate
    client.health().then((h) => {
        if (h.platform === "ok") {
            vscode.window.setStatusBarMessage("$(check) Thirdwave platform connected", 3000);
        }
        else {
            vscode.window.showWarningMessage(`Thirdwave platform status: ${h.platform}`);
        }
    }).catch(() => {
        vscode.window.showWarningMessage("Cannot reach Thirdwave platform. Check thirdwave.platformUrl setting.");
    });
}
function deactivate() { }
// ── Helpers ────────────────────────────────────────────────────────
function updateModelStatusBar() {
    const config = vscode.workspace.getConfiguration("thirdwave");
    const model = config.get("defaultModel", "");
    modelStatusBar.text = `$(server) ${model || "auto"}`;
}
function updateAgentStatusBar() {
    const config = vscode.workspace.getConfiguration("thirdwave");
    const agent = config.get("defaultAgent", "build");
    const icons = { build: "$(tools)", plan: "$(book)", explore: "$(search)", general: "$(lightbulb)" };
    agentStatusBar.text = `${icons[agent] || "$(robot)"} ${agent}`;
}
async function selectModel() {
    try {
        const registry = await client.registry();
        const items = [];
        for (const p of registry.local) {
            for (const m of p.models) {
                items.push({
                    label: m.name || m.id,
                    description: `${p.name} • ctx:${m.contextLimit} out:${m.outputLimit}`,
                    detail: p.status === "online" ? "$(circle-filled) Online" : "$(circle-outline) Offline",
                });
            }
        }
        for (const p of registry.cloud) {
            if (!p.configured)
                continue;
            for (const m of p.models) {
                items.push({
                    label: m.name || m.id,
                    description: `${p.name} • ctx:${m.contextLimit} out:${m.outputLimit} • $${m.costIn}/$${m.costOut}`,
                    detail: "$(cloud) Cloud",
                });
            }
        }
        const pick = await vscode.window.showQuickPick(items, { placeHolder: "Select a model", title: "Thirdwave: Model Selector" });
        if (pick) {
            const config = vscode.workspace.getConfiguration("thirdwave");
            await config.update("defaultModel", pick.label, vscode.ConfigurationTarget.Workspace);
            updateModelStatusBar();
            chatProvider.notifyModelChanged(pick.label);
            vscode.window.showInformationMessage(`Model set to ${pick.label}`);
        }
    }
    catch (e) {
        vscode.window.showErrorMessage(`Failed to load models: ${e.message}`);
    }
}
async function selectAgent() {
    const agents = [
        { label: "build", description: "Full read/write/execute — default coding agent", detail: "$(tools)" },
        { label: "plan", description: "Read-only planning and analysis", detail: "$(book)" },
        { label: "explore", description: "Codebase search and exploration", detail: "$(search)" },
        { label: "general", description: "Multi-step reasoning and general tasks", detail: "$(lightbulb)" },
    ];
    const pick = await vscode.window.showQuickPick(agents, { placeHolder: "Select an agent mode", title: "Thirdwave: Agent Mode" });
    if (pick) {
        const config = vscode.workspace.getConfiguration("thirdwave");
        await config.update("defaultAgent", pick.label, vscode.ConfigurationTarget.Workspace);
        updateAgentStatusBar();
        chatProvider.notifyAgentChanged(pick.label);
        vscode.window.showInformationMessage(`Agent mode set to ${pick.label}`);
    }
}
async function showRegistryPanel() {
    try {
        const reg = await client.registry();
        const panel = vscode.window.createWebviewPanel("thirdwave.registry", "Thirdwave: Model Registry", vscode.ViewColumn.One, {});
        let html = `<!DOCTYPE html><html><head><style>
      body{font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground);background:var(--vscode-editor-background)}
      table{border-collapse:collapse;width:100%;margin-top:12px}
      th,td{padding:6px 12px;border:1px solid var(--vscode-panel-border);text-align:left}
      th{background:var(--vscode-editor-lineHighlightBackground)}
      .online{color:#22c55e}.offline{color:#ef4444}h2{margin-top:24px}
    </style></head><body>`;
        html += `<h1>Model Registry</h1><p>Generated: ${reg.generatedAt}</p>`;
        html += `<h2>Gateway Models</h2><table><tr><th>Provider</th><th>Endpoint</th><th>Status</th><th>Latency</th><th>Models</th></tr>`;
        for (const p of reg.local) {
            const models = p.models.map((m) => m.name || m.id).join(", ");
            html += `<tr><td>${esc(p.name)}${p.isPrimary ? " ⭐" : ""}</td><td>${esc(p.endpoint)}</td><td class="${p.status}">${p.status}</td><td>${p.latencyMs ?? "—"}ms</td><td>${esc(models)}</td></tr>`;
        }
        html += `</table>`;
        if (reg.cloud.length) {
            html += `<h2>Cloud Providers</h2><table><tr><th>Provider</th><th>Configured</th><th>Models</th></tr>`;
            for (const p of reg.cloud) {
                const models = p.models.map((m) => m.name || m.id).join(", ");
                html += `<tr><td>${esc(p.name)}</td><td>${p.configured ? "✓" : "✗"}</td><td>${esc(models)}</td></tr>`;
            }
            html += `</table>`;
        }
        html += `</body></html>`;
        panel.webview.html = html;
    }
    catch (e) {
        vscode.window.showErrorMessage(`Failed to load registry: ${e.message}`);
    }
}
async function showBudgetPanel() {
    try {
        const budget = await client.budgetSummary();
        const panel = vscode.window.createWebviewPanel("thirdwave.budget", "Thirdwave: Budget", vscode.ViewColumn.One, {});
        panel.webview.html = `<!DOCTYPE html><html><head><style>
      body{font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground);background:var(--vscode-editor-background)}
      pre{background:var(--vscode-textCodeBlock-background);padding:12px;border-radius:4px;overflow:auto}
    </style></head><body><h1>Budget Summary</h1><pre>${esc(JSON.stringify(budget, null, 2))}</pre></body></html>`;
    }
    catch (e) {
        vscode.window.showErrorMessage(`Failed to load budget: ${e.message}`);
    }
}
async function showAuditPanel() {
    try {
        const logs = await client.queryAudit({ limit: 30 });
        const panel = vscode.window.createWebviewPanel("thirdwave.audit", "Thirdwave: Audit Log", vscode.ViewColumn.One, {});
        let html = `<!DOCTYPE html><html><head><style>
      body{font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground);background:var(--vscode-editor-background)}
      table{border-collapse:collapse;width:100%}th,td{padding:4px 8px;border:1px solid var(--vscode-panel-border);text-align:left;font-size:12px}
      th{background:var(--vscode-editor-lineHighlightBackground)}
    </style></head><body><h1>Audit Log</h1><table><tr><th>Time</th><th>Action</th><th>Method</th><th>Path</th><th>Status</th></tr>`;
        for (const e of logs) {
            html += `<tr><td>${new Date(e.timestamp).toLocaleString()}</td><td>${esc(e.action)}</td><td>${esc(e.method ?? "")}</td><td>${esc(e.path ?? "")}</td><td>${e.success ? "✓" : "✗"}</td></tr>`;
        }
        html += `</table></body></html>`;
        panel.webview.html = html;
    }
    catch (e) {
        vscode.window.showErrorMessage(`Failed to load audit: ${e.message}`);
    }
}
async function showPoliciesPanel() {
    try {
        const pol = await client.policyStatus();
        const panel = vscode.window.createWebviewPanel("thirdwave.policies", "Thirdwave: Security Policies", vscode.ViewColumn.One, {});
        panel.webview.html = `<!DOCTYPE html><html><head><style>
      body{font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground);background:var(--vscode-editor-background)}
      pre{background:var(--vscode-textCodeBlock-background);padding:12px;border-radius:4px;overflow:auto}
      .tag{display:inline-block;padding:2px 8px;border-radius:3px;margin:2px;font-size:12px}
      .on{background:#22c55e22;color:#22c55e}.off{background:#ef444422;color:#ef4444}
    </style></head><body>
    <h1>Security Policies</h1>
    <p>Execution Mode: <strong>${esc(pol.executionMode)}</strong></p>
    <p>Sensitive File Guard: <span class="tag ${pol.sensitiveFiles?.enabled ? "on" : "off"}">${pol.sensitiveFiles?.enabled ? "ON" : "OFF"}</span></p>
    <p>Destructive Guard: <span class="tag ${pol.destructiveGuard?.enabled ? "on" : "off"}">${pol.destructiveGuard?.enabled ? "ON" : "OFF"}</span></p>
    <p>Loop Detection: <span class="tag ${pol.loopDetection?.enabled ? "on" : "off"}">${pol.loopDetection?.enabled ? "ON" : "OFF"}</span></p>
    <pre>${esc(JSON.stringify(pol, null, 2))}</pre></body></html>`;
    }
    catch (e) {
        vscode.window.showErrorMessage(`Failed to load policies: ${e.message}`);
    }
}
async function showSkillPanel(skillId, skillName) {
    try {
        const skill = await client.getSkill(skillId);
        const panel = vscode.window.createWebviewPanel("thirdwave.skill", `Skill: ${skillName}`, vscode.ViewColumn.One, {});
        const content = esc(skill.content || "No content available.");
        const rendered = content
            .replace(/^### (.+)$/gm, "<h3>$1</h3>")
            .replace(/^## (.+)$/gm, "<h2>$1</h2>")
            .replace(/^# (.+)$/gm, "<h1>$1</h1>")
            .replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>")
            .replace(/`([^`]+)`/g, "<code>$1</code>")
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/^- (.+)$/gm, "<li>$1</li>")
            .replace(/((?:<li>.*?<\/li>\s*)+)/g, "<ul>$1</ul>")
            .replace(/\n\n/g, "</p><p>")
            .replace(/\n/g, "<br>");
        panel.webview.html = `<!DOCTYPE html><html><head><style>
      body{font-family:var(--vscode-font-family);padding:20px;color:var(--vscode-foreground);background:var(--vscode-editor-background);max-width:800px;margin:0 auto;line-height:1.6}
      h1{color:#7c3aed;border-bottom:2px solid #7c3aed;padding-bottom:8px}h2{margin-top:24px}
      code{font-family:var(--vscode-editor-font-family);background:var(--vscode-textCodeBlock-background);padding:1px 4px;border-radius:3px;font-size:13px}
      pre{background:var(--vscode-textCodeBlock-background);padding:12px;border-radius:6px;overflow-x:auto;margin:12px 0}
      pre code{padding:0;background:none}ul{padding-left:20px}
      .meta{font-size:12px;color:var(--vscode-descriptionForeground);margin-bottom:16px;display:flex;gap:16px}
      .tag{background:#7c3aed22;color:#7c3aed;padding:2px 8px;border-radius:12px;font-size:11px}
    </style></head><body>
    <h1>${esc(skill.displayName || skill.name)}</h1>
    <div class="meta"><span class="tag">${esc(skill.category || "General")}</span><span>ID: ${esc(skill.id)}</span></div>
    <p><em>${esc(skill.description)}</em></p><hr><p>${rendered}</p></body></html>`;
    }
    catch (e) {
        vscode.window.showErrorMessage(`Failed to load skill: ${e.message}`);
    }
}
function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
//# sourceMappingURL=extension.js.map