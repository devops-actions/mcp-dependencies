import * as vscode from "vscode";
import { discoverDependencies } from "@mcp-dependencies/core";
import type { DiscoveryResult, McpServer, OtherDependency } from "@mcp-dependencies/core";

// ─── Tree Data Provider ───────────────────────────────────────────────────────

type TreeItemKind = "group" | "mcpServer" | "otherDep";

class DependencyTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly kind: TreeItemKind,
    public readonly data?: McpServer | OtherDependency
  ) {
    super(label, collapsibleState);
    this.iconPath = this.resolveIcon();
    this.tooltip = this.resolveTooltip();
    this.description = this.resolveDescription();
  }

  private resolveIcon(): vscode.ThemeIcon {
    if (this.kind === "group") return new vscode.ThemeIcon("folder");
    if (this.kind === "mcpServer") return new vscode.ThemeIcon("server-process");
    return new vscode.ThemeIcon("package");
  }

  private resolveTooltip(): string {
    if (!this.data) return this.label;
    if (this.kind === "mcpServer") {
      const s = this.data as McpServer;
      const lines = [`Name: ${s.name}`, `Type: ${s.type}`, `Source: ${s.source}`];
      if (s.command) lines.push(`Command: ${s.command} ${(s.args ?? []).join(" ")}`);
      if (s.url) lines.push(`URL: ${s.url}`);
      if (s.packageName) lines.push(`Package: ${s.packageName}${s.version ? `@${s.version}` : ""}`);
      return lines.join("\n");
    }
    const d = this.data as OtherDependency;
    return `${d.id}${d.version ? `@${d.version}` : ""} (${d.type})`;
  }

  private resolveDescription(): string {
    if (this.kind === "mcpServer") {
      const s = this.data as McpServer;
      if (s.packageName) return s.packageName;
      if (s.url) return s.url;
      return s.type;
    }
    if (this.kind === "otherDep") {
      const d = this.data as OtherDependency;
      return d.version ?? d.type;
    }
    return "";
  }
}

class McpDependencyProvider implements vscode.TreeDataProvider<DependencyTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<DependencyTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private result: DiscoveryResult | null = null;
  private loading = false;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  setResult(result: DiscoveryResult): void {
    this.result = result;
    this.loading = false;
    this._onDidChangeTreeData.fire();
  }

  setLoading(loading: boolean): void {
    this.loading = loading;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DependencyTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: DependencyTreeItem): DependencyTreeItem[] {
    if (this.loading) {
      return [
        new DependencyTreeItem(
          "Scanning…",
          vscode.TreeItemCollapsibleState.None,
          "group"
        ),
      ];
    }

    if (!this.result) {
      return [
        new DependencyTreeItem(
          "Run 'MCP/APM: Scan Dependencies' to start",
          vscode.TreeItemCollapsibleState.None,
          "group"
        ),
      ];
    }

    if (!element) {
      // Root level: return group nodes
      return [
        new DependencyTreeItem(
          `MCP Servers (${this.result.mcpServers.length})`,
          this.result.mcpServers.length > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None,
          "group"
        ),
        new DependencyTreeItem(
          `APM Dependencies (${this.result.otherDependencies.length})`,
          this.result.otherDependencies.length > 0
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None,
          "group"
        ),
      ];
    }

    if (element.label.toString().startsWith("MCP Servers") && this.result) {
      return this.result.mcpServers.map(
        (s) =>
          new DependencyTreeItem(
            s.name,
            vscode.TreeItemCollapsibleState.None,
            "mcpServer",
            s
          )
      );
    }

    if (element.label.toString().startsWith("APM Dependencies") && this.result) {
      return this.result.otherDependencies.map(
        (d) =>
          new DependencyTreeItem(
            d.id,
            vscode.TreeItemCollapsibleState.None,
            "otherDep",
            d
          )
      );
    }

    return [];
  }
}

// ─── Extension Activation ────────────────────────────────────────────────────

let outputChannel: vscode.OutputChannel;
let treeProvider: McpDependencyProvider;

export function activate(context: vscode.ExtensionContext): void {
  outputChannel = vscode.window.createOutputChannel("MCP & APM Dependencies");
  treeProvider = new McpDependencyProvider();

  const treeView = vscode.window.createTreeView("mcpDependencies", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // Command: scan
  const scanCmd = vscode.commands.registerCommand("mcp-dependencies.scan", async () => {
    await runScan(context);
  });

  // Command: refresh
  const refreshCmd = vscode.commands.registerCommand("mcp-dependencies.refresh", async () => {
    await runScan(context);
  });

  context.subscriptions.push(outputChannel, treeView, scanCmd, refreshCmd);

  // Auto-scan on activation if a workspace is open
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    runScan(context).catch(() => {/* handled inside runScan */});
  }
}

async function runScan(context: vscode.ExtensionContext): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage("MCP/APM Scanner: No workspace folder open.");
    return;
  }

  const config = vscode.workspace.getConfiguration("mcpDependencies");
  const includeGlobal: boolean = config.get<boolean>("includeGlobal", false);
  const projectPath = folders[0].uri.fsPath;

  treeProvider.setLoading(true);
  outputChannel.clear();
  outputChannel.appendLine(`Scanning: ${projectPath}`);
  outputChannel.appendLine(`Include global VS Code config: ${includeGlobal}`);
  outputChannel.appendLine("");

  try {
    const result = await discoverDependencies(projectPath, { includeGlobal });
    treeProvider.setResult(result);

    outputChannel.appendLine(`✅ Found ${result.mcpServers.length} MCP server(s), ${result.otherDependencies.length} APM dependency(ies)`);

    if (result.diagnostics.length > 0) {
      outputChannel.appendLine("\nDiagnostics:");
      for (const d of result.diagnostics) {
        outputChannel.appendLine(`  [${d.level.toUpperCase()}] ${d.file}: ${d.message}`);
      }
    }

    outputChannel.appendLine("\nFull result:");
    outputChannel.appendLine(JSON.stringify(result, null, 2));

    void context; // used in future for state persistence
  } catch (err) {
    treeProvider.setLoading(false);
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`❌ Scan failed: ${msg}`);
    vscode.window.showErrorMessage(`MCP/APM scan failed: ${msg}`);
  }
}

export function deactivate(): void {
  // nothing to clean up beyond subscriptions
}
