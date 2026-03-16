// ---------------------------------------------------------------------------
// Session Tree Provider — sidebar tree showing conversation sessions
// ---------------------------------------------------------------------------

import * as vscode from "vscode";
import type { ThirdwaveClient, SessionInfo } from "../sdk/ThirdwaveClient";

export class SessionTreeProvider implements vscode.TreeDataProvider<SessionItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _client: ThirdwaveClient;
  private _sessions: SessionInfo[] = [];

  constructor(client: ThirdwaveClient) {
    this._client = client;
  }

  updateClient(client: ThirdwaveClient) {
    this._client = client;
    this.refresh();
  }

  refresh() {
    this._onDidChangeTreeData.fire(undefined);
  }

  async getChildren(): Promise<SessionItem[]> {
    try {
      this._sessions = await this._client.listSessions({ limit: 30 });
      return this._sessions.map((s) => new SessionItem(s));
    } catch {
      return [new SessionItem({ id: "", title: "Cannot connect to Thirdwave", agentID: "", createdAt: 0, updatedAt: 0 })];
    }
  }

  getTreeItem(element: SessionItem): vscode.TreeItem {
    return element;
  }
}

class SessionItem extends vscode.TreeItem {
  public sessionId: string;

  constructor(session: SessionInfo) {
    const label = session.title || `Session ${session.id.slice(0, 8)}`;
    super(label, vscode.TreeItemCollapsibleState.None);

    this.sessionId = session.id;
    this.tooltip = `${label}\nAgent: ${session.agentID}\nCreated: ${session.createdAt ? new Date(session.createdAt).toLocaleString() : "—"}`;
    this.description = session.agentID || "";
    this.contextValue = "session";

    const agentIcons: Record<string, string> = {
      build: "tools",
      plan: "book",
      explore: "search",
      general: "lightbulb",
    };
    this.iconPath = new vscode.ThemeIcon(agentIcons[session.agentID] || "comment-discussion");

    if (session.id) {
      this.command = {
        command: "thirdwave.openChat",
        title: "Open Session",
        arguments: [session.id],
      };
    }
  }
}
