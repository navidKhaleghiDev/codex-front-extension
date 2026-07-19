import * as path from "node:path";
import * as vscode from "vscode";
import { CodexAppServerClient } from "./appServerClient";
import { UsageDashboard } from "./dashboard";
import type { CodexSession, RateLimitBucket, UsageSnapshot } from "./types";
import { UsageService } from "./usageService";

let client: CodexAppServerClient | undefined;
let poller: NodeJS.Timeout | undefined;

function primaryBucket(snapshot: UsageSnapshot): RateLimitBucket | undefined {
  if (snapshot.rateLimits?.rateLimits) return snapshot.rateLimits.rateLimits;
  const byId = snapshot.rateLimits?.rateLimitsByLimitId;
  return byId ? Object.values(byId)[0] : undefined;
}

function workspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "codex-session";
}

function fence(value: string): string {
  const longest = Math.max(3, ...[...value.matchAll(/`+/g)].map((match) => match[0].length + 1));
  return "`".repeat(longest);
}

function sessionMarkdown(session: CodexSession, projectPath?: string): string {
  const lines: string[] = [
    `# Codex Session Context: ${session.name}`,
    "",
    "> Exported by Codex Usage Monitor. This document preserves the human prompts and code changes so another person or agent can understand and continue the work.",
    "",
    "## Session metadata",
    "",
    `- **Session ID:** \`${session.id}\``,
    `- **Project:** \`${projectPath ?? session.cwd ?? "Unknown"}\``,
    `- **Model:** ${session.model}`,
    `- **Created:** ${session.createdAt ? new Date(session.createdAt * 1000).toISOString() : "Unknown"}`,
    `- **Updated:** ${session.updatedAt ? new Date(session.updatedAt * 1000).toISOString() : "Unknown"}`,
    `- **Tokens:** ${session.tokenUsage.totalTokens.toLocaleString()}`,
    `- **Prompts:** ${session.prompts.length}`,
    `- **Recorded file changes:** ${session.changes.length}`,
    "",
    "## Human prompts",
    "",
  ];

  if (!session.prompts.length) lines.push("No user prompts were available in the stored Codex thread.", "");
  session.prompts.forEach((prompt, index) => {
    lines.push(`### Prompt ${index + 1}`, "", prompt.text, "");
  });

  lines.push("## Code changes", "");
  if (!session.changes.length) lines.push("No persisted file-change items were available for this session.", "");
  session.changes.forEach((change, index) => {
    lines.push(`### ${index + 1}. \`${change.path}\``, "", `- **Change type:** ${change.kind ?? "modified"}`, "");
    if (change.diff) {
      const marker = fence(change.diff);
      lines.push(`${marker}diff`, change.diff, marker, "");
    }
  });

  lines.push(
    "## Continuation context",
    "",
    "Use the prompts and diffs above as the source of truth. Inspect the current repository before continuing because the working tree may have changed after this session.",
    "",
  );
  return lines.join("\n");
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = "codexUsage.openDashboard";
  status.text = "$(pulse) Codex usage…";
  status.tooltip = "Open Codex Usage Monitor";
  status.show();
  context.subscriptions.push(status);

  const dashboard = new UsageDashboard(context.extensionUri);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider("codexUsage.sidebar", dashboard, { webviewOptions: { retainContextWhenHidden: true } }));

  const createServices = (): UsageService => {
    client?.stop();
    const config = vscode.workspace.getConfiguration("codexUsage");
    client = new CodexAppServerClient(config.get<string>("codexPath", "codex"));
    const service = new UsageService(client, workspacePath());
    client.on("log", (message: string) => console.debug("[Codex Usage]", message));
    client.on("exit", (message: string) => {
      status.text = "$(warning) Codex usage unavailable";
      status.tooltip = message;
    });
    service.on("updated", (snapshot: UsageSnapshot) => {
      updateStatus(status, snapshot);
      dashboard.update(snapshot);
    });
    return service;
  };

  let service = createServices();
  const refresh = async (): Promise<void> => {
    status.text = "$(sync~spin) Codex usage";
    await service.refresh();
  };

  const exportSession = async (sessionId?: string): Promise<void> => {
    let session = service.current.sessions.find((item) => item.id === sessionId);
    if (!session) {
      const picked = await vscode.window.showQuickPick(service.current.sessions.map((item) => ({
        label: item.name,
        description: `${item.model} · ${item.tokenUsage.totalTokens.toLocaleString()} tokens`,
        detail: item.preview,
        session: item,
      })), { placeHolder: "Select a Codex session to export" });
      session = picked?.session;
    }
    if (!session) return;

    const root = workspacePath();
    const defaultDirectory = root ? vscode.Uri.file(root) : vscode.Uri.file(process.cwd());
    const destination = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(defaultDirectory, `${safeName(session.name)}-codex-context.md`),
      filters: { Markdown: ["md"] },
      title: "Export Codex session context",
    });
    if (!destination) return;
    await vscode.workspace.fs.writeFile(destination, Buffer.from(sessionMarkdown(session, root), "utf8"));
    const open = await vscode.window.showInformationMessage("Codex session context exported.", "Open file");
    if (open) await vscode.window.showTextDocument(destination);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("codexUsage.openDashboard", async () => {
      if (service.current.updatedAt.getTime() === 0) await refresh();
      dashboard.show(service.current);
    }),
    vscode.commands.registerCommand("codexUsage.refresh", refresh),
    vscode.commands.registerCommand("codexUsage.exportSession", exportSession),
    vscode.commands.registerCommand("codexUsage.restartServer", async () => {
      service = createServices();
      await refresh();
      vscode.window.showInformationMessage("Codex Usage Monitor restarted.");
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      service = createServices();
      void refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codexUsage")) {
        service = createServices();
        configurePolling();
        void refresh();
      }
    }),
    { dispose: () => client?.stop() },
  );

  const configurePolling = (): void => {
    if (poller) clearInterval(poller);
    const seconds = vscode.workspace.getConfiguration("codexUsage").get<number>("refreshIntervalSeconds", 60);
    poller = setInterval(() => void service.refresh(), Math.max(15, seconds) * 1000);
  };

  configurePolling();
  context.subscriptions.push({ dispose: () => poller && clearInterval(poller) });
  await refresh();
}

function updateStatus(status: vscode.StatusBarItem, snapshot: UsageSnapshot): void {
  if (snapshot.error) { status.text = "$(warning) Codex usage unavailable"; status.tooltip = snapshot.error; return; }
  if (!snapshot.account) { status.text = "$(account) Sign in to Codex"; status.tooltip = "Run `codex login`."; return; }
  const bucket = primaryBucket(snapshot);
  const used = bucket?.primary?.usedPercent;
  const remainingMode = vscode.workspace.getConfiguration("codexUsage").get<boolean>("showRemainingInsteadOfUsed", false);
  if (typeof used !== "number") { status.text = "$(graph) Codex usage"; status.tooltip = "Account connected; no plan percentage was returned."; return; }
  const displayed = remainingMode ? Math.max(0, 100 - used) : used;
  status.text = `$(graph) Codex ${displayed}% ${remainingMode ? "left" : "used"}`;
  const reset = bucket?.primary?.resetsAt ? new Date(bucket.primary.resetsAt * 1000).toLocaleString() : "unknown";
  status.tooltip = `Plan: ${bucket?.planType ?? snapshot.account.planType ?? "ChatGPT"}\nUsed: ${used}%\nProject sessions: ${snapshot.sessions.length}\nReset: ${reset}`;
}

export function deactivate(): void { if (poller) clearInterval(poller); client?.stop(); }
