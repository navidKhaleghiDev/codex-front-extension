import * as path from "node:path";
import * as fs from "node:fs";
import type { CodexSession, CodeRelation, ContextSignal, FeatureContext, SessionContextSummary } from "./types";

const STOP_WORDS = new Set([
  "about", "action", "add", "after", "agent", "also", "and", "app", "application", "are", "area",
  "before", "build", "change", "code", "codex", "component", "context", "create", "data", "dev",
  "developer", "do", "does", "edit", "example", "feature", "file", "fix", "for", "from", "get", "had",
  "have", "how", "implement", "in", "into", "is", "it", "make", "mindset", "new", "node", "of",
  "on", "or", "page", "previous", "project", "prompt", "session", "should", "that", "the", "their",
  "them", "there", "this", "to", "update", "use", "used", "user", "we", "with", "work", "you",
]);

function titleCase(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function singular(value: string): string {
  return value.endsWith("ies") ? `${value.slice(0, -3)}y` : value.replace(/s$/, "");
}

function normalizeKeyword(value: string): string | undefined {
  const clean = value.toLowerCase().replace(/[^a-z0-9-]+/g, "");
  if (clean.length < 3 || STOP_WORDS.has(clean)) return undefined;
  return singular(clean);
}

function keywordsFromPath(filePath: string): string[] {
  const parsed = path.parse(filePath);
  const rawParts = [
    ...filePath.split(/[\\/]/g),
    ...parsed.name.split(/[-_.\s]+/g),
  ];
  return [...new Set(rawParts.map(normalizeKeyword).filter((item): item is string => Boolean(item)))];
}

function keywordsFromText(text: string): string[] {
  const pageMatches = [...text.matchAll(/\b([a-z][a-z0-9-]{2,})\s+(?:page|screen|view|route|feature|flow|node|area)\b/gi)]
    .map((match) => normalizeKeyword(match[1]))
    .filter((item): item is string => Boolean(item));
  const domainWords = text
    .split(/[^a-z0-9-]+/gi)
    .map(normalizeKeyword)
    .filter((item): item is string => Boolean(item));
  return [...new Set([...pageMatches, ...domainWords])];
}

function scoreKeywords(session: CodexSession): string[] {
  const scores = new Map<string, number>();
  const add = (keyword: string, score: number) => scores.set(keyword, (scores.get(keyword) ?? 0) + score);

  for (const change of session.changes) {
    for (const keyword of keywordsFromPath(change.path)) add(keyword, 4);
  }
  for (const prompt of session.prompts) {
    for (const keyword of keywordsFromText(prompt.text)) add(keyword, 1);
    for (const match of prompt.text.matchAll(/\b([a-z][a-z0-9-]{2,})\s+(?:page|screen|view|route|feature|flow|node|area)\b/gi)) {
      const keyword = normalizeKeyword(match[1]);
      if (keyword) add(keyword, 5);
    }
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([keyword]) => keyword);
}

function firstSentences(text: string, count: number): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, count);
}

function assumptionSentences(text: string): string[] {
  return firstSentences(text, 12).filter((sentence) =>
    /\b(assum|because|expect|must|need|should|constraint|mindset|context|important|avoid|prefer|require)\w*/i.test(sentence),
  );
}

function pushSignal(list: ContextSignal[], session: CodexSession, text: string, limit: number): void {
  if (list.length >= limit) return;
  list.push({ sessionId: session.id, sessionName: session.name, text });
}

function pushRelation(list: CodeRelation[], relation: CodeRelation, limit: number): void {
  const existing = list.find((item) => item.path === relation.path);
  if (existing) {
    if (relation.confidence > existing.confidence) {
      existing.relation = relation.relation;
      existing.confidence = relation.confidence;
      existing.reason = relation.reason;
    }
    return;
  }
  if (list.length < limit) list.push(relation);
}

function walkWorkspace(workspacePath: string | undefined, keywords: string[]): CodeRelation[] {
  if (!workspacePath || !keywords.length) return [];
  const ignored = new Set([".git", ".codebase-memory", ".codex-context-agent", "dist", "media", "node_modules"]);
  const matches: CodeRelation[] = [];
  const pending = [workspacePath];

  while (pending.length && matches.length < 40) {
    const directory = pending.pop();
    if (!directory) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const relative = path.relative(workspacePath, fullPath);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) pending.push(fullPath);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|json|md|css|scss|html|vue|svelte)$/.test(entry.name)) continue;
      const haystack = relative.toLowerCase();
      const keyword = keywords.find((item) => haystack.includes(item));
      if (keyword) {
        matches.push({
          path: relative,
          relation: "keyword-match",
          confidence: 0.55,
          reason: `Path contains context keyword "${keyword}".`,
        });
      }
    }
  }

  return matches;
}

function summaryFor(session: CodexSession): string {
  return session.preview
    ?? session.prompts.map((prompt) => firstSentences(prompt.text, 1)[0]).find(Boolean)
    ?? `Codex session ${session.id.slice(0, 8)}`;
}

export class ContextService {
  static featureContexts(sessions: CodexSession[], workspacePath?: string): FeatureContext[] {
    const contexts = new Map<string, FeatureContext>();

    for (const session of sessions) {
      const keywords = scoreKeywords(session);
      const primaryKeywords = keywords.length ? keywords : ["workspace"];
      for (const keyword of primaryKeywords) {
        const current = contexts.get(keyword) ?? {
          id: keyword,
          label: titleCase(keyword),
          keywords: [keyword],
          nodeKind: keyword.includes("page") ? "page" : "feature",
          sessionIds: [],
          sessionCount: 0,
          promptCount: 0,
          changeCount: 0,
          tokens: 0,
          touchedPaths: [],
          relatedCode: [],
          graphNodeRefs: [],
          promptSignals: [],
          assumptionSignals: [],
          updatedAt: undefined,
        };

        if (!current.sessionIds.includes(session.id)) {
          current.sessionIds.push(session.id);
          current.sessionCount += 1;
          current.promptCount += session.prompts.length;
          current.changeCount += session.changes.length;
          current.tokens += session.tokenUsage.totalTokens;
          current.updatedAt = Math.max(current.updatedAt ?? 0, session.updatedAt ?? session.createdAt ?? 0) || undefined;
        }

        for (const related of keywords) {
          if (!current.keywords.includes(related) && current.keywords.length < 10) current.keywords.push(related);
        }
        for (const change of session.changes) {
          if (!current.touchedPaths.includes(change.path) && current.touchedPaths.length < 24) current.touchedPaths.push(change.path);
          pushRelation(current.relatedCode, {
            path: change.path,
            relation: "changed",
            confidence: 0.95,
            reason: `Session "${session.name}" recorded a file change here.`,
          }, 24);
        }
        for (const relation of walkWorkspace(workspacePath, current.keywords)) pushRelation(current.relatedCode, relation, 24);
        for (const prompt of session.prompts.slice(0, 2)) {
          for (const sentence of firstSentences(prompt.text, 2)) pushSignal(current.promptSignals, session, sentence, 8);
          for (const sentence of assumptionSentences(prompt.text)) pushSignal(current.assumptionSignals, session, sentence, 8);
        }

        contexts.set(keyword, current);
      }
    }

    return [...contexts.values()]
      .filter((context) => context.sessionCount > 0)
      .sort((a, b) => b.sessionCount - a.sessionCount || b.tokens - a.tokens || a.label.localeCompare(b.label))
      .slice(0, 24);
  }

  static sessionContextSummaries(sessions: CodexSession[], contexts: FeatureContext[]): SessionContextSummary[] {
    return sessions.map((session) => {
      const assumptions = session.prompts.flatMap((prompt) => assumptionSentences(prompt.text)).slice(0, 10);
      const relatedCode: CodeRelation[] = [];
      for (const change of session.changes) {
        pushRelation(relatedCode, {
          path: change.path,
          relation: "changed",
          confidence: 0.95,
          reason: "This file was recorded in the Codex session changes.",
        }, 32);
      }
      const featureContextIds = contexts
        .filter((context) => context.sessionIds.includes(session.id))
        .map((context) => context.id);
      for (const context of contexts.filter((item) => featureContextIds.includes(item.id))) {
        for (const relation of context.relatedCode) pushRelation(relatedCode, relation, 32);
      }

      return {
        id: session.id,
        name: session.name,
        summary: summaryFor(session),
        assumptions,
        prompts: session.prompts.map((prompt) => prompt.text).slice(0, 12),
        touchedPaths: session.changes.map((change) => change.path),
        relatedCode,
        featureContextIds,
        updatedAt: session.updatedAt ?? session.createdAt,
      };
    });
  }
}
