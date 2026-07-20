import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FeatureContext, SessionContextSummary } from "./types";

interface ContextMemoryFile {
  version: 1;
  workspacePath: string;
  updatedAt: string;
  sessionSummaries: SessionContextSummary[];
  featureContexts: FeatureContext[];
  graph: {
    provider: "DeusData/codebase-memory-mcp";
    indexedProject?: string;
    note: string;
  };
}

export class ContextStore {
  static async save(
    workspacePath: string | undefined,
    sessionSummaries: SessionContextSummary[],
    featureContexts: FeatureContext[],
  ): Promise<void> {
    if (!workspacePath) return;
    const directory = path.join(workspacePath, ".codex-context-agent");
    await fs.mkdir(directory, { recursive: true });
    const payload: ContextMemoryFile = {
      version: 1,
      workspacePath,
      updatedAt: new Date().toISOString(),
      sessionSummaries,
      featureContexts,
      graph: {
        provider: "DeusData/codebase-memory-mcp",
        note: "Feature contexts are graph-ready. Use codebase-memory-mcp indexed file/symbol nodes to replace or augment relatedCode entries with graph-node relations.",
      },
    };
    await fs.writeFile(path.join(directory, "context-memory.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }
}
