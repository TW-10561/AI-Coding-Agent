"use strict";
// ---------------------------------------------------------------------------
// Thirdwave AI — Inline Completion Provider
// Provides AI-powered inline code suggestions as-you-type using the
// /api/chat/stream endpoint in quick mode (0 tool rounds).
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
exports.InlineCompletionProvider = void 0;
const vscode = __importStar(require("vscode"));
/** Maximum characters to capture as prefix context (before cursor) */
const MAX_PREFIX_CHARS = 1500;
/** Maximum characters to capture as suffix context (after cursor) */
const MAX_SUFFIX_CHARS = 500;
/** Minimum characters typed before triggering completions */
const MIN_TRIGGER_CHARS = 3;
/** Debounce delay in ms — avoid spamming the API on every keystroke */
const DEBOUNCE_MS = 600;
class InlineCompletionProvider {
    _client;
    _debounceTimer = null;
    _lastRequest = "";
    constructor(client) {
        this._client = client;
    }
    updateClient(client) {
        this._client = client;
    }
    async provideInlineCompletionItems(document, position, _context, token) {
        const cfg = vscode.workspace.getConfiguration("thirdwave");
        if (!cfg.get("enableInlineCompletion", true))
            return null;
        // Don't trigger if the cursor is at the start or line is too short
        const lineText = document.lineAt(position.line).text;
        const textBeforeCursor = lineText.substring(0, position.character);
        if (textBeforeCursor.trim().length < MIN_TRIGGER_CHARS)
            return null;
        // Build prefix: content from start of document up to cursor
        const docStart = new vscode.Position(0, 0);
        const prefix = document.getText(new vscode.Range(docStart, position));
        const truncatedPrefix = prefix.length > MAX_PREFIX_CHARS
            ? "...\n" + prefix.slice(-MAX_PREFIX_CHARS)
            : prefix;
        // Build suffix: content from cursor to end (limited)
        const docEnd = document.positionAt(document.getText().length);
        const suffixRaw = document.getText(new vscode.Range(position, docEnd));
        const suffix = suffixRaw.slice(0, MAX_SUFFIX_CHARS);
        const requestKey = `${document.uri}:${position.line}:${position.character}:${textBeforeCursor}`;
        if (requestKey === this._lastRequest)
            return null;
        this._lastRequest = requestKey;
        // Debounce — cancel if user types again quickly
        if (this._debounceTimer)
            clearTimeout(this._debounceTimer);
        return new Promise((resolve) => {
            this._debounceTimer = setTimeout(async () => {
                if (token.isCancellationRequested) {
                    resolve(null);
                    return;
                }
                try {
                    const lang = document.languageId;
                    const fileName = document.fileName.split("/").pop() || "file";
                    const model = cfg.get("defaultModel", "");
                    // Construct a fill-in-the-middle style prompt
                    const prompt = `You are an expert ${lang} developer. Complete the code at the cursor position.\n` +
                        `File: ${fileName}\n` +
                        `Language: ${lang}\n\n` +
                        `<prefix>\n${truncatedPrefix}\n</prefix>\n` +
                        (suffix ? `<suffix>\n${suffix}\n</suffix>\n` : "") +
                        `\nComplete only what goes at the cursor. Output ONLY the completion text, no explanations, no markdown fences, no repeated context. Keep it concise (1-5 lines unless clearly more is needed).`;
                    // Use the /api/chat/direct endpoint (fast, no tools, no streaming overhead)
                    const resp = await this._client.directChat({
                        message: prompt,
                        modelID: model || undefined,
                        maxTokens: 256,
                        temperature: 0.15, // Low temperature for deterministic completions
                        tools: false,
                    });
                    if (token.isCancellationRequested) {
                        resolve(null);
                        return;
                    }
                    let completion = resp.text?.trim();
                    if (!completion) {
                        resolve(null);
                        return;
                    }
                    // Strip common unwanted prefixes (e.g. model repeating the prefix)
                    if (completion.startsWith(textBeforeCursor.trim())) {
                        completion = completion.slice(textBeforeCursor.trim().length).trimStart();
                    }
                    // Ensure we don't insert something that duplicates what's already on the line after cursor
                    if (suffix && completion.endsWith(suffix.split("\n")[0])) {
                        completion = completion.slice(0, completion.length - suffix.split("\n")[0].length);
                    }
                    if (!completion) {
                        resolve(null);
                        return;
                    }
                    resolve(new vscode.InlineCompletionList([
                        new vscode.InlineCompletionItem(completion, new vscode.Range(position, position)),
                    ]));
                }
                catch {
                    resolve(null); // Silently fail — don't interrupt coding workflow
                }
            }, DEBOUNCE_MS);
        });
    }
}
exports.InlineCompletionProvider = InlineCompletionProvider;
//# sourceMappingURL=InlineCompletionProvider.js.map