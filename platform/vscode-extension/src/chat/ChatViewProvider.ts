// ---------------------------------------------------------------------------
// Chat Webview Provider — unified sidebar panel (Chat + Models + Skills + History)
// Cline-style single-panel design — no tree views
// ---------------------------------------------------------------------------

import * as vscode from "vscode";
import type { ThirdwaveClient } from "../sdk/ThirdwaveClient";
import type { WorkspaceManager } from "../workspace/WorkspaceManager";

interface SessionRecord {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string;
  toolCalls?: Array<{ tool: string; args: Record<string, unknown>; result: string; success: boolean }>;
  tokens?: { input: number; output: number };
  latencyMs?: number;
  model?: string;
  timestamp: number;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "thirdwave.chat";

  private _view?: vscode.WebviewView;
  private _client: ThirdwaveClient;
  private _history: ChatMessage[] = [];
  private _sessions: SessionRecord[] = [];
  private _currentSessionId: string | null = null;
  private _currentModel: string = "";
  private _currentAgent: string = "build";
  private _currentLanguage: string = "en";
  private _isStreaming = false;
  private _abortController: AbortController | null = null;
  private _modelConfigOverrides: { contextWindow?: number; maxOutputTokens?: number; inputPrice?: number; outputPrice?: number; temperature?: number; supportsImages?: boolean; enableR1Format?: boolean } = {};

  // ── HITL polling during streaming ─────────────────────────────
  private _hitlPollTimer: ReturnType<typeof setInterval> | null = null;
  private _shownHitlIds = new Set<string>();

  constructor(
    private readonly _extensionUri: vscode.Uri,
    client: ThirdwaveClient,
    private readonly _context: vscode.ExtensionContext,
    private readonly _workspace: WorkspaceManager
  ) {
    this._client = client;
    const cfg = vscode.workspace.getConfiguration("thirdwave");
    this._currentModel = cfg.get<string>("defaultModel", "");
    this._currentAgent = cfg.get<string>("defaultAgent", "build");
    this._currentLanguage = this._context.globalState.get<string>("thirdwave.language", "en");
  }

  updateClient(client: ThirdwaveClient) {
    this._client = client;
    // Re-fetch data with the new client immediately
    this._loadModels(); this._loadSkills(); this._loadHitl();
  }

  /** Persist chat history for a session in extension global state */
  private _saveSessionHistory(sessionId: string, messages: ChatMessage[]) {
    const key = `thirdwave.sessionHistory.${sessionId}`;
    // Keep max 100 messages per session to avoid bloat
    const trimmed = messages.slice(-100);
    this._context.globalState.update(key, trimmed);
  }

  /** Load persisted chat history for a session */
  private _loadSessionHistory(sessionId: string): ChatMessage[] {
    const key = `thirdwave.sessionHistory.${sessionId}`;
    return this._context.globalState.get<ChatMessage[]>(key, []);
  }

  /** Remove persisted history when session is deleted */
  private _deleteSessionHistory(sessionId: string) {
    const key = `thirdwave.sessionHistory.${sessionId}`;
    this._context.globalState.update(key, undefined);
  }

  /** Persist the sessions list to extension global state */
  private _persistSessions() {
    this._context.globalState.update("thirdwave.sessions", this._sessions);
  }

  /** Restore the sessions list from extension global state */
  private _restoreSessions(): SessionRecord[] {
    return this._context.globalState.get<SessionRecord[]>("thirdwave.sessions", []);
  }

  notifyModelChanged(model: string) {
    this._currentModel = model;
    this._post({ type: "modelChanged", model });
  }

  notifyAgentChanged(agent: string) {
    this._currentAgent = agent;
    this._post({ type: "agentChanged", agent });
  }

  async createSession() {
    const id = `sess_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    this._currentSessionId = id;
    this._history = [];
    this._post({ type: "sessionCreated", sessionId: id });
    this._post({ type: "clearChat" });
    // Don't persist yet — session is saved only when the first message is sent.
    // This prevents empty "New chat" entries from cluttering session history.
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };
    webviewView.webview.html = this._html(webviewView.webview);

    // Re-load data whenever the sidebar becomes visible (covers cases where
    // the server started after the extension and retries already exhausted)
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        console.log("[thirdwave] sidebar became visible — reloading data");
        this._loadModels(); this._loadSkills(); this._loadHitl();
      }
    });

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "sendMessage": 
          if (typeof msg.text === "string") await this._onUserMessage(msg.text); 
          break;
        case "stopGeneration":
          if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
          }
          // Immediately allow new messages — don't wait for the finally block
          this._isStreaming = false;
          break;
        case "newSession": await this.createSession(); break;
        case "ready":
          this._post({ type: "init", model: this._currentModel, agent: this._currentAgent, sessionId: this._currentSessionId, language: this._currentLanguage });
          if (this._history.length > 0) this._post({ type: "loadHistory", messages: this._history });
          this._loadModels(); this._loadSkills(); this._loadSessions(); this._loadHitl();
          // Send persisted skill selections to webview
          this._post({ type: "selectedSkillsData", skillIds: this._context.workspaceState.get<string[]>("thirdwave.selectedSkills", []) });
          // Send persisted custom OpenAI config
          { const coConfig = this._context.globalState.get<{ baseUrl?: string; apiKey?: string; modelId?: string }>("thirdwave.customOpenAI");
            if (coConfig) this._post({ type: "customOpenAIData", config: coConfig }); }
          break;
        case "setLanguage":
          if (typeof msg.language === "string") {
            this._currentLanguage = msg.language;
            this._context.globalState.update("thirdwave.language", msg.language);
          }
          break;
        case "selectModel":
          if (typeof msg.modelId === "string") {
            this._currentModel = msg.modelId;
            this._post({ type: "modelChanged", model: msg.modelId });
            try { await vscode.workspace.getConfiguration("thirdwave").update("defaultModel", msg.modelId, vscode.ConfigurationTarget.Workspace); } catch {}
          }
          break;
        case "selectAgent":
          if (typeof msg.agent === "string") {
            this._currentAgent = msg.agent;
            this._post({ type: "agentChanged", agent: msg.agent });
            try { await vscode.workspace.getConfiguration("thirdwave").update("defaultAgent", msg.agent, vscode.ConfigurationTarget.Workspace); } catch {}
          }
          break;
        case "refreshModels": this._loadModels(true); this._loadSkills(); this._loadHitl(); break;
        case "refreshSkills": this._loadSkills(); break;
        case "refreshSessions": this._loadSessions(); break;
        case "switchSession":
          if (typeof msg.sessionId === "string") {
            this._currentSessionId = msg.sessionId;
            this._history = this._loadSessionHistory(msg.sessionId);
            this._post({ type: "loadHistory", messages: this._history });
          }
          break;
        case "deleteSession":
          if (typeof msg.sessionId === "string") {
            this._deleteSessionHistory(msg.sessionId);
            this._sessions = this._restoreSessions().filter(s => s.id !== msg.sessionId);
            this._persistSessions();
            this._post({ type: "sessionsData", sessions: this._sessions });
          }
          break;
        case "viewSkill":
          if (typeof msg.skillId === "string" && typeof msg.skillName === "string") {
            vscode.commands.executeCommand("thirdwave.viewSkill", msg.skillId, msg.skillName);
          }
          break;
        case "toggleSkill": {
          if (typeof msg.skillId === "string" && typeof msg.enabled === "boolean") {
            const selected: string[] = this._context.workspaceState.get<string[]>("thirdwave.selectedSkills", []);
            if (msg.enabled) {
              if (!selected.includes(msg.skillId)) selected.push(msg.skillId);
            } else {
              const idx = selected.indexOf(msg.skillId);
              if (idx >= 0) selected.splice(idx, 1);
            }
            this._context.workspaceState.update("thirdwave.selectedSkills", selected);
          }
          break;
        }
        case "clearSkills":
          this._context.workspaceState.update("thirdwave.selectedSkills", []);
          break;
        case "openExternal":
          if (typeof msg.url === "string" && msg.url.startsWith("https://")) {
            vscode.env.openExternal(vscode.Uri.parse(msg.url));
          }
          break;
        case "setCloudKey": {
          // Save cloud provider API key via platform registry endpoint
          const key = typeof msg.key === "string" ? msg.key : "";
          const providerId = typeof msg.provider === "string" ? msg.provider : "";
          if (key && providerId) {
            try {
              await this._client.setCloudProviderKey(providerId, key);
              vscode.window.showInformationMessage(`API key for ${providerId} saved. Refreshing models...`);
              this._loadModels();
              this._post({ type: "cloudKeySaved", provider: providerId });
            } catch (e: any) {
              vscode.window.showErrorMessage(`Failed to save API key: ${e.message}`);
              this._post({ type: "cloudKeySaveError", provider: providerId, error: e.message });
            }
          }
          break;
        }
        case "pickFiles": {
          const attached = await this._workspace.pickAndAttachFiles();
          const list = attached.map(f => ({ name: f.name, path: f.relativePath, language: f.language, size: f.size }));
          this._post({ type: "filesAttached", files: list });
          break;
        }
        case "attachActiveFile": {
          const editor = vscode.window.activeTextEditor;
          if (editor && editor.document.uri.scheme === "file") {
            const content = editor.document.getText();
            const rel = vscode.workspace.asRelativePath(editor.document.uri);
            const name = rel.split("/").pop() || rel;
            const lang = editor.document.languageId;
            this._workspace.attachFile({ name, relativePath: rel, language: lang, content: content.substring(0, 50000), size: content.length });
            this._post({ type: "filesAttached", files: [{ name, path: rel, language: lang, size: content.length }] });
          }
          break;
        }
        case "removeAttachment":
          this._workspace.removeAttachment(msg.path);
          this._post({ type: "attachmentRemoved", path: msg.path });
          break;
        case "getDiagnostics": {
          const diags = this._workspace.getDiagnostics();
          this._post({ type: "diagnosticsData", diagnostics: diags });
          break;
        }
        case "hitlResolve": {
          const rid = typeof msg.requestId === "string" ? msg.requestId : "";
          const decision = msg.decision === "approve" ? "approved" : "denied";
          if (rid) {
            try {
              await this._client.resolveHitl(rid, decision);
              this._loadHitl();
              // Notify webview so inline card updates to resolved state
              this._post({ type: "hitlApprovalResolved", requestId: rid, decision });
            } catch (e: any) { vscode.window.showErrorMessage(`HITL resolve failed: ${e.message}`); }
          }
          break;
        }
        case "refreshHitl":
          this._loadHitl();
          break;
        case "setCustomOpenAI": {
          // Persist the custom OpenAI-compatible endpoint config
          const coConfig = {
            baseUrl: typeof msg.baseUrl === "string" ? msg.baseUrl : "",
            apiKey: typeof msg.apiKey === "string" ? msg.apiKey : "",
            modelId: typeof msg.modelId === "string" ? msg.modelId : "",
          };
          this._context.globalState.update("thirdwave.customOpenAI", coConfig);
          this._post({ type: "customOpenAISaved", config: coConfig });
          break;
        }
        case "testCustomOpenAI": {
          // Test the custom OpenAI endpoint by hitting /v1/models
          const coTest = this._context.globalState.get<{ baseUrl?: string; apiKey?: string }>("thirdwave.customOpenAI", {});
          const testUrl = (typeof msg.baseUrl === "string" ? msg.baseUrl : coTest.baseUrl || "").replace(/\/?$/, "");
          const testKey = typeof msg.apiKey === "string" ? msg.apiKey : coTest.apiKey || "";
          if (!testUrl) { this._post({ type: "customOpenAITestResult", ok: false, error: "No base URL" }); break; }
          try {
            const headers: Record<string, string> = {};
            if (testKey) headers["Authorization"] = `Bearer ${testKey}`;
            const r = await fetch(`${testUrl}/models`, { headers, signal: AbortSignal.timeout(5000) });
            if (r.ok) {
              this._post({ type: "customOpenAITestResult", ok: true });
            } else {
              this._post({ type: "customOpenAITestResult", ok: false, error: `HTTP ${r.status}` });
            }
          } catch (e: any) {
            this._post({ type: "customOpenAITestResult", ok: false, error: e.message });
          }
          break;
        }
        case "getWorkspaceFiles": {
          // Return a list of workspace file paths for the @ mention picker
          const uris = await vscode.workspace.findFiles("**/*", "**/node_modules/**", 200);
          const files = uris.map(u => {
            const rel = vscode.workspace.asRelativePath(u);
            return { path: rel, name: rel.split("/").pop() || rel };
          }).sort((a, b) => a.path.localeCompare(b.path));
          this._post({ type: "workspaceFiles", files });
          break;
        }
        case "setModelConfig": {
          // Store user overrides from the editable model config fields
          if (msg.config && typeof msg.config === "object") {
            this._modelConfigOverrides = msg.config;
          }
          break;
        }
      }
    });
  }

  private _modelsRetryCount = 0;
  private _skillsRetryCount = 0;
  private _hitlRetryCount = 0;

  private async _loadModels(forceRefresh = false) {
    try {
      console.log("[thirdwave] _loadModels: fetching registry…");
      const reg = await this._client.registry(forceRefresh);
      console.log(`[thirdwave] _loadModels: got ${reg.local?.length ?? 0} local, ${reg.cloud?.length ?? 0} cloud providers`);
      this._post({ type: "modelsData", registry: reg });
      this._modelsRetryCount = 0; // success — reset
    } catch (err) {
      console.error("[thirdwave] _loadModels FAILED:", err);
      this._post({ type: "modelsData", registry: { local: [], cloud: [], activeModel: "none" } });
      // Keep retrying with back-off (5s, 10s, 15s … max 30s) until server is up
      if (!forceRefresh) {
        this._modelsRetryCount++;
        const delay = Math.min(this._modelsRetryCount * 5000, 30000);
        console.log(`[thirdwave] _loadModels: retry #${this._modelsRetryCount} in ${delay}ms`);
        setTimeout(() => this._loadModels(), delay);
      }
    }
  }
  private async _loadSkills() {
    try {
      console.log("[thirdwave] _loadSkills: fetching skills…");
      const skills = await this._client.listSkills();
      console.log(`[thirdwave] _loadSkills: got ${Array.isArray(skills) ? skills.length : 0} skills`);
      this._post({ type: "skillsData", skills });
      this._skillsRetryCount = 0;
    } catch (err) {
      console.error("[thirdwave] _loadSkills FAILED:", err);
      this._post({ type: "skillsData", skills: [] });
      this._skillsRetryCount++;
      const delay = Math.min(this._skillsRetryCount * 5000, 30000);
      setTimeout(() => this._loadSkills(), delay);
    }
  }
  private _loadSessions() {
    this._sessions = this._restoreSessions();
    this._post({ type: "sessionsData", sessions: this._sessions });
  }
  private async _loadHitl() {
    try {
      const [pending, stats, resolved] = await Promise.all([
        this._client.hitlPending(),
        this._client.hitlStats(),
        this._client.hitlResolved()
      ]);
      this._post({ type: "hitlPending", requests: pending });
      this._post({ type: "hitlStats", stats });
      this._post({ type: "hitlResolved", decisions: resolved });
      this._hitlRetryCount = 0;
    } catch {
      this._post({ type: "hitlPending", requests: [] });
      this._post({ type: "hitlStats", stats: {} });
      this._post({ type: "hitlResolved", decisions: [] });
      this._hitlRetryCount++;
      const delay = Math.min(this._hitlRetryCount * 5000, 30000);
      setTimeout(() => this._loadHitl(), delay);
    }
  }

  // ── HITL active polling during streaming ──────────────────────
  // When the agentic loop is running (directChat in flight), the server
  // may block on HITL approval.  Poll for pending requests every 2s and
  // surface them as a VS Code modal dialog so the user can Allow / Deny.

  private _startHitlPolling() {
    this._stopHitlPolling();
    this._shownHitlIds.clear();
    this._hitlPollTimer = setInterval(() => void this._pollHitlPending(), 2000);
  }

  private _stopHitlPolling() {
    if (this._hitlPollTimer) {
      clearInterval(this._hitlPollTimer);
      this._hitlPollTimer = null;
    }
  }

  private async _pollHitlPending() {
    try {
      const pending = (await this._client.hitlPending()) as any[];
      if (!pending || pending.length === 0) return;

      // Update the sidebar HITL panel
      this._post({ type: "hitlPending", requests: pending });

      for (const req of pending) {
        if (!req.id || this._shownHitlIds.has(req.id)) continue;
        this._shownHitlIds.add(req.id);

        // Post inline notification to the chat webview (resolved by user via inline buttons)
        this._post({
          type: "hitlApprovalNeeded",
          request: {
            id: req.id,
            action: req.action,
            command: req.command,
            filePath: req.filePath,
            url: req.url,
            severity: req.severity || req.riskLevel || "medium",
            riskScore: req.riskScore,
            reasons: req.reasons || [],
            description: req.description,
          },
        });
      }
    } catch {
      // Ignore polling errors (server may be busy)
    }
  }

  private async _onUserMessage(text: string) {
    if (this._isStreaming) return;
    if (!this._currentSessionId) await this.createSession();

    const userMsg: ChatMessage = { role: "user", content: text, timestamp: Date.now() };
    this._history.push(userMsg);
    this._post({ type: "addMessage", message: userMsg });
    // Persist session on first real message (lazy — avoids saving empty sessions)
    if (this._history.length === 1 && this._currentSessionId) {
      const title = text.replace(/\s+/g, " ").trim().substring(0, 60);
      const now = Date.now();
      this._sessions = this._restoreSessions();
      const si = this._sessions.findIndex(s => s.id === this._currentSessionId);
      if (si >= 0) {
        // Session was somehow already persisted — just update title
        this._sessions[si].title = title;
        this._sessions[si].updatedAt = now;
      } else {
        // First message: create & persist the session record now
        this._sessions.unshift({ id: this._currentSessionId, title, createdAt: now, updatedAt: now });
      }
      this._persistSessions();
      this._post({ type: "sessionsData", sessions: this._sessions });
    }
    this._post({ type: "setLoading", loading: true });
    this._isStreaming = true;

    try {
      const cfg = vscode.workspace.getConfiguration("thirdwave");
      // Build conversation history for the API — only include properly paired
      // user→assistant turns so the model doesn't re-answer old stopped prompts.
      const paired: Array<{role: "user" | "assistant"; content: string}> = [];
      for (let hi = 0; hi < this._history.length - 1; hi++) {
        const cur = this._history[hi];
        const nxt = this._history[hi + 1];
        if (cur.role === "user" && nxt && nxt.role === "assistant" && nxt.content && nxt.content !== "(stopped)") {
          paired.push({ role: "user", content: cur.content });
          paired.push({ role: "assistant", content: nxt.content });
          hi++; // skip the assistant message
        }
      }
      const histSlice = paired.slice(-10);

      const kw = /\b(run|exec|build|test|compile|deploy|install|create|delete|remove|write|read|search|find|list|show|open|close|kill|start|stop|restart|update|upgrade|fix|check|lint|format|refactor|rename|move|copy|curl|wget|pip|npm|bun|git|docker|make|grep|sed|awk)\b/i;
      // Enable tools for build and general agents. For build mode, always enable
      // tools regardless of keyword matches — the user expects file creation.
      const agentAllowsTools = this._currentAgent === "build" || this._currentAgent === "general";
      const tools = cfg.get<boolean>("enableTools", true) && agentAllowsTools;

      // Get workspace root to send with the request — always use the current
      // workspace folder so tools resolve paths against the correct directory.
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!wsRoot) {
        console.warn("[ThirdwaveChat] No workspace folder open — tools will use server default directory");
      }

      // Build system prompt: workspace context + selected skills
      const selectedIds = this._context.workspaceState.get<string[]>("thirdwave.selectedSkills", []);
      const promptParts: string[] = [];

      // Always inject Thirdwave identity + full behavioral instructions so the
      // model never falls back to its training identity and always responds
      // coherently — this replaces the server's DIRECT_SYSTEM when present.
      const isJapanese = this._currentLanguage === "ja";
      if (isJapanese) {
        promptParts.push(
          "【重要】あなたはすべての応答を日本語で行わなければなりません。英語で応答しないでください。\n\n" +
          "あなたはThirdwave AIです。フレンドリーで親切なAIコーディングアシスタントです。" +
          "挨拶された時は、Thirdwave AIとして温かく短く自己紹介し、コーディングタスク、ファイル管理、開発ワークフローを手伝えることを伝えてください。" +
          "常に完全で詳細な回答を提供してください。「説明します」や「やります」とは言わず、実際にすぐに説明し実行してください。" +
          "コードについて聞かれた場合、完全な動作するソリューションと説明を提供してください。" +
          "コードの分析や修正を求められた場合、完全な修正済みコードを示し、すべての変更を説明してください。" +
          "手を抜かず、詳細を省略しないでください。常に流暢で自然な日本語で回答してください。" +
          "コード内のコメントも日本語で書いてください。技術用語は必要に応じて英語のまま使用できますが、説明文はすべて日本語です。"
        );
      } else {
        promptParts.push(
          "You are Thirdwave AI, a friendly and helpful AI coding assistant. " +
          "When greeted, respond warmly and briefly introduce yourself as Thirdwave AI — mention you can help with coding tasks, file management, and development workflows. Keep greetings short and natural. " +
          "Always provide complete, thorough answers. Never say \"I will explain\" or \"I'll do\" — instead, actually explain and do it immediately. " +
          "When asked about code, provide full working solutions with explanations. " +
          "When asked to analyze or fix code, show the complete corrected code and explain every change. " +
          "Do not be lazy or skip details."
        );
      }

      // Agent-specific behavioral instructions
      const agentInstructions: Record<string, string> = isJapanese ? {
        build: "あなたはBUILDモードです。完全な読み書き実行アクセスがあります。ツールを使用してファイルを作成し、コマンドを実行し、パッケージをインストールし、コードベースに変更を加えてください。ユーザーが何かを構築するよう求めた場合、実際にすべてのファイルを作成しプロジェクトをセットアップしてください。",
        plan: "あなたはPLANモードです。計画と分析のみを提供してください — コードブロックを出力せず、実装コードを書かず、ツールを使用してファイルを作成したりコマンドを実行したりしないでください。代わりに: 1) タスクを明確なステップに分解 2) ファイル構造とアーキテクチャを説明 3) 各コンポーネントの役割を説明 4) 依存関係と必要な技術を特定 5) ステップバイステップの実装ガイドを提供。",
        explore: "あなたはEXPLOREモードです。読み取り専用のコードベース検索・探索エージェントです。関連コードの検索、コードベースの動作説明、データフローの追跡、既存のコード構造に関する質問への回答に集中してください。",
        general: "あなたはGENERALモードです。マルチステップ推論と汎用アシスタントです。必要に応じてツールを使用できます。複雑なタスクには徹底的な分析と推論を提供してください。",
      } : {
        build: "You are in BUILD mode. You have full read/write/execute access. Use tools to create files, run commands, install packages, and make changes to the codebase. When the user asks you to build something, actually create all the files and set up the project. QUALITY RULES: Always use tools to create files and run commands — never just show code blocks for the user to copy. Before suggesting install commands, verify the current directory and that files exist. Check the OS before suggesting platform-specific packages. If a command fails, diagnose and fix it yourself. Always create proper project structures with all needed config files. Test your code by running it after creation.",
        plan: "You are in PLAN mode. You MUST ONLY provide plans and analysis — NEVER output raw code blocks, NEVER write implementation code, NEVER use tools to create files or run commands. Instead: 1) Break down the task into clear steps 2) Describe the file structure and architecture 3) Explain what each component should do 4) Identify dependencies and technologies needed 5) Provide a step-by-step implementation guide. Even if the user gives a short name like 'xo game' or 'calculator', you must provide a structured plan, NOT the code itself. Present your plan using headings, numbered lists, and descriptions.",
        explore: "You are in EXPLORE mode. You are a read-only codebase search and exploration agent. Focus on finding relevant code, explaining how the codebase works, tracing data flows, and answering questions about the existing code structure.",
        general: "You are in GENERAL mode. You are a multi-step reasoning and general-purpose assistant. You can use tools when needed. Provide thorough analysis and reasoning for complex tasks.",
      };
      const agentInstruction = agentInstructions[this._currentAgent] || agentInstructions.build;
      promptParts.push("## Agent Mode\n" + agentInstruction);

      // Inject workspace context (active file, open files, diagnostics, attachments, repo tree, git)
      const wsContext = await this._workspace.buildFullContextString();
      if (wsContext) {
        promptParts.push("## Current Workspace Context\n" + wsContext);
      }

      // Inject selected skills
      if (selectedIds.length > 0) {
        const skillContents: string[] = [];
        for (const sid of selectedIds) {
          try {
            const sk = await this._client.getSkill(sid);
            if (sk.content) skillContents.push(`## Skill: ${sk.displayName || sk.name}\n${sk.content}`);
          } catch { /* skip unavailable skills */ }
        }
        if (skillContents.length > 0) {
          promptParts.push("## Active Skills\n" + skillContents.join("\n\n---\n\n"));
        }
      }

      const systemPrompt = promptParts.length > 0 ? promptParts.join("\n\n") : undefined;

      // Clear file attachments after building context (one-shot)
      this._workspace.clearAttachments();

      // Send context compaction info to webview so user can see what was sent
      const contextSummary: string[] = [];
      if (wsContext) contextSummary.push("Workspace context: active file, open files, diagnostics");
      const gitInfo = await this._workspace.getGitStatus().catch(() => null);
      if (gitInfo) contextSummary.push(`Git: ${gitInfo.branch} (${gitInfo.changes.length} changes)`);
      if (selectedIds.length > 0) contextSummary.push(`Skills: ${selectedIds.length} active`);
      const ctxLen = systemPrompt ? systemPrompt.length : 0;
      this._post({ type: "contextInfo", summary: contextSummary, charCount: ctxLen, activeSkills: selectedIds });

      // Start streaming — show tokens as they arrive
      this._post({ type: "streamStart" });
      let fullText = "";
      let fullReasoning = "";
      let meta: any = {};
      const startTime = Date.now();
      this._abortController = new AbortController();
      const abortSignal = this._abortController.signal;

      // Use model config overrides if set by user, falling back to VS Code settings
      const effectiveMaxTokens = this._modelConfigOverrides.maxOutputTokens != null && this._modelConfigOverrides.maxOutputTokens > 0
        ? this._modelConfigOverrides.maxOutputTokens
        : cfg.get<number>("maxTokens", 8192);
      const effectiveTemperature = this._modelConfigOverrides.temperature != null
        ? this._modelConfigOverrides.temperature
        : cfg.get<number>("temperature", 0.3);

      try {
        if (tools) {
          // When tools are enabled, use directChat (POST /api/chat) which has
          // the full agentic tool-calling loop. Pass abort signal so stop works.
          // Show a "Working" block so users see the agent is active
          this._post({ type: "streamWorking", phase: "thinking" });
          // Start HITL polling — while directChat blocks, the server may pause
          // on HITL approval. We poll every 2s to surface pending approvals.
          this._startHitlPolling();
          const resp = await this._client.directChat({
            message: text,
            modelID: this._currentModel || undefined,
            system: systemPrompt,
            maxTokens: effectiveMaxTokens,
            temperature: effectiveTemperature,
            history: histSlice.length > 0 ? histSlice : undefined,
            tools,
            workspaceRoot: wsRoot,
            sessionId: this._currentSessionId ?? undefined,
          }, abortSignal);
          fullText = resp.text;
          fullReasoning = resp.reasoning || "";
          meta = { model: resp.model, tokens: resp.tokens, latencyMs: resp.latencyMs, toolCalls: resp.toolCalls };

          // Progressive rendering with async delays so tokens stream visually
          const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
          if (!abortSignal.aborted) {
            // 1. Stream tool call steps so user sees what the agent did
            if (meta.toolCalls && meta.toolCalls.length > 0) {
              for (const tc of meta.toolCalls) {
                if (abortSignal.aborted) break;
                this._post({ type: "streamToolStep", tool: tc.tool, args: tc.args, success: tc.success, result: (tc.result || "").slice(0, 300) });
                await delay(40);
              }
            }
            // 2. Stream reasoning in chunks — show thinking box live
            if (fullReasoning) {
              this._post({ type: "streamThinking", thinking: true });
              const rChunkSize = 20;
              for (let ri = 0; ri < fullReasoning.length; ri += rChunkSize) {
                if (abortSignal.aborted) break;
                this._post({ type: "streamReasoning", content: fullReasoning.slice(ri, ri + rChunkSize) });
                await delay(4);
              }
              this._post({ type: "streamThinking", thinking: false });
            }
            // Mark working block as done — reasoning/tools have been shown
            this._post({ type: "streamWorking", phase: "done" });
            // 3. Stream body text in natural word-boundary chunks
            let ti = 0;
            while (ti < fullText.length && !abortSignal.aborted) {
              // Find next chunk boundary at word/line break for natural feel
              let end = Math.min(ti + 24, fullText.length);
              if (end < fullText.length) {
                // Try to break at space, newline, or punctuation
                const slice = fullText.slice(ti, Math.min(ti + 40, fullText.length));
                const breakAt = slice.lastIndexOf(' ', 24);
                const nlAt = slice.indexOf('\n');
                if (nlAt >= 0 && nlAt < 30) end = ti + nlAt + 1;
                else if (breakAt > 8) end = ti + breakAt + 1;
              }
              this._post({ type: "streamToken", content: fullText.slice(ti, end) });
              ti = end;
              await delay(3);
            }
          }
        } else {
          // No tools — use SSE streaming for real token-by-token UX
          const stream = await this._client.chatStream({
            message: text,
            model: this._currentModel || undefined,
            system: systemPrompt,
            maxTokens: effectiveMaxTokens,
            temperature: effectiveTemperature,
            history: histSlice.length > 0 ? histSlice : undefined,
            tools: false,
            workspaceRoot: wsRoot,
            signal: abortSignal,
          });

          for await (const chunk of stream) {
            if (abortSignal.aborted) break;
            if (chunk.type === "reasoning") {
              fullReasoning += chunk.content;
              this._post({ type: "streamReasoning", content: chunk.content });
            } else if (chunk.type === "text") {
              fullText += chunk.content;
              this._post({ type: "streamToken", content: chunk.content });
            } else if (chunk.type === "done" && chunk.meta) {
              meta = chunk.meta;
            }
          }
        }
      } catch (err: any) {
        // If aborted, treat as user-initiated stop — not an error
        if (abortSignal.aborted) {
          // Clear working indicator if still showing
          this._post({ type: "streamWorking", phase: "done" });
          // Keep whatever text we got so far
        } else {
          // Fallback to non-streaming if stream fails
          try {
            const resp = await this._client.directChat({
              message: text,
              modelID: this._currentModel || undefined,
              system: systemPrompt,
              maxTokens: effectiveMaxTokens,
              temperature: effectiveTemperature,
              history: histSlice.length > 0 ? histSlice : undefined,
              tools,
              workspaceRoot: wsRoot,
              sessionId: this._currentSessionId ?? undefined,
            });
            fullText = resp.text;
            fullReasoning = resp.reasoning || "";
            meta = { model: resp.model, tokens: resp.tokens, latencyMs: resp.latencyMs, toolCalls: resp.toolCalls };
          } catch (e2: any) {
            throw e2;
          }
        }
      }

      const latency = meta.latencyMs || (Date.now() - startTime);
      // Only add to history if we got any content
      // Always produce a visible assistant message — never silently end the stream
      const displayText = fullText
        || fullReasoning
        || (meta.toolCalls?.length > 0 ? "(Tool calls completed — see results above)" : "");
      if (displayText) {
        const aMsg: ChatMessage = {
          role: "assistant", content: fullText || displayText, reasoning: fullReasoning || undefined,
          toolCalls: meta.toolCalls, tokens: meta.tokens, latencyMs: latency,
          model: meta.model, timestamp: Date.now(),
        };
        this._history.push(aMsg);
        this._post({ type: "streamEnd", message: aMsg });
      } else {
        // Model returned absolutely nothing — show a helpful fallback
        const fallback: ChatMessage = {
          role: "assistant",
          content: "The model returned an empty response. This can happen when:\n- The model is overloaded or timed out\n- The request was too complex for the model\n- A security policy blocked the action\n\nTry rephrasing your request or switching to a different model.",
          tokens: meta.tokens, latencyMs: latency, model: meta.model, timestamp: Date.now(),
        };
        this._history.push(fallback);
        this._post({ type: "streamEnd", message: fallback });
      }
      // Persist chat history locally so it survives session switching
      if (this._currentSessionId) {
        this._saveSessionHistory(this._currentSessionId, this._history);
        this._sessions = this._restoreSessions();
        const si = this._sessions.findIndex(s => s.id === this._currentSessionId);
        if (si >= 0) { this._sessions[si].updatedAt = Date.now(); this._persistSessions(); }
      }
    } catch (e: any) {
      this._post({ type: "streamWorking", phase: "done" });
      this._post({ type: "streamEnd" });
      // Don't show error for user-initiated abort
      if (e.name !== "AbortError") {
        const friendlyError = this._formatErrorMessage(e.message ?? String(e));
        this._post({ type: "addMessage", message: { role: "system" as const, content: `Error: ${friendlyError}`, timestamp: Date.now() } });
      }
    } finally {
      this._stopHitlPolling();
      this._isStreaming = false;
      this._abortController = null;
      this._post({ type: "setLoading", loading: false });
      // Refresh HITL panel after streaming ends
      this._loadHitl();
    }
  }

  /** Parse raw API error messages into user-friendly text */
  private _formatErrorMessage(raw: string): string {
    // Try to extract JSON body from error format: "METHOD /path: STATUS — {json}"
    const jsonMatch = raw.match(/:\s*(\d{3})\s*[—–-]\s*(\{[\s\S]+\})\s*$/);
    if (jsonMatch) {
      const status = parseInt(jsonMatch[1], 10);
      try {
        const body = JSON.parse(jsonMatch[2]);
        // 403 — Model access denied (gateway ACL)
        if (status === 403 && body.error && /model access denied/i.test(body.error)) {
          const modelName = body.model || "the selected model";
          return `⚠️ Model Access Denied — "${modelName}" is not available with your current API key. Try switching to a different model in the model selector above.`;
        }
        // 403 — Policy violation
        if (status === 403 && body.error === "Policy violation") {
          const reasons = Array.isArray(body.reasons) ? body.reasons.join(", ") : (body.reasons || "security policy");
          return `🛡️ Request Blocked — Your message was blocked by a security policy: ${reasons}`;
        }
        // 429 — Rate limit
        if (status === 429) {
          return `⏳ Rate Limited — Too many requests. Please wait a moment and try again.`;
        }
        // 502/503 — Gateway unavailable
        if (status === 502 || status === 503) {
          return `🔌 Service Unavailable — The model provider is temporarily unavailable. Please try again in a few seconds.`;
        }
        // Generic with parsed error field
        if (body.error) {
          return body.error;
        }
      } catch { /* JSON parse failed, fall through */ }
    }
    // Network / fetch errors
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(raw)) {
      return `🔌 Connection Failed — Cannot reach the backend server. Please check that the server is running.`;
    }
    // Fallback: return raw message
    return raw;
  }

  private _post(msg: unknown) { this._view?.webview.postMessage(msg); }

  // ═══════════════════════════════════════════════════════════════
  // Webview HTML — uses external media/chat.js and media/chat.css
  // ═══════════════════════════════════════════════════════════════

  private _html(wv: vscode.Webview): string {
    const n = getNonce();
    const cssUri = wv.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "chat.css"));
    const jsUri  = wv.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "chat.js"));
    const logoUri = wv.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "images", "agent-logo.png"));
    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${wv.cspSource}; script-src ${wv.cspSource} 'nonce-${n}'; img-src ${wv.cspSource} https:;">
<link rel="stylesheet" href="${cssUri}">
</head>
<body>
<div class="layout">

  <!-- TOP HEADER BAR -->
  <div class="topbar">
    <span class="topbar-title" id="topbarTitle">CHAT</span>
    <div class="topbar-actions">
      <button class="tb-icon" id="newBtn" title="New Chat"><svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg></button>
      <button class="tb-icon" id="histBtn" data-tab="sessions" title="History"><svg viewBox="0 0 24 24"><path d="M13 3a9 9 0 00-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0013 21a9 9 0 000-18zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg></button>
      <button class="tb-icon" id="settingsBtn" title="Settings"><svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1115.6 12 3.611 3.611 0 0112 15.6z"/></svg></button>
    </div>
  </div>

  <!-- MAIN BODY — chat + optional right sidebar -->
  <div class="body">

    <!-- CHAT (always visible) -->
    <div class="chat-area" id="chatArea">
      <div class="msgs" id="msgs">
        <div class="es" id="es">
          <img class="lg" src="${logoUri}" alt="Thirdwave AI" />
          <h3>Thirdwave AI</h3>
          <p data-i18n="emptyDesc">AI coding assistant powered by local vLLM gateway.</p>
          <button class="wb" id="startBtn" data-i18n="startConversation">Start a conversation</button>
        </div>
      </div>
      <div class="ld" id="ld"><div class="spn"></div><span data-i18n="thinking">Thinking...</span></div>
      <div class="ia">
        <div id="attachBar" class="attach-bar" style="display:none"></div>
        <div class="ir">
          <button class="attach-btn" id="attachBtn" title="Attach files"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 015 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6h-1.5v9.5a2.5 2.5 0 005 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg></button>
          <textarea id="inp" data-i18n-placeholder="inputPlaceholder" placeholder="Type your task here..." rows="1"></textarea>
          <button class="sb-send" id="snd"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>
        </div>
        <div class="it">
          <button class="it-btn" id="agBtn" title="Agent mode"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg><span class="it-lbl" id="agLbl">build</span></button>
          <button class="it-btn" id="mdBtn" title="Active model"><svg viewBox="0 0 24 24"><path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/></svg><span class="it-lbl" id="mdLbl">loading...</span></button>
          <span class="it-sep"></span>
          <button class="it-btn" id="diagBtn" title="Show diagnostics"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg><span class="it-lbl" id="diagLbl">0</span></button>
          <div class="active-skills-bar" id="activeSkillsBar" style="display:none"></div>
        </div>
      </div>
    </div>

    <!-- HISTORY PANEL (overlay, toggled by history button) -->
    <div class="pnl-overlay" id="p-sessions">
      <div class="pnl-hdr"><button class="pnl-close" data-close="sessions">&times;</button></div>
      <div class="scr" id="seC"><div class="nd">Loading sessions...</div></div>
    </div>

    <!-- RIGHT SIDEBAR (toggled by settings button) -->
    <div class="rsidebar" id="rsidebar">
      <div class="rs-icons">
        <button class="rs-icon active" data-rs="settings" title="Models"><svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.57 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1115.6 12 3.611 3.611 0 0112 15.6z"/></svg></button>
        <button class="rs-icon" data-rs="agents" title="Agents"><svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg></button>
        <button class="rs-icon" data-rs="skills" title="Skills"><svg viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg></button>
        <button class="rs-icon" data-rs="hitl" title="HITL"><svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg><span class="rs-badge" style="display:none">0</span></button>
      </div>
      <div class="rs-content">

      <!-- MODELS / SETTINGS -->
      <div class="rs-pnl active" id="rp-settings">
        <div class="scr" id="setScr">
          <div class="sec">
            <div class="st" data-i18n="theme">Theme</div>
            <div class="theme-picker" id="themePicker">
              <button class="theme-btn sel" data-theme="">VS Code</button>
              <button class="theme-btn" data-theme="vscode-light">VS Code Light</button>
              <button class="theme-btn" data-theme="electric">Electric B&W</button>
              <button class="theme-btn" data-theme="electric-light">Electric Light</button>
            </div>
          </div>
          <div class="sec">
            <div class="st" data-i18n="language">Language</div>
            <div class="lang-picker" id="langPicker">
              <button class="lang-btn sel" data-lang="en">English</button>
              <button class="lang-btn" data-lang="ja">日本語</button>
            </div>
          </div>
          <div class="sec">
            <div class="st" style="display:flex;align-items:center;justify-content:space-between;" data-i18n="gatewayModels">Gateway Models (Local)<button id="refreshModelsBtn" title="Refresh models & token limits" style="background:none;border:1px solid var(--vscode-button-border,#555);color:var(--vscode-foreground);cursor:pointer;padding:2px 8px;border-radius:4px;font-size:11px;display:inline-flex;align-items:center;gap:4px;">&#x21bb; Refresh</button></div>
            <div id="lcm"><div class="nd">Loading...</div></div>
          </div>
          <div class="sec">
            <div class="st" data-i18n="agentSideConfig">AGENT SIDE MODEL CONFIGURATIONS</div>
            <div id="ccm">
              <div class="cline-api">
                <label class="cline-lbl" data-i18n="apiProvider">API Provider</label>
                <select class="cline-select" id="cpSelect"><option value="" data-i18n="loading">Loading...</option></select>
              </div>
              <div id="cpDetail"><div class="nd" data-i18n="selectProvider">Select a provider above</div></div>
            </div>
          </div>
          <div class="sec">
            <div class="st" data-i18n="openaiCompatible">OpenAI Compatible</div>
            <div id="customOpenAI" class="cline-api">
              <div class="cl-section">
                <label class="cl-field-lbl" data-i18n="baseUrl">Base URL</label>
                <input class="cl-key-inp" id="coBaseUrl" type="text" placeholder="http://localhost:11434/v1" data-i18n-placeholder="enterBaseUrl" />
              </div>
              <div class="cl-section">
                <label class="cl-field-lbl" data-i18n="apiKey">API Key</label>
                <input class="cl-key-inp" id="coApiKey" type="password" placeholder="sk-..." data-i18n-placeholder="enterApiKey" />
              </div>
              <div class="cl-section">
                <label class="cl-field-lbl" data-i18n="modelIdLabel">Model ID</label>
                <input class="cl-key-inp" id="coModelId" type="text" placeholder="Enter model ID..." data-i18n-placeholder="enterModelId" />
              </div>
              <div class="cl-section co-actions">
                <button class="cl-save-btn" id="coSaveBtn" data-i18n="saveConfig">Save</button>
                <button class="cl-get-key-btn" id="coTestBtn" data-i18n="testConnection">Test</button>
              </div>
              <div class="cl-note co-status" id="coStatus"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- AGENTS -->
      <div class="rs-pnl" id="rp-agents">
        <div class="scr">
          <div class="sec">
            <div class="st" data-i18n="primaryAgents">Primary Agents</div>
            <div id="primaryAgents">
              <div class="ag-card sel" data-ag="build">
                <div class="ag-hdr"><svg viewBox="0 0 24 24" class="ag-ico"><path d="M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z"/></svg><span class="ag-name">Build</span></div>
                <div class="ag-desc" data-i18n="agBuildDesc">Full read/write/execute — default coding agent with tool calling</div>
              </div>
              <div class="ag-card" data-ag="plan">
                <div class="ag-hdr"><svg viewBox="0 0 24 24" class="ag-ico"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg><span class="ag-name">Plan</span></div>
                <div class="ag-desc" data-i18n="agPlanDesc">Read-only planning and architectural analysis</div>
              </div>
            </div>
          </div>
          <div class="sec">
            <div class="st" data-i18n="subAgents">Sub-Agents</div>
            <div id="subAgents">
              <div class="ag-card" data-ag="explore">
                <div class="ag-hdr"><svg viewBox="0 0 24 24" class="ag-ico"><path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg><span class="ag-name">Explore</span></div>
                <div class="ag-desc" data-i18n="agExploreDesc">Codebase search and exploration — read-only discovery</div>
              </div>
              <div class="ag-card" data-ag="general">
                <div class="ag-hdr"><svg viewBox="0 0 24 24" class="ag-ico"><path d="M9 21c0 .5.4 1 1 1h4c.6 0 1-.5 1-1v-1H9v1zm3-19C8.1 2 5 5.1 5 9c0 2.4 1.2 4.5 3 5.7V17c0 .5.4 1 1 1h6c.6 0 1-.5 1-1v-2.3c1.8-1.3 3-3.4 3-5.7 0-3.9-3.1-7-7-7z"/></svg><span class="ag-name">General</span></div>
                <div class="ag-desc" data-i18n="agGeneralDesc">Multi-step reasoning, research, and general tasks</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- SKILLS -->
      <div class="rs-pnl" id="rp-skills">
        <div class="sk-hdr">
          <span class="st" style="margin:0" data-i18n="skillsRegistry">SKILLS REGISTRY</span>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
            <span class="sk-cnt" id="skCnt">0</span>
            <button class="sk-clear" id="skClear" data-i18n="clearAll">Clear all</button>
          </div>
        </div>
        <div class="ssr"><input type="text" id="skQ" data-i18n-placeholder="filterSkills" placeholder="Filter skills..." /></div>
        <div class="sks" id="skC"><div class="nd">Loading skills...</div></div>
      </div>

      <!-- HITL SECURITY -->
      <div class="rs-pnl" id="rp-hitl">
        <div class="scr">
          <div class="sec">
            <div class="st" data-i18n="pendingApprovals">Pending Approvals</div>
            <div id="hitlPending"><div class="nd">No pending approvals</div></div>
          </div>
          <div class="sec">
            <div class="st" data-i18n="statistics">Statistics</div>
            <div id="hitlStats"><div class="nd">Loading...</div></div>
          </div>
          <div class="sec">
            <div class="st" data-i18n="recentDecisions">Recent Decisions</div>
            <div id="hitlRecent"><div class="nd">No recent decisions</div></div>
          </div>
        </div>
      </div>
      </div><!-- /rs-content -->
    </div><!-- /rsidebar -->

  </div><!-- /body -->
</div><!-- /layout -->

<script nonce="${n}" src="${jsUri}"></script>
</body></html>`;
  }
}

function getNonce(): string {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let n = "";
  for (let i = 0; i < 32; i++) n += c.charAt(Math.floor(Math.random() * c.length));
  return n;
}
