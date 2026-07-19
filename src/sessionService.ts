import * as path from "node:path";
import type { CodexAppServerClient } from "./appServerClient";
import type { CodexSession, ModelUsage, SessionChange, SessionPrompt, TokenUsage } from "./types";

type AnyRecord = Record<string, unknown>;

const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
};

function record(value: unknown): AnyRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : undefined;
}

function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function number(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
function text(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }

function firstText(object: AnyRecord | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = text(object?.[key]);
    if (value) return value;
  }
  return undefined;
}

function usageFrom(value: unknown): TokenUsage | undefined {
  const item = record(value);
  if (!item) return undefined;
  const inputTokens = number(item.inputTokens ?? item.input_tokens ?? item.promptTokens ?? item.prompt_tokens);
  const cachedInputTokens = number(item.cachedInputTokens ?? item.cached_input_tokens ?? item.cachedTokens ?? item.cached_tokens);
  const outputTokens = number(item.outputTokens ?? item.output_tokens ?? item.completionTokens ?? item.completion_tokens);
  const reasoningTokens = number(item.reasoningTokens ?? item.reasoning_tokens);
  const explicitTotal = number(item.totalTokens ?? item.total_tokens);
  const totalTokens = explicitTotal || inputTokens + cachedInputTokens + outputTokens + reasoningTokens;
  if (!totalTokens && !inputTokens && !outputTokens) return undefined;
  return { inputTokens, cachedInputTokens, outputTokens, reasoningTokens, totalTokens };
}

function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  };
}

function extractTokenUsage(thread: AnyRecord): TokenUsage {
  for (const key of ["tokenUsage", "token_usage", "usage", "totalTokenUsage", "total_token_usage"]) {
    const direct = usageFrom(thread[key]);
    if (direct) return direct;
  }
  let total = { ...EMPTY_USAGE };
  let found = false;
  for (const turnValue of array(thread.turns)) {
    const turn = record(turnValue);
    if (!turn) continue;
    for (const key of ["tokenUsage", "token_usage", "usage"]) {
      const current = usageFrom(turn[key]);
      if (current) { total = addUsage(total, current); found = true; break; }
    }
  }
  return found ? total : { ...EMPTY_USAGE };
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  return array(content).map((part) => {
    const item = record(part);
    return firstText(item, ["text", "content", "value"]) ?? "";
  }).filter(Boolean).join("\n");
}

function parseItems(thread: AnyRecord): { prompts: SessionPrompt[]; changes: SessionChange[] } {
  const prompts: SessionPrompt[] = [];
  const changes: SessionChange[] = [];
  for (const turnValue of array(thread.turns)) {
    const turn = record(turnValue);
    if (!turn) continue;
    const turnId = firstText(turn, ["id", "turnId"]);
    for (const itemValue of array(turn.items)) {
      const item = record(itemValue);
      if (!item) continue;
      const type = firstText(item, ["type", "kind"]);
      if (type === "userMessage" || type === "user_message") {
        const value = messageText(item.content ?? item.text ?? item.message);
        if (value.trim()) prompts.push({ turnId, text: value.trim() });
      }
      if (type === "fileChange" || type === "file_change") {
        for (const changeValue of array(item.changes)) {
          const change = record(changeValue);
          if (!change) continue;
          const filePath = firstText(change, ["path", "filePath", "file_path"]);
          if (filePath) changes.push({
            path: filePath,
            kind: firstText(change, ["kind", "type"]),
            diff: firstText(change, ["diff", "patch"]),
          });
        }
      }
    }
  }
  return { prompts, changes };
}

function normalizeThread(value: unknown): CodexSession | undefined {
  const thread = record(value);
  const id = firstText(thread, ["id", "threadId", "sessionId"]);
  if (!thread || !id) return undefined;
  const parsed = parseItems(thread);
  const statusObject = record(thread.status);
  return {
    id,
    name: firstText(thread, ["name", "title", "preview"]) ?? `Codex session ${id.slice(0, 8)}`,
    preview: firstText(thread, ["preview", "summary"]),
    cwd: firstText(thread, ["cwd", "workingDirectory", "working_directory"]),
    createdAt: number(thread.createdAt ?? thread.created_at) || undefined,
    updatedAt: number(thread.updatedAt ?? thread.updated_at ?? thread.recencyAt ?? thread.recency_at) || undefined,
    model: firstText(thread, ["model", "modelId", "model_id"])
      ?? firstText(record(thread.modelInfo), ["id", "model"])
      ?? [...array(thread.turns)].reverse().map((value) => firstText(record(value), ["model", "modelId", "model_id"])).find(Boolean)
      ?? "Unknown model",
    sourceKind: firstText(thread, ["sourceKind", "source_kind", "source"]),
    status: firstText(statusObject, ["type"]) ?? firstText(thread, ["status"]),
    tokenUsage: extractTokenUsage(thread),
    prompts: parsed.prompts,
    changes: parsed.changes,
    raw: value,
  };
}

export class SessionService {
  constructor(private readonly client: CodexAppServerClient) {}

  async listWorkspaceSessions(workspacePath: string | undefined): Promise<CodexSession[]> {
    if (!workspacePath) return [];
    const summaries: unknown[] = [];
    let cursor: string | null = null;
    do {
      const result: { data?: unknown[]; nextCursor?: string | null } = await this.client.request("thread/list", {
        cursor,
        limit: 100,
        sortKey: "updated_at",
        sortDirection: "desc",
        cwd: workspacePath,
        sourceKinds: ["cli", "vscode", "exec", "appServer"],
      }, 30_000);
      summaries.push(...(result.data ?? []));
      cursor = result.nextCursor ?? null;
    } while (cursor && summaries.length < 500);

    const sessions: CodexSession[] = [];
    for (let index = 0; index < summaries.length; index += 6) {
      const group = summaries.slice(index, index + 6);
      const details = await Promise.all(group.map(async (summary) => {
        const summaryRecord = record(summary);
        const id = firstText(summaryRecord, ["id", "threadId"]);
        if (!id) return undefined;
        try {
          const result = await this.client.request<{ thread?: unknown }>("thread/read", { threadId: id, includeTurns: true }, 30_000);
          return normalizeThread(result.thread ?? summary);
        } catch {
          return normalizeThread(summary);
        }
      }));
      sessions.push(...details.filter((item): item is CodexSession => Boolean(item)));
    }

    const normalizedWorkspace = path.resolve(workspacePath);
    return sessions.filter((session) => !session.cwd || path.resolve(session.cwd) === normalizedWorkspace);
  }

  static models(sessions: CodexSession[]): ModelUsage[] {
    const map = new Map<string, ModelUsage>();
    for (const session of sessions) {
      const current = map.get(session.model) ?? { model: session.model, tokens: 0, sessions: 0 };
      current.tokens += session.tokenUsage.totalTokens;
      current.sessions += 1;
      map.set(session.model, current);
    }
    return [...map.values()].sort((a, b) => b.tokens - a.tokens || b.sessions - a.sessions);
  }
}
