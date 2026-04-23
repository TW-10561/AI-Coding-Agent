"use strict";
// ---------------------------------------------------------------------------
// DiffPanel — side-by-side diff panel for inline completion proposals
//
// Usage:
//   DiffPanel.show(context, original, proposed, filePath, onAccept, onEdit)
//
// Shows a webview with:
//   - Left pane: original text (with removed lines highlighted)
//   - Right pane: proposed text (with added lines highlighted)
//   - Accept button → calls onAccept(proposed)
//   - Reject button → closes the panel
//   - Edit button → opens the proposed text in a new untitled editor
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
exports.DiffPanel = void 0;
const vscode = __importStar(require("vscode"));
class DiffPanel {
    static _current;
    _panel;
    _opts;
    _disposed = false;
    constructor(panel, opts) {
        this._panel = panel;
        this._opts = opts;
        this._panel.webview.html = this._buildHtml();
        this._panel.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case "accept":
                    await opts.onAccept(opts.proposed);
                    this.dispose();
                    break;
                case "reject":
                    this.dispose();
                    break;
                case "edit":
                    if (opts.onEdit) {
                        await opts.onEdit(opts.proposed);
                    }
                    else {
                        const doc = await vscode.workspace.openTextDocument({
                            content: opts.proposed,
                            language: this._languageId(opts.filePath),
                        });
                        await vscode.window.showTextDocument(doc, { preview: false });
                    }
                    this.dispose();
                    break;
            }
        });
        this._panel.onDidDispose(() => {
            this._disposed = true;
            DiffPanel._current = undefined;
        });
    }
    /** Open (or replace) the diff panel */
    static show(context, opts) {
        if (DiffPanel._current && !DiffPanel._current._disposed) {
            DiffPanel._current.dispose();
        }
        const panel = vscode.window.createWebviewPanel("thirdwave.diffPanel", `Diff — ${opts.filePath.split("/").pop() ?? "file"}`, vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: false });
        DiffPanel._current = new DiffPanel(panel, opts);
        return DiffPanel._current;
    }
    dispose() {
        if (!this._disposed) {
            this._disposed = true;
            this._panel.dispose();
            DiffPanel._current = undefined;
        }
    }
    _languageId(filePath) {
        const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
        const map = {
            ts: "typescript", tsx: "typescriptreact",
            js: "javascript", jsx: "javascriptreact",
            py: "python", go: "go", rs: "rust",
            java: "java", cs: "csharp", cpp: "cpp", c: "c",
            json: "json", yaml: "yaml", yml: "yaml",
            md: "markdown", sh: "shellscript",
        };
        return map[ext] ?? "plaintext";
    }
    _buildHtml() {
        const nonce = getNonce();
        const { original, proposed, filePath } = this._opts;
        const { leftLines, rightLines } = buildDiff(original, proposed);
        const renderLines = (lines) => lines
            .map((l) => {
            const cls = l.type === "added"
                ? "added"
                : l.type === "removed"
                    ? "removed"
                    : "context";
            const prefix = l.type === "added" ? "+" : l.type === "removed" ? "−" : " ";
            const escaped = escapeHtml(l.text);
            return `<div class="line ${cls}"><span class="gutter">${prefix}</span><span class="code">${escaped}</span></div>`;
        })
            .join("");
        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Diff</title>
<style nonce="${nonce}">
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
  header { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  header .title { font-size: 0.85rem; font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; cursor: pointer; font-size: 12px; padding: 4px 12px; }
  .btn-accept { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-accept:hover { background: var(--vscode-button-hoverBackground); }
  .btn-edit { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .btn-edit:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .btn-reject { background: transparent; color: var(--vscode-errorForeground, #f44); border-color: var(--vscode-errorForeground, #f44); }
  .diff-wrap { display: flex; flex: 1; overflow: hidden; }
  .pane { flex: 1; overflow: auto; }
  .pane-header { padding: 4px 8px; font-size: 11px; font-weight: 600; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-panel-border); position: sticky; top: 0; z-index: 1; }
  .pane + .pane { border-left: 1px solid var(--vscode-panel-border); }
  .line { display: flex; min-height: 18px; }
  .line:hover { background: var(--vscode-list-hoverBackground); }
  .gutter { width: 18px; flex-shrink: 0; text-align: center; opacity: 0.6; }
  .code { white-space: pre; tab-size: 2; }
  .added { background: rgba(0,200,80,0.12); }
  .removed { background: rgba(255,60,60,0.12); }
  .context { }
</style>
</head>
<body>
<header>
  <span class="title">Proposed changes — ${escapeHtml(filePath.split("/").pop() ?? filePath)}</span>
  <button class="btn-reject" id="btnReject">✕ Reject</button>
  <button class="btn-edit" id="btnEdit">✎ Edit</button>
  <button class="btn-accept" id="btnAccept">✓ Accept</button>
</header>
<div class="diff-wrap">
  <div class="pane">
    <div class="pane-header">Original</div>
    ${renderLines(leftLines)}
  </div>
  <div class="pane">
    <div class="pane-header">Proposed</div>
    ${renderLines(rightLines)}
  </div>
</div>
<script nonce="${nonce}">
  const vs = acquireVsCodeApi();
  document.getElementById('btnAccept').addEventListener('click', function() { vs.postMessage({ type: 'accept' }); });
  document.getElementById('btnReject').addEventListener('click', function() { vs.postMessage({ type: 'reject' }); });
  document.getElementById('btnEdit').addEventListener('click', function() { vs.postMessage({ type: 'edit' }); });
</script>
</body>
</html>`;
    }
}
exports.DiffPanel = DiffPanel;
function buildDiff(original, proposed) {
    const origLines = original.split("\n");
    const propLines = proposed.split("\n");
    // LCS-based diff (simple patience-like for short inputs, direct for larger)
    const lcs = computeLCS(origLines, propLines);
    const leftLines = [];
    const rightLines = [];
    let oi = 0, pi = 0;
    for (const [lo, lp] of lcs) {
        while (oi < lo) {
            leftLines.push({ type: "removed", text: origLines[oi++] });
            rightLines.push({ type: "context", text: "" });
        }
        while (pi < lp) {
            leftLines.push({ type: "context", text: "" });
            rightLines.push({ type: "added", text: propLines[pi++] });
        }
        leftLines.push({ type: "context", text: origLines[oi++] });
        rightLines.push({ type: "context", text: propLines[pi++] });
    }
    while (oi < origLines.length) {
        leftLines.push({ type: "removed", text: origLines[oi++] });
        rightLines.push({ type: "context", text: "" });
    }
    while (pi < propLines.length) {
        leftLines.push({ type: "context", text: "" });
        rightLines.push({ type: "added", text: propLines[pi++] });
    }
    return { leftLines, rightLines };
}
function computeLCS(a, b) {
    // Cap at 300 lines each to keep it snappy
    const A = a.slice(0, 300);
    const B = b.slice(0, 300);
    const m = A.length, n = B.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = A[i - 1] === B[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
    }
    const result = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
        if (A[i - 1] === B[j - 1]) {
            result.unshift([i - 1, j - 1]);
            i--;
            j--;
        }
        else if (dp[i - 1][j] > dp[i][j - 1])
            i--;
        else
            j--;
    }
    return result;
}
function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function getNonce() {
    const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let n = "";
    for (let i = 0; i < 32; i++)
        n += c.charAt(Math.floor(Math.random() * c.length));
    return n;
}
//# sourceMappingURL=DiffPanel.js.map