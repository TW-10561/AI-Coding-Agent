"use strict";
// ---------------------------------------------------------------------------
// Chat Webview Provider — unified sidebar panel (Chat + Models + Skills + History)
// Cline-style single-panel design — no tree views
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
exports.ChatViewProvider = void 0;
const vscode = __importStar(require("vscode"));
class ChatViewProvider {
    _extensionUri;
    _context;
    static viewType = "thirdwave.chat";
    _view;
    _client;
    _history = [];
    _currentSessionId = null;
    _currentModel = "";
    _currentAgent = "build";
    _isStreaming = false;
    constructor(_extensionUri, client, _context) {
        this._extensionUri = _extensionUri;
        this._context = _context;
        this._client = client;
        const cfg = vscode.workspace.getConfiguration("thirdwave");
        this._currentModel = cfg.get("defaultModel", "");
        this._currentAgent = cfg.get("defaultAgent", "build");
    }
    updateClient(client) { this._client = client; }
    notifyModelChanged(model) {
        this._currentModel = model;
        this._post({ type: "modelChanged", model });
    }
    notifyAgentChanged(agent) {
        this._currentAgent = agent;
        this._post({ type: "agentChanged", agent });
    }
    async createSession() {
        try {
            const session = await this._client.createSession({
                agentID: this._currentAgent,
                title: `VS Code — ${new Date().toLocaleString()}`,
            });
            this._currentSessionId = session.id;
            this._history = [];
            this._post({ type: "sessionCreated", sessionId: session.id });
            this._post({ type: "clearChat" });
        }
        catch (e) {
            vscode.window.showErrorMessage(`Failed to create session: ${e.message}`);
        }
    }
    resolveWebviewView(webviewView, _ctx, _token) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };
        webviewView.webview.html = this._html(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case "sendMessage":
                    await this._onUserMessage(msg.text);
                    break;
                case "newSession":
                    await this.createSession();
                    break;
                case "ready":
                    this._post({ type: "init", model: this._currentModel, agent: this._currentAgent, sessionId: this._currentSessionId });
                    if (this._history.length > 0)
                        this._post({ type: "loadHistory", messages: this._history });
                    this._loadModels();
                    this._loadSkills();
                    this._loadSessions();
                    break;
                case "selectModel":
                    this._currentModel = msg.modelId;
                    await vscode.workspace.getConfiguration("thirdwave").update("defaultModel", msg.modelId, vscode.ConfigurationTarget.Workspace);
                    this._post({ type: "modelChanged", model: msg.modelId });
                    break;
                case "selectAgent":
                    this._currentAgent = msg.agent;
                    await vscode.workspace.getConfiguration("thirdwave").update("defaultAgent", msg.agent, vscode.ConfigurationTarget.Workspace);
                    this._post({ type: "agentChanged", agent: msg.agent });
                    break;
                case "refreshModels":
                    this._loadModels();
                    break;
                case "refreshSkills":
                    this._loadSkills();
                    break;
                case "refreshSessions":
                    this._loadSessions();
                    break;
                case "switchSession":
                    this._currentSessionId = msg.sessionId;
                    this._history = [];
                    try {
                        const msgs = await this._client.listMessages(msg.sessionId, { limit: 50 });
                        for (const m of msgs) {
                            const tp = m.parts.find((p) => p.type === "text");
                            if (tp)
                                this._history.push({ role: m.info.role, content: tp.text || tp.content || "", timestamp: m.info.createdAt });
                        }
                        this._post({ type: "loadHistory", messages: this._history });
                    }
                    catch (e) {
                        vscode.window.showErrorMessage(`Failed to load session: ${e.message}`);
                    }
                    break;
                case "deleteSession":
                    try {
                        await this._client.deleteSession(msg.sessionId);
                        this._loadSessions();
                    }
                    catch (e) {
                        vscode.window.showErrorMessage(`Delete failed: ${e.message}`);
                    }
                    break;
                case "viewSkill":
                    vscode.commands.executeCommand("thirdwave.viewSkill", msg.skillId, msg.skillName);
                    break;
            }
        });
    }
    async _loadModels() {
        try {
            this._post({ type: "modelsData", registry: await this._client.registry() });
        }
        catch {
            this._post({ type: "modelsData", registry: { local: [], cloud: [], activeModel: "none" } });
        }
    }
    async _loadSkills() {
        try {
            this._post({ type: "skillsData", skills: await this._client.listSkills() });
        }
        catch {
            this._post({ type: "skillsData", skills: [] });
        }
    }
    async _loadSessions() {
        try {
            this._post({ type: "sessionsData", sessions: await this._client.listSessions() });
        }
        catch {
            this._post({ type: "sessionsData", sessions: [] });
        }
    }
    async _onUserMessage(text) {
        if (this._isStreaming)
            return;
        if (!this._currentSessionId)
            await this.createSession();
        const userMsg = { role: "user", content: text, timestamp: Date.now() };
        this._history.push(userMsg);
        this._post({ type: "addMessage", message: userMsg });
        this._post({ type: "setLoading", loading: true });
        this._isStreaming = true;
        try {
            const cfg = vscode.workspace.getConfiguration("thirdwave");
            const histSlice = this._history.filter(m => m.role === "user" || m.role === "assistant").slice(-10).map(m => ({ role: m.role, content: m.content }));
            histSlice.pop();
            const kw = /\b(run|exec|build|test|compile|deploy|install|create|delete|remove|write|read|search|find|list|show|open|close|kill|start|stop|restart|update|upgrade|fix|check|lint|format|refactor|rename|move|copy|curl|wget|pip|npm|bun|git|docker|make|grep|sed|awk)\b/i;
            const tools = cfg.get("enableTools", true) && text.split(/\s+/).length > 5 && kw.test(text);
            const resp = await this._client.directChat({
                message: text,
                modelID: this._currentModel || undefined,
                maxTokens: cfg.get("maxTokens", 8192),
                temperature: cfg.get("temperature", 0.3),
                history: histSlice.length > 0 ? histSlice : undefined,
                tools,
            });
            const aMsg = {
                role: "assistant", content: resp.text, reasoning: resp.reasoning,
                toolCalls: resp.toolCalls, tokens: resp.tokens, latencyMs: resp.latencyMs,
                model: resp.model, timestamp: Date.now(),
            };
            this._history.push(aMsg);
            this._post({ type: "addMessage", message: aMsg });
        }
        catch (e) {
            this._post({ type: "addMessage", message: { role: "system", content: `Error: ${e.message}`, timestamp: Date.now() } });
        }
        finally {
            this._isStreaming = false;
            this._post({ type: "setLoading", loading: false });
        }
    }
    _post(msg) { this._view?.webview.postMessage(msg); }
    // ═══════════════════════════════════════════════════════════════
    // Webview HTML — uses external media/chat.js and media/chat.css
    // ═══════════════════════════════════════════════════════════════
    _html(wv) {
        const n = getNonce();
        const cssUri = wv.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "chat.css"));
        const jsUri = wv.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "chat.js"));
        return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${wv.cspSource}; script-src ${wv.cspSource} 'nonce-${n}'; img-src ${wv.cspSource} https:;">
<link rel="stylesheet" href="${cssUri}">
</head>
<body>
<div class="tabs">
  <button class="tab active" data-tab="chat">Chat</button>
  <button class="tab" data-tab="settings">Models</button>
  <button class="tab" data-tab="skills">Skills</button>
  <button class="tab" data-tab="sessions">History</button>
</div>

<!-- CHAT -->
<div class="pnl active" id="p-chat">
  <div class="ch">
    <div class="bg">
      <span class="badge" id="aBad" title="Agent mode">build</span>
      <span class="badge" id="mBad" title="Active model">auto</span>
    </div>
    <button class="ib" id="newBtn" title="New Session">+</button>
  </div>
  <div class="msgs" id="msgs">
    <div class="es" id="es">
      <div class="lg">&#9670;</div>
      <h3>Thirdwave AI</h3>
      <p>AI coding assistant powered by local vLLM gateway.</p>
      <button class="wb" id="startBtn">Start a conversation</button>
    </div>
  </div>
  <div class="ld" id="ld"><div class="spn"></div><span>Thinking...</span></div>
  <div class="ia">
    <div class="ir">
      <textarea id="inp" placeholder="Type your task here..." rows="1"></textarea>
      <button class="sb" id="snd">&#9654;</button>
    </div>
    <div class="ih">Enter to send &middot; Shift+Enter for newline</div>
  </div>
</div>

<!-- MODELS / SETTINGS -->
<div class="pnl" id="p-settings">
  <div class="scr" id="setScr">
    <div class="sec">
      <div class="st">API Configuration</div>
      <div class="sg">
        <div class="sl">Agent Mode</div>
        <select id="agSel">
          <option value="build">build &mdash; Full read/write/execute</option>
          <option value="plan">plan &mdash; Read-only planning</option>
          <option value="explore">explore &mdash; Codebase search</option>
          <option value="general">general &mdash; Multi-step reasoning</option>
        </select>
      </div>
      <div class="sg">
        <div class="sl">Active Model</div>
        <div class="sd">Select from available local or cloud models</div>
        <select id="mdSel"><option value="">Auto (gateway default)</option></select>
      </div>
    </div>
    <div class="sec">
      <div class="st">Gateway Models (Local)</div>
      <div id="lcm"><div class="nd">Loading...</div></div>
    </div>
    <div class="sec">
      <div class="st">Cloud Providers</div>
      <div id="ccm"><div class="nd">Loading...</div></div>
    </div>
  </div>
</div>

<!-- SKILLS -->
<div class="pnl" id="p-skills">
  <div class="ssr"><input type="text" id="skQ" placeholder="Filter skills..." /></div>
  <div class="sks" id="skC"><div class="nd">Loading skills...</div></div>
</div>

<!-- SESSIONS -->
<div class="pnl" id="p-sessions">
  <div class="scr" id="seC"><div class="nd">Loading sessions...</div></div>
</div>

<script nonce="${n}" src="${jsUri}"></script>
</body></html>`;
    }
}
exports.ChatViewProvider = ChatViewProvider;
function getNonce() {
    const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let n = "";
    for (let i = 0; i < 32; i++)
        n += c.charAt(Math.floor(Math.random() * c.length));
    return n;
}
//# sourceMappingURL=ChatViewProvider.js.map