// ---------------------------------------------------------------------------
// Model Tree Provider — sidebar tree showing available models & providers
// ---------------------------------------------------------------------------

import * as vscode from "vscode";
import type { ThirdwaveClient, RegistryResponse } from "../sdk/ThirdwaveClient";

type ModelTreeItem = ProviderItem | ModelItem;

export class ModelTreeProvider implements vscode.TreeDataProvider<ModelTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ModelTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _client: ThirdwaveClient;
  private _registry: RegistryResponse | null = null;

  constructor(client: ThirdwaveClient) {
    this._client = client;
  }

  updateClient(client: ThirdwaveClient) {
    this._client = client;
    this.refresh();
  }

  refresh() {
    this._registry = null;
    this._onDidChangeTreeData.fire(undefined);
  }

  async getChildren(element?: ModelTreeItem): Promise<ModelTreeItem[]> {
    if (!element) {
      // Root: show providers
      try {
        this._registry = await this._client.registry();
        const items: ProviderItem[] = [];
        for (const p of this._registry.local) {
          items.push(
            new ProviderItem(p.name, p.status, p.isPrimary, "local", p.id, p.models.length, p.latencyMs)
          );
        }
        for (const p of this._registry.cloud) {
          if (p.configured) {
            items.push(
              new ProviderItem(p.name, "online", false, "cloud", p.id, p.models.length)
            );
          }
        }
        return items;
      } catch {
        return [];
      }
    }

    if (element instanceof ProviderItem && this._registry) {
      // Children: models under provider
      const local = this._registry.local.find((p) => p.id === element.providerId);
      if (local) {
        return local.models.map(
          (m) => new ModelItem(m.name || m.id, m.id, m.contextLimit, m.outputLimit, "local")
        );
      }
      const cloud = this._registry.cloud.find((p) => p.id === element.providerId);
      if (cloud) {
        return cloud.models.map(
          (m) =>
            new ModelItem(
              m.name || m.id,
              m.id,
              m.contextLimit,
              m.outputLimit,
              "cloud",
              m.costIn,
              m.costOut
            )
        );
      }
    }

    return [];
  }

  getTreeItem(element: ModelTreeItem): vscode.TreeItem {
    return element;
  }
}

class ProviderItem extends vscode.TreeItem {
  public providerId: string;

  constructor(
    name: string,
    status: string,
    isPrimary: boolean,
    source: "local" | "cloud",
    providerId: string,
    modelCount: number,
    latencyMs?: number
  ) {
    super(name + (isPrimary ? " ⭐" : ""), vscode.TreeItemCollapsibleState.Expanded);
    this.providerId = providerId;

    const statusText = status === "online" ? "Online" : status;
    const latency = latencyMs ? ` • ${latencyMs}ms` : "";
    this.description = `${statusText}${latency} • ${modelCount} model${modelCount !== 1 ? "s" : ""}`;

    this.iconPath = new vscode.ThemeIcon(
      source === "cloud" ? "cloud" : status === "online" ? "vm-running" : "vm-outline"
    );
    this.contextValue = "provider";
  }
}

class ModelItem extends vscode.TreeItem {
  constructor(
    name: string,
    modelId: string,
    contextLimit: number,
    outputLimit: number,
    source: "local" | "cloud",
    costIn?: number,
    costOut?: number
  ) {
    super(name, vscode.TreeItemCollapsibleState.None);
    this.description = `ctx:${contextLimit} out:${outputLimit}`;
    if (costIn !== undefined && costOut !== undefined) {
      this.description += ` • $${costIn}/$${costOut}`;
    }
    this.tooltip = `Model: ${name}\nID: ${modelId}\nContext: ${contextLimit}\nOutput: ${outputLimit}`;
    this.iconPath = new vscode.ThemeIcon(source === "cloud" ? "cloud" : "server");
    this.contextValue = "model";

    // Click to select model
    this.command = {
      command: "thirdwave.selectModelById",
      title: "Select Model",
      arguments: [modelId, name],
    };
  }
}
