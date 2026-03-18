"use strict";
// ---------------------------------------------------------------------------
// Thirdwave Chat Participant — integrates into VS Code's native Chat panel
// Users can type @thirdwave in the Chat panel (like @copilot).
// Slash commands: /explain, /fix, /test, /review, /models, /skills
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
exports.registerChatParticipant = registerChatParticipant;
const vscode = __importStar(require("vscode"));
const PARTICIPANT_ID = "thirdwave.chat.participant";
function registerChatParticipant(context, getClient) {
    const participant = vscode.chat.createChatParticipant(PARTICIPANT_ID, async (request, chatContext, stream, token) => {
        const client = getClient();
        const config = vscode.workspace.getConfiguration("thirdwave");
        const model = config.get("defaultModel", "");
        const agent = config.get("defaultAgent", "build");
        const maxTokens = config.get("maxTokens", 8192);
        const temperature = config.get("temperature", 0.3);
        // Build conversation history from chat context
        const history = [];
        for (const turn of chatContext.history) {
            if (turn instanceof vscode.ChatRequestTurn) {
                history.push({ role: "user", content: turn.prompt });
            }
            else if (turn instanceof vscode.ChatResponseTurn) {
                const parts = [];
                for (const part of turn.response) {
                    if (part instanceof vscode.ChatResponseMarkdownPart) {
                        parts.push(part.value.value);
                    }
                }
                if (parts.length > 0) {
                    history.push({ role: "assistant", content: parts.join("") });
                }
            }
        }
        // Include active editor context if available
        let contextSnippet = "";
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const sel = editor.selection;
            if (!sel.isEmpty) {
                contextSnippet = editor.document.getText(sel);
            }
            else {
                const range = editor.visibleRanges[0];
                if (range) {
                    contextSnippet = editor.document.getText(range);
                }
            }
            if (contextSnippet) {
                const lang = editor.document.languageId;
                const file = vscode.workspace.asRelativePath(editor.document.uri);
                contextSnippet = `\n\n[Context from ${file}]\n\`\`\`${lang}\n${contextSnippet}\n\`\`\``;
            }
        }
        // ── Handle slash commands ──────────────────────────────────
        let prompt = request.prompt;
        if (request.command === "explain") {
            prompt = `Explain the following code:\n${contextSnippet || prompt}`;
        }
        else if (request.command === "fix") {
            prompt = `Fix any issues in this code:\n${contextSnippet || prompt}`;
        }
        else if (request.command === "test") {
            prompt = `Write tests for this code:\n${contextSnippet || prompt}`;
        }
        else if (request.command === "review") {
            prompt = `Review this code for issues, security, and improvements:\n${contextSnippet || prompt}`;
        }
        else if (request.command === "models") {
            return await handleModelsCommand(client, stream);
        }
        else if (request.command === "skills") {
            return await handleSkillsCommand(client, stream, request.prompt);
        }
        else if (contextSnippet && !prompt.includes("```")) {
            prompt += contextSnippet;
        }
        // ── Suggest relevant skills before sending ─────────────────
        let skillHint = "";
        try {
            const keywords = extractKeywords(prompt);
            if (keywords) {
                const results = await client.searchSkills(keywords);
                if (results.length > 0) {
                    const top = results.slice(0, 3);
                    stream.markdown("**Relevant skills:** ");
                    stream.markdown(top.map(r => `\`${r.skill.displayName || r.skill.name}\``).join(", "));
                    stream.markdown("\n\n---\n\n");
                    // Add skill knowledge to the prompt as system context
                    skillHint = "\n\n[Available Skills: " +
                        top.map(r => `${r.skill.name}: ${r.skill.description}`).join("; ") + "]";
                }
            }
        }
        catch {
            // Skills unavailable — proceed without
        }
        // ── Stream response from Thirdwave backend ─────────────────
        stream.progress("Thinking...");
        try {
            const response = await client.chatStream({
                message: prompt + skillHint,
                model: model || undefined,
                agent,
                maxTokens,
                temperature,
                history,
            });
            if (token.isCancellationRequested)
                return;
            if (typeof response === "string") {
                stream.markdown(response);
            }
            else if (response && typeof response[Symbol.asyncIterator] === "function") {
                for await (const chunk of response) {
                    if (token.isCancellationRequested)
                        break;
                    if (chunk) {
                        if (typeof chunk === "string") {
                            stream.markdown(chunk);
                        }
                        else if (chunk.type === "text" && chunk.content) {
                            stream.markdown(chunk.content);
                        }
                    }
                }
            }
            else if (response && typeof response === "object" && "content" in response) {
                stream.markdown(response.content);
            }
        }
        catch (e) {
            if (!token.isCancellationRequested) {
                stream.markdown(`**Error:** ${e.message}`);
            }
        }
    });
    participant.iconPath = new vscode.ThemeIcon("hubot");
    // Follow-up suggestions
    participant.followupProvider = {
        provideFollowups(_result, _context, _token) {
            return [
                { prompt: "Explain the code in more detail", command: "explain", label: "$(info) Explain" },
                { prompt: "Write tests for this", command: "test", label: "$(beaker) Write Tests" },
                { prompt: "Show relevant skills", command: "skills", label: "$(book) Skills" },
            ];
        },
    };
    context.subscriptions.push(participant);
    return participant;
}
// ── Command handlers ──────────────────────────────────────────────────
async function handleModelsCommand(client, stream) {
    try {
        const reg = await client.registry();
        stream.markdown("### Available Models\n\n");
        stream.markdown("**Local / Gateway:**\n");
        for (const p of reg.local) {
            const status = p.status === "online" ? "🟢" : "🔴";
            for (const m of p.models) {
                stream.markdown(`- ${status} \`${m.id}\` — ${p.name} (ctx: ${m.contextLimit})\n`);
            }
        }
        stream.markdown("\n**Cloud (configured):**\n");
        let hasCloud = false;
        for (const p of reg.cloud) {
            if (!p.configured)
                continue;
            hasCloud = true;
            for (const m of p.models) {
                stream.markdown(`- ☁️ \`${m.id}\` — ${p.name}\n`);
            }
        }
        if (!hasCloud) {
            stream.markdown("- _(no cloud providers configured)_\n");
        }
    }
    catch (e) {
        stream.markdown(`Failed to load registry: ${e.message}`);
    }
}
async function handleSkillsCommand(client, stream, query) {
    try {
        if (!query.trim()) {
            // List all skill categories
            const skills = await client.listSkills();
            const categories = new Map();
            for (const s of skills) {
                const cat = s.category || "General";
                if (!categories.has(cat))
                    categories.set(cat, []);
                categories.get(cat).push(s);
            }
            stream.markdown("### Skills Library\n\n");
            for (const [cat, items] of categories) {
                stream.markdown(`**${cat}** (${items.length})\n`);
                for (const s of items) {
                    stream.markdown(`- \`${s.displayName || s.name}\` — ${s.description}\n`);
                }
                stream.markdown("\n");
            }
            stream.markdown("_Use `/skills <query>` to search for specific skills._\n");
        }
        else {
            // Search skills by query
            const results = await client.searchSkills(query);
            if (results.length === 0) {
                stream.markdown(`No skills found for "${query}".`);
                return;
            }
            stream.markdown(`### Skills matching "${query}"\n\n`);
            for (const r of results) {
                const pct = (r.relevance * 100).toFixed(0);
                stream.markdown(`**${r.skill.displayName || r.skill.name}** (${pct}% match)\n`);
                stream.markdown(`> ${r.skill.description}\n\n`);
            }
        }
    }
    catch (e) {
        stream.markdown(`Skills unavailable: ${e.message}`);
    }
}
// ── Helpers ───────────────────────────────────────────────────────────
/** Extract 2-3 relevant keywords from user prompt for skill search */
function extractKeywords(text) {
    const stopWords = new Set([
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "shall", "can", "need", "dare", "ought",
        "i", "me", "my", "we", "our", "you", "your", "he", "she", "it",
        "they", "them", "this", "that", "these", "those", "what", "which",
        "who", "how", "when", "where", "why", "not", "no", "but", "and",
        "or", "if", "then", "else", "for", "from", "to", "in", "on", "at",
        "by", "with", "about", "into", "of", "so", "too", "very", "just",
        "please", "help", "want", "like", "make", "use", "code", "file",
    ]);
    const words = text.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 2 && !stopWords.has(w));
    return [...new Set(words)].slice(0, 3).join(" ");
}
//# sourceMappingURL=ChatParticipant.js.map