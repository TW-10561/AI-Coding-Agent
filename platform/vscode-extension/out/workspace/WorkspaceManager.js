"use strict";
// ---------------------------------------------------------------------------
// WorkspaceManager — Tracks workspace state, open files, diagnostics, and
// provides project context for chat messages. Independent of OpenCode SDK.
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
exports.WorkspaceManager = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
class WorkspaceManager {
    _disposables = [];
    _recentChanges = [];
    _attachedFiles = [];
    _onDidChange = new vscode.EventEmitter();
    onDidChange = this._onDidChange.event;
    constructor() {
        // Track active editor changes
        this._disposables.push(vscode.window.onDidChangeActiveTextEditor(() => this._onDidChange.fire()), vscode.window.onDidChangeTextEditorSelection(() => this._onDidChange.fire()));
        // Track file saves as recent changes
        this._disposables.push(vscode.workspace.onDidSaveTextDocument((doc) => {
            const rel = this._relativePath(doc.uri);
            if (rel) {
                this._recentChanges = [rel, ...this._recentChanges.filter((f) => f !== rel)].slice(0, 10);
                this._onDidChange.fire();
            }
        }));
        // Track file creation/deletion
        this._disposables.push(vscode.workspace.onDidCreateFiles((e) => {
            for (const f of e.files) {
                const rel = this._relativePath(f);
                if (rel)
                    this._recentChanges = [rel, ...this._recentChanges.filter((r) => r !== rel)].slice(0, 10);
            }
            this._onDidChange.fire();
        }), vscode.workspace.onDidDeleteFiles(() => this._onDidChange.fire()));
    }
    /** Get current workspace context snapshot */
    getContext() {
        const roots = (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
        const editor = vscode.window.activeTextEditor;
        let activeFile;
        let activeLanguage;
        let selection;
        if (editor && editor.document.uri.scheme === "file") {
            activeFile = this._relativePath(editor.document.uri);
            activeLanguage = editor.document.languageId;
            const sel = editor.document.getText(editor.selection);
            if (sel.trim().length > 0) {
                selection = sel.trim().substring(0, 500);
            }
        }
        // Open files (visible editors)
        const openFiles = [];
        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                const input = tab.input;
                if (input && typeof input === "object" && "uri" in input) {
                    const rel = this._relativePath(input.uri);
                    if (rel && !openFiles.includes(rel))
                        openFiles.push(rel);
                }
            }
        }
        return {
            roots,
            activeFile,
            activeLanguage,
            selection,
            openFiles: openFiles.slice(0, 10),
            recentChanges: this._recentChanges.slice(0, 5),
            diagnostics: this.getDiagnostics(),
        };
    }
    /** Get current diagnostics summary from VS Code */
    getDiagnostics() {
        let errorCount = 0;
        let warningCount = 0;
        const entries = [];
        const allDiags = vscode.languages.getDiagnostics();
        for (const [uri, diags] of allDiags) {
            if (uri.scheme !== "file")
                continue;
            const rel = this._relativePath(uri) || uri.fsPath;
            let fileEntries = 0;
            for (const d of diags) {
                if (d.severity === vscode.DiagnosticSeverity.Error) {
                    errorCount++;
                    if (entries.length < 15 && fileEntries < 3) {
                        entries.push({ file: rel, severity: "error", line: d.range.start.line + 1, message: d.message, source: d.source });
                        fileEntries++;
                    }
                }
                else if (d.severity === vscode.DiagnosticSeverity.Warning) {
                    warningCount++;
                    if (entries.length < 15 && fileEntries < 3) {
                        entries.push({ file: rel, severity: "warning", line: d.range.start.line + 1, message: d.message, source: d.source });
                        fileEntries++;
                    }
                }
            }
        }
        return { errorCount, warningCount, entries };
    }
    /** Build a workspace context string for the system prompt */
    buildContextString() {
        const ctx = this.getContext();
        const parts = [];
        if (ctx.roots.length > 0) {
            parts.push(`Workspace: ${ctx.roots.map((r) => path.basename(r)).join(", ")}`);
        }
        if (ctx.activeFile) {
            parts.push(`Active file: ${ctx.activeFile}` + (ctx.activeLanguage ? ` (${ctx.activeLanguage})` : ""));
        }
        if (ctx.selection) {
            parts.push(`Selected text:\n\`\`\`\n${ctx.selection}\n\`\`\``);
        }
        if (ctx.openFiles.length > 0) {
            parts.push(`Open files: ${ctx.openFiles.join(", ")}`);
        }
        if (ctx.recentChanges.length > 0) {
            parts.push(`Recent changes: ${ctx.recentChanges.join(", ")}`);
        }
        if (ctx.diagnostics.errorCount > 0 || ctx.diagnostics.warningCount > 0) {
            parts.push(`Diagnostics: ${ctx.diagnostics.errorCount} errors, ${ctx.diagnostics.warningCount} warnings`);
            for (const e of ctx.diagnostics.entries.slice(0, 8)) {
                parts.push(`  ${e.severity.toUpperCase()} ${e.file}:${e.line} — ${e.message}${e.source ? ` [${e.source}]` : ""}`);
            }
        }
        // Attached files
        if (this._attachedFiles.length > 0) {
            parts.push("Attached files:");
            for (const f of this._attachedFiles) {
                parts.push(`--- ${f.relativePath} (${f.language}) ---\n\`\`\`${f.language}\n${f.content}\n\`\`\``);
            }
        }
        return parts.join("\n");
    }
    /** Attach a file for the next chat message */
    attachFile(file) {
        // Replace if same path already attached
        this._attachedFiles = this._attachedFiles.filter((f) => f.relativePath !== file.relativePath);
        this._attachedFiles.push(file);
    }
    /** Remove an attached file */
    removeAttachment(relativePath) {
        this._attachedFiles = this._attachedFiles.filter((f) => f.relativePath !== relativePath);
    }
    /** Clear all attachments (typically after sending a message) */
    clearAttachments() {
        this._attachedFiles = [];
    }
    /** Get current attachments */
    getAttachments() {
        return [...this._attachedFiles];
    }
    /** Read a file from workspace by relative or absolute path */
    async readFile(filePath) {
        try {
            const roots = vscode.workspace.workspaceFolders || [];
            let uri;
            if (path.isAbsolute(filePath)) {
                uri = vscode.Uri.file(filePath);
            }
            else if (roots.length > 0) {
                uri = vscode.Uri.joinPath(roots[0].uri, filePath);
            }
            if (!uri)
                return null;
            const content = (await vscode.workspace.fs.readFile(uri)).toString();
            const rel = this._relativePath(uri) || filePath;
            const lang = this._guessLanguage(rel);
            return { name: path.basename(rel), relativePath: rel, language: lang, content: content.substring(0, 50000), size: content.length };
        }
        catch {
            return null;
        }
    }
    /** Open a file-picker dialog and attach selected files */
    async pickAndAttachFiles() {
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: true,
            openLabel: "Attach",
            filters: {
                "All Files": ["*"],
                "Code": ["ts", "js", "py", "rs", "go", "java", "c", "cpp", "h", "css", "html", "json", "yaml", "yml", "toml", "md", "txt", "sh"],
            },
        });
        if (!uris || uris.length === 0)
            return [];
        const attached = [];
        for (const uri of uris) {
            try {
                const raw = await vscode.workspace.fs.readFile(uri);
                const content = Buffer.from(raw).toString("utf-8");
                const rel = this._relativePath(uri) || path.basename(uri.fsPath);
                const lang = this._guessLanguage(rel);
                const file = { name: path.basename(rel), relativePath: rel, language: lang, content: content.substring(0, 50000), size: content.length };
                this.attachFile(file);
                attached.push(file);
            }
            catch { /* skip unreadable */ }
        }
        return attached;
    }
    _relativePath(uri) {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders)
            return undefined;
        for (const f of folders) {
            if (uri.fsPath.startsWith(f.uri.fsPath)) {
                return path.relative(f.uri.fsPath, uri.fsPath);
            }
        }
        return undefined;
    }
    _guessLanguage(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const map = {
            ".ts": "typescript", ".tsx": "typescriptreact", ".js": "javascript", ".jsx": "javascriptreact",
            ".py": "python", ".rs": "rust", ".go": "go", ".java": "java", ".c": "c", ".cpp": "cpp",
            ".h": "c", ".hpp": "cpp", ".css": "css", ".html": "html", ".json": "json",
            ".yaml": "yaml", ".yml": "yaml", ".toml": "toml", ".md": "markdown",
            ".sh": "shellscript", ".bash": "shellscript", ".sql": "sql", ".txt": "plaintext",
        };
        return map[ext] || "plaintext";
    }
    dispose() {
        this._disposables.forEach((d) => d.dispose());
        this._onDidChange.dispose();
    }
}
exports.WorkspaceManager = WorkspaceManager;
//# sourceMappingURL=WorkspaceManager.js.map