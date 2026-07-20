import { EventEmitter } from "node:events";
import type { CodexAppServerClient } from "./appServerClient";
import { ContextService } from "./contextService";
import { ContextStore } from "./contextStore";
import { SessionService } from "./sessionService";
import type { AccountInfo, RateLimitsResult, UsageResult, UsageSnapshot } from "./types";

interface AccountReadResult { account: AccountInfo | null; requiresOpenaiAuth: boolean; }

export class UsageService extends EventEmitter {
  private snapshot: UsageSnapshot = {
    account: null,
    requiresOpenaiAuth: true,
    rateLimits: null,
    usage: null,
    sessions: [],
    models: [],
    featureContexts: [],
    sessionContextSummaries: [],
    updatedAt: new Date(0),
  };

  private readonly sessions: SessionService;

  constructor(private readonly client: CodexAppServerClient, private readonly workspacePath?: string) {
    super();
    this.sessions = new SessionService(client);
    client.on("notification", (method: string, params: unknown) => {
      if (method === "account/rateLimits/updated") this.applyRateLimitNotification(params);
      else if (method === "account/updated" || method === "turn/completed" || method === "thread/started") void this.refresh();
    });
  }

  get current(): UsageSnapshot { return this.snapshot; }

  async refresh(): Promise<UsageSnapshot> {
    try {
      const accountResult = await this.client.request<AccountReadResult>("account/read", { refreshToken: false });
      let rateLimits: RateLimitsResult | null = null;
      let usage: UsageResult | null = null;
      let sessions = this.snapshot.sessions;
      let sessionError: string | undefined;

      if (accountResult.account && accountResult.account.type !== "apiKey") {
        [rateLimits, usage] = await Promise.all([
          this.client.request<RateLimitsResult>("account/rateLimits/read"),
          this.client.request<UsageResult>("account/usage/read"),
        ]);
        try {
          sessions = await this.sessions.listWorkspaceSessions(this.workspacePath);
        } catch (error) {
          sessionError = error instanceof Error ? error.message : String(error);
        }
      }

      const featureContexts = ContextService.featureContexts(sessions, this.workspacePath);
      const sessionContextSummaries = ContextService.sessionContextSummaries(sessions, featureContexts);
      try {
        await ContextStore.save(this.workspacePath, sessionContextSummaries, featureContexts);
      } catch (error) {
        sessionError = [sessionError, `Context memory could not be written: ${error instanceof Error ? error.message : String(error)}`]
          .filter(Boolean)
          .join(" ");
      }

      this.snapshot = {
        account: accountResult.account,
        requiresOpenaiAuth: accountResult.requiresOpenaiAuth,
        rateLimits,
        usage,
        sessions,
        models: SessionService.models(sessions),
        featureContexts,
        sessionContextSummaries,
        workspacePath: this.workspacePath,
        updatedAt: new Date(),
        sessionError,
      };
    } catch (error) {
      this.snapshot = {
        ...this.snapshot,
        updatedAt: new Date(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
    this.emit("updated", this.snapshot);
    return this.snapshot;
  }

  private applyRateLimitNotification(params: unknown): void {
    const value = params as { rateLimits?: RateLimitsResult } | RateLimitsResult;
    const rateLimits = "rateLimits" in value && value.rateLimits && "rateLimits" in value.rateLimits
      ? value.rateLimits : value as RateLimitsResult;
    this.snapshot = { ...this.snapshot, rateLimits, updatedAt: new Date(), error: undefined };
    this.emit("updated", this.snapshot);
  }
}
