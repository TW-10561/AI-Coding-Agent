import * as vscode from "vscode";
export interface WorkspaceContext {
    /** Workspace root folders */
    roots: string[];
    /** Currently active editor file (relative path) */
    activeFile?: string;
    /** Language of active file */
    activeLanguage?: string;
    /** Selected text in active editor (trimmed, max 500 chars) */
    selection?: string;
    /** Open editor file paths (relative, max 10) */
    openFiles: string[];
    /** Recent file changes (relative paths, max 5) */
    recentChanges: string[];
    /** Current diagnostics summary (errors/warnings) */
    diagnostics: DiagnosticSummary;
}
export interface DiagnosticSummary {
    errorCount: number;
    warningCount: number;
    /** Top errors grouped by file (max 5 files, max 3 per file) */
    entries: Array<{
        file: string;
        severity: "error" | "warning";
        line: number;
        message: string;
        source?: string;
    }>;
}
export interface AttachedFile {
    name: string;
    relativePath: string;
    language: string;
    content: string;
    size: number;
}
export declare class WorkspaceManager implements vscode.Disposable {
    private _disposables;
    private _recentChanges;
    private _attachedFiles;
    private _onDidChange;
    readonly onDidChange: vscode.Event<void>;
    constructor();
    /** Get current workspace context snapshot */
    getContext(): WorkspaceContext;
    /** Get current diagnostics summary from VS Code */
    getDiagnostics(): DiagnosticSummary;
    /** Build a workspace context string for the system prompt */
    buildContextString(): string;
    /** Attach a file for the next chat message */
    attachFile(file: AttachedFile): void;
    /** Remove an attached file */
    removeAttachment(relativePath: string): void;
    /** Clear all attachments (typically after sending a message) */
    clearAttachments(): void;
    /** Get current attachments */
    getAttachments(): AttachedFile[];
    /** Read a file from workspace by relative or absolute path */
    readFile(filePath: string): Promise<AttachedFile | null>;
    /** Open a file-picker dialog and attach selected files */
    pickAndAttachFiles(): Promise<AttachedFile[]>;
    private _relativePath;
    private _guessLanguage;
    dispose(): void;
}
