import * as vscode from "vscode";
import { ThirdwaveClient } from "../sdk/ThirdwaveClient";
export declare function registerChatParticipant(context: vscode.ExtensionContext, getClient: () => ThirdwaveClient): vscode.Disposable;
