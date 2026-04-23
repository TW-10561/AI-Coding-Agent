import * as vscode from "vscode";
interface DiffOptions {
    original: string;
    proposed: string;
    /** File path shown in the panel title */
    filePath: string;
    /** Called when the user clicks Accept */
    onAccept: (proposed: string) => void | Promise<void>;
    /** Called when the user clicks Edit (proposed text opened in new editor) */
    onEdit?: (proposed: string) => void | Promise<void>;
}
export declare class DiffPanel {
    private static _current;
    private readonly _panel;
    private readonly _opts;
    private _disposed;
    private constructor();
    /** Open (or replace) the diff panel */
    static show(context: vscode.ExtensionContext, opts: DiffOptions): DiffPanel;
    dispose(): void;
    private _languageId;
    private _buildHtml;
}
export {};
