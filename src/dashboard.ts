import * as vscode from "vscode";
import type {
  CodexSession,
  DailyUsageBucket,
  FeatureContext,
  ModelUsage,
  RateLimitBucket,
  UsageSnapshot,
} from "./types";

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char] ?? char,
  );
}
function formatNumber(value?: number): string {
  return typeof value === "number"
    ? new Intl.NumberFormat().format(value)
    : "—";
}
function formatReset(timestamp?: number): string {
  return timestamp ? new Date(timestamp * 1000).toLocaleString() : "—";
}
function formatDate(timestamp?: number): string {
  return timestamp
    ? new Date(timestamp * 1000).toLocaleString()
    : "Unknown date";
}
function getBuckets(snapshot: UsageSnapshot): RateLimitBucket[] {
  const byId = snapshot.rateLimits?.rateLimitsByLimitId;
  if (byId && Object.keys(byId).length) return Object.values(byId);
  return snapshot.rateLimits?.rateLimits
    ? [snapshot.rateLimits.rateLimits]
    : [];
}

function dailyBars(data: DailyUsageBucket[]): string {
  const recent = data.slice(-10);
  const max = Math.max(1, ...recent.map((item) => item.tokens));
  return recent
    .map((item) => {
      const height = Math.max(5, Math.round((item.tokens / max) * 112));
      return `<div class="day" title="${escapeHtml(item.startDate)} · ${formatNumber(item.tokens)} tokens">
      <span class="day-value">${formatNumber(item.tokens)}</span><div class="day-bar" style="height:${height}px"></div><span>${escapeHtml(item.startDate.slice(5))}</span>
    </div>`;
    })
    .join("");
}

function radar(models: ModelUsage[]): string {
  const data = models.slice(0, 6);
  if (!data.length)
    return `<div class="empty">Model data will appear when stored sessions expose model and token metadata.</div>`;
  const count = Math.max(3, data.length);
  const cx = 120,
    cy = 120,
    radius = 82;
  const max = Math.max(1, ...data.map((item) => item.tokens || item.sessions));
  const point = (index: number, r: number) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  };
  const rings = [0.25, 0.5, 0.75, 1]
    .map((ratio) => {
      const pts = Array.from({ length: count }, (_, i) =>
        point(i, radius * ratio).join(","),
      ).join(" ");
      return `<polygon points="${pts}" class="radar-ring"/>`;
    })
    .join("");
  const axes = Array.from({ length: count }, (_, i) => {
    const [x, y] = point(i, radius);
    return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="radar-axis"/>`;
  }).join("");
  const values = Array.from({ length: count }, (_, i) => {
    const item = data[i];
    const ratio = item ? (item.tokens || item.sessions) / max : 0;
    return point(i, 16 + ratio * (radius - 16)).join(",");
  }).join(" ");
  const labels = data
    .map((item, i) => {
      const [x, y] = point(i, radius + 24);
      return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle">${escapeHtml(item.model.length > 16 ? `${item.model.slice(0, 14)}…` : item.model)}</text>`;
    })
    .join("");
  return `<svg class="radar" viewBox="0 0 240 240" role="img" aria-label="Token usage by Codex model">${rings}${axes}<polygon points="${values}" class="radar-value"/>${labels}</svg>`;
}

function modelBars(models: ModelUsage[]): string {
  const max = Math.max(
    1,
    ...models.map((item) => item.tokens || item.sessions),
  );
  return (
    models
      .slice(0, 8)
      .map((item) => {
        const width = Math.max(
          4,
          Math.round(((item.tokens || item.sessions) / max) * 100),
        );
        return `<div class="model-row"><div class="model-label"><span>${escapeHtml(item.model)}</span><b>${formatNumber(item.tokens)} tokens</b></div><div class="thin-meter"><div style="width:${width}%"></div></div><small>${item.sessions} session${item.sessions === 1 ? "" : "s"}</small></div>`;
      })
      .join("") ||
    `<div class="empty">No model distribution is available yet.</div>`
  );
}

function sessionRows(sessions: CodexSession[]): string {
  if (!sessions.length)
    return `<div class="empty">No Codex sessions were found for this workspace.</div>`;
  return sessions
    .map(
      (session) => `<article class="session">
    <div class="session-top"><div class="min"><h3>${escapeHtml(session.name)}</h3><p>${escapeHtml(session.preview ?? session.prompts[0]?.text ?? "No prompt preview")}</p></div>
      <button class="icon-button" title="Export Markdown context" onclick="exportSession('${escapeHtml(session.id)}')">⇩</button></div>
    <div class="chips"><span>${escapeHtml(session.model)}</span><span>${formatNumber(session.tokenUsage.totalTokens)} tokens</span><span>${session.prompts.length} prompt${session.prompts.length === 1 ? "" : "s"}</span><span>${session.changes.length} change${session.changes.length === 1 ? "" : "s"}</span></div>
    <div class="session-meta"><span>${escapeHtml(formatDate(session.updatedAt ?? session.createdAt))}</span><span>${escapeHtml(session.status ?? "stored")}</span></div>
  </article>`,
    )
    .join("");
}

function contextRows(contexts: FeatureContext[]): string {
  if (!contexts.length)
    return `<div class="empty">Feature context appears after prior sessions expose prompts or file changes for this workspace.</div>`;
  return contexts
    .slice(0, 8)
    .map((context) => {
      const assumption = context.assumptionSignals[0]?.text ?? context.promptSignals[0]?.text ?? "No prompt signal was detected yet.";
      return `<article class="context-node">
    <div class="session-top"><div class="min"><h3>${escapeHtml(context.label)}</h3><p>${escapeHtml(assumption)}</p></div>
      <button class="icon-button" title="Export feature context" onclick="exportFeatureContext('${escapeHtml(context.id)}')">⇩</button></div>
    <div class="chips"><span>${context.sessionCount} session${context.sessionCount === 1 ? "" : "s"}</span><span>${context.promptCount} prompt${context.promptCount === 1 ? "" : "s"}</span><span>${context.changeCount} change${context.changeCount === 1 ? "" : "s"}</span><span>${formatNumber(context.tokens)} tokens</span></div>
    <div class="code-links">${context.relatedCode.slice(0, 3).map((relation) => `<span title="${escapeHtml(relation.reason)}">${escapeHtml(relation.path)}</span>`).join("")}</div>
    <div class="context-keywords">${context.keywords.slice(0, 6).map((keyword) => `<span>${escapeHtml(keyword)}</span>`).join("")}</div>
  </article>`;
    })
    .join("");
}

export class UsageDashboard implements vscode.WebviewViewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private view: vscode.WebviewView | undefined;
  private snapshot: UsageSnapshot | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.configure(view.webview);
    if (this.snapshot)
      view.webview.html = this.render(this.snapshot, view.webview, true);
  }

  show(snapshot: UsageSnapshot): void {
    this.snapshot = snapshot;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "codexUsage.dashboard",
        "Codex Context",
        vscode.ViewColumn.One,
        { enableScripts: true, retainContextWhenHidden: true },
      );
      this.configure(this.panel.webview);
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
    }
    this.panel.reveal();
    this.panel.webview.html = this.render(snapshot, this.panel.webview, false);
  }

  update(snapshot: UsageSnapshot): void {
    this.snapshot = snapshot;
    if (this.panel)
      this.panel.webview.html = this.render(
        snapshot,
        this.panel.webview,
        false,
      );
    if (this.view)
      this.view.webview.html = this.render(snapshot, this.view.webview, true);
  }

  private configure(webview: vscode.Webview): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webview.onDidReceiveMessage(async (message) => {
      if (message?.command === "refresh")
        await vscode.commands.executeCommand("codexUsage.refresh");
      if (message?.command === "openFull")
        await vscode.commands.executeCommand("codexUsage.openDashboard");
      if (
        message?.command === "export" &&
        typeof message.sessionId === "string"
      )
        await vscode.commands.executeCommand(
          "codexUsage.exportSession",
          message.sessionId,
        );
      if (
        message?.command === "exportFeatureContext" &&
        typeof message.contextId === "string"
      )
        await vscode.commands.executeCommand(
          "codexUsage.exportFeatureContext",
          message.contextId,
        );
    });
  }

  private render(
    snapshot: UsageSnapshot,
    webview: vscode.Webview,
    compact: boolean,
  ): string {
    const logo = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "codex-logo-gray.png"),
    );
    const buckets = getBuckets(snapshot);
    const summary = snapshot.usage?.summary;
    const daily = snapshot.usage?.dailyUsageBuckets ?? [];
    const recent10 = daily.slice(-10);
    const todayTokens = daily.at(-1)?.tokens;
    const limitCards = buckets
      .map(
        (bucket) => `<section class="section limit">
      <div class="section-title"><div><small>Codex plan window</small><h2>${escapeHtml(bucket.limitName || bucket.limitId || "Codex")}</h2></div><strong>${bucket.primary?.usedPercent ?? "—"}%</strong></div>
      <div class="meter"><div style="width:${Math.min(100, bucket.primary?.usedPercent ?? 0)}%"></div></div>
      <div class="between muted"><span>${100 - (bucket.primary?.usedPercent ?? 0)}% remaining</span><span>Resets ${escapeHtml(formatReset(bucket.primary?.resetsAt))}</span></div>
    </section>`,
      )
      .join("");

    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      :root{color-scheme:light dark}*{box-sizing:border-box}body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-sideBar-background);margin:0;padding:${compact ? "12px" : "24px"};line-height:1.45}.shell{max-width:${compact ? "100%" : "1180px"};margin:auto}.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px}.brand{display:flex;align-items:center;gap:10px;min-width:0}.brand img{width:38px;height:38px;opacity:.82}.brand h1{font-size:${compact ? "18px" : "24px"};margin:0}.brand p{margin:2px 0 0;color:var(--vscode-descriptionForeground);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.actions{display:flex;gap:8px}button{border:1px solid var(--vscode-widget-border);background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border-radius:8px;padding:7px 10px;cursor:pointer}button:hover{background:var(--vscode-button-secondaryHoverBackground)}.primary{background:#14b8a6;color:white;border-color:#14b8a6}.grid{display:grid;grid-template-columns:${compact ? "repeat(2,minmax(0,1fr))" : "repeat(4,minmax(0,1fr))"};gap:10px;margin-bottom:12px}.stat,.section{background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-widget-border);border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.12)}.stat{padding:12px;min-width:0}.stat small,.section-title small{color:var(--vscode-descriptionForeground)}.stat b{display:block;font-size:${compact ? "18px" : "25px"};margin:4px 0;overflow:hidden;text-overflow:ellipsis}.stat span{font-size:11px;color:var(--vscode-descriptionForeground)}.section{padding:${compact ? "13px" : "17px"};margin-bottom:12px}.section-title,.between,.session-top,.session-meta,.model-label{display:flex;align-items:center;justify-content:space-between;gap:10px}.section-title h2{font-size:16px;margin:2px 0 10px}.section-title strong{font-size:24px}.meter,.thin-meter{background:var(--vscode-progressBar-background);opacity:.45;border-radius:999px;overflow:hidden}.meter{height:9px}.thin-meter{height:6px}.meter div,.thin-meter div{height:100%;background:#14b8a6;opacity:1}.muted{font-size:11px;color:var(--vscode-descriptionForeground);margin-top:9px}.chart{height:155px;display:flex;align-items:flex-end;gap:${compact ? "4px" : "9px"};border-bottom:1px solid var(--vscode-widget-border);overflow:hidden;padding-top:20px}.day{height:145px;flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;position:relative}.day-bar{width:72%;max-width:44px;background:#14b8a6;border-radius:5px 5px 0 0;opacity:.86}.day span{font-size:9px;color:var(--vscode-descriptionForeground);margin-top:4px}.day .day-value{display:${compact ? "none" : "block"};position:absolute;top:0;font-size:9px}.two{display:grid;grid-template-columns:${compact ? "1fr" : "minmax(260px,.8fr) minmax(300px,1.2fr)"};gap:12px}.radar{display:block;width:100%;max-height:270px}.radar-ring,.radar-axis{fill:none;stroke:var(--vscode-widget-border);stroke-width:1}.radar-value{fill:#14b8a633;stroke:#14b8a6;stroke-width:2}.radar text{fill:var(--vscode-descriptionForeground);font-size:9px}.model-row{margin-bottom:13px}.model-label{font-size:11px;margin-bottom:5px}.model-label span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.model-label b{white-space:nowrap}.model-row small{color:var(--vscode-descriptionForeground)}.session,.context-node{padding:12px 0;border-bottom:1px solid var(--vscode-widget-border)}.session:last-child,.context-node:last-child{border-bottom:0}.session h3,.context-node h3{font-size:13px;margin:0}.session p,.context-node p{font-size:11px;color:var(--vscode-descriptionForeground);margin:4px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.min{min-width:0}.icon-button{width:31px;height:31px;padding:0;flex:none}.chips,.context-keywords,.code-links{display:flex;gap:5px;flex-wrap:wrap;margin:8px 0}.chips span,.context-keywords span,.code-links span{font-size:10px;border-radius:999px;background:#14b8a61c;color:var(--vscode-foreground);padding:3px 7px;border:1px solid #14b8a64d}.context-keywords span{background:transparent}.code-links span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:var(--vscode-button-secondaryBackground)}.session-meta{font-size:10px;color:var(--vscode-descriptionForeground)}.empty,.notice{padding:14px;border:1px dashed var(--vscode-widget-border);border-radius:8px;color:var(--vscode-descriptionForeground);font-size:11px}.error{color:var(--vscode-errorForeground)}@media(max-width:700px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.two{grid-template-columns:1fr}}
    </style></head><body><main class="shell">
      <header class="top"><div class="brand"><img src="${logo}" alt="Codex"><div><h1>Codex Context</h1><p>${escapeHtml(snapshot.workspacePath ?? "Open a workspace to filter sessions")}</p></div></div><div class="actions"><button onclick="refresh()">↻</button>${compact ? `<button class="primary" onclick="openFull()">Open</button>` : ""}</div></header>
      ${snapshot.error ? `<p class="notice error">${escapeHtml(snapshot.error)}</p>` : ""}${snapshot.sessionError ? `<p class="notice">Account usage loaded, but session history could not be read: ${escapeHtml(snapshot.sessionError)}</p>` : ""}
      <div class="grid"><div class="stat"><small>Plan</small><b>${escapeHtml(snapshot.account?.planType ?? snapshot.account?.type ?? "Offline")}</b><span>Codex account</span></div><div class="stat"><small>Today</small><b>${formatNumber(todayTokens)}</b><span>account tokens</span></div><div class="stat"><small>Context nodes</small><b>${formatNumber(snapshot.featureContexts.length)}</b><span>${snapshot.sessions.length} sessions mapped</span></div><div class="stat"><small>Lifetime</small><b>${formatNumber(summary?.lifetimeTokens)}</b><span>Codex tokens</span></div></div>
      ${limitCards || `<section class="section"><div class="empty">Sign in with Codex CLI and refresh to load plan usage.</div></section>`}
      <section class="section"><div class="section-title"><div><small>Previous sessions as node character</small><h2>Feature Context</h2></div><span>${snapshot.featureContexts.length}</span></div>${contextRows(snapshot.featureContexts)}</section>
      <section class="section"><div class="section-title"><div><small>Account activity</small><h2>Previous 10 days</h2></div></div>${recent10.length ? `<div class="chart">${dailyBars(recent10)}</div>` : `<div class="empty">No daily usage buckets were returned.</div>`}</section>
      <div class="two"><section class="section"><div class="section-title"><div><small>Codex only</small><h2>Model radar</h2></div></div>${radar(snapshot.models)}</section><section class="section"><div class="section-title"><div><small>Tokens and sessions</small><h2>Models used</h2></div></div>${modelBars(snapshot.models)}</section></div>
      <section class="section"><div class="section-title"><div><small>Current workspace</small><h2>Sessions</h2></div><span>${snapshot.sessions.length}</span></div>${sessionRows(snapshot.sessions)}</section>
      <div class="muted">Updated ${escapeHtml(snapshot.updatedAt.toLocaleString())}</div>
      <script>const vscode=acquireVsCodeApi();function refresh(){vscode.postMessage({command:'refresh'})}function openFull(){vscode.postMessage({command:'openFull'})}function exportSession(id){vscode.postMessage({command:'export',sessionId:id})}function exportFeatureContext(id){vscode.postMessage({command:'exportFeatureContext',contextId:id})}</script>
    </main></body></html>`;
  }
}
