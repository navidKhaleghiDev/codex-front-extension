export interface JsonRpcRequest { id?: number; method: string; params?: unknown; }
export interface JsonRpcResponse {
  id?: number; method?: string; params?: unknown; result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface AccountInfo { type?: string; email?: string; planType?: string; }
export interface RateWindow { usedPercent?: number; windowDurationMins?: number; resetsAt?: number; }
export interface RateLimitBucket {
  limitId?: string; limitName?: string | null; planType?: string;
  primary?: RateWindow | null; secondary?: RateWindow | null;
  credits?: unknown; rateLimitReachedType?: string | null;
}
export interface RateLimitsResult {
  rateLimits?: RateLimitBucket | null;
  rateLimitsByLimitId?: Record<string, RateLimitBucket>;
  rateLimitResetCredits?: unknown;
}
export interface UsageSummary {
  lifetimeTokens?: number; peakDailyTokens?: number; longestRunningTurnSec?: number;
  currentStreakDays?: number; longestStreakDays?: number;
}
export interface DailyUsageBucket { startDate: string; tokens: number; }
export interface UsageResult { summary?: UsageSummary; dailyUsageBuckets?: DailyUsageBucket[]; }

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface SessionChange {
  path: string;
  kind?: string;
  diff?: string;
}

export interface SessionPrompt {
  turnId?: string;
  text: string;
}

export interface CodexSession {
  id: string;
  name: string;
  preview?: string;
  cwd?: string;
  createdAt?: number;
  updatedAt?: number;
  model: string;
  sourceKind?: string;
  status?: string;
  tokenUsage: TokenUsage;
  prompts: SessionPrompt[];
  changes: SessionChange[];
  raw?: unknown;
}

export interface ModelUsage {
  model: string;
  tokens: number;
  sessions: number;
}

export interface ContextSignal {
  sessionId: string;
  sessionName: string;
  text: string;
}

export interface CodeRelation {
  path: string;
  relation: "changed" | "keyword-match" | "graph-node";
  confidence: number;
  reason: string;
}

export interface SessionContextSummary {
  id: string;
  name: string;
  summary: string;
  assumptions: string[];
  prompts: string[];
  touchedPaths: string[];
  relatedCode: CodeRelation[];
  featureContextIds: string[];
  updatedAt?: number;
}

export interface FeatureContext {
  id: string;
  label: string;
  keywords: string[];
  nodeKind: "feature" | "page" | "code-area";
  sessionIds: string[];
  sessionCount: number;
  promptCount: number;
  changeCount: number;
  tokens: number;
  touchedPaths: string[];
  relatedCode: CodeRelation[];
  graphNodeRefs: string[];
  promptSignals: ContextSignal[];
  assumptionSignals: ContextSignal[];
  updatedAt?: number;
}

export interface UsageSnapshot {
  account: AccountInfo | null;
  requiresOpenaiAuth: boolean;
  rateLimits: RateLimitsResult | null;
  usage: UsageResult | null;
  sessions: CodexSession[];
  models: ModelUsage[];
  featureContexts: FeatureContext[];
  sessionContextSummaries: SessionContextSummary[];
  workspacePath?: string;
  updatedAt: Date;
  error?: string;
  sessionError?: string;
}
