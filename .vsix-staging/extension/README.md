# Codex Context Agent

A VS Code extension that turns previous Codex sessions into reusable feature-area context.

## Features

- Feature-context nodes inferred from previous session prompts and changed files
- Context summaries for pages and feature areas, including prior prompts, assumptions, touched paths, and related sessions
- Workspace memory stored at `.codex-context-agent/context-memory.json`
- Markdown feature-context export for starting new work with the previous development mindset
- Markdown session-context export containing human prompts and recorded file changes
- Codex plan usage percentage and reset time
- Account token activity for the previous 10 days
- Current-workspace Codex sessions
- Per-session token totals when persisted usage metadata is available
- Codex model distribution charts
- Dedicated Activity Bar icon and sidebar dashboard
- Full dashboard view
- Automatic refresh and status-bar summary

## Install

```bash
code --install-extension codex-usage-monitor-0.2.0.vsix
```

Reload VS Code, open a project, and select the **Codex Context** icon from the Activity Bar.

Codex CLI must be installed and authenticated:

```bash
codex login
```

## Commands

- `Codex Usage: Open Full Dashboard`
- `Codex Usage: Refresh`
- `Codex Usage: Export Session Context`
- `Codex Context: Export Feature Context`
- `Codex Usage: Restart App Server`

## Session scope

The session list is filtered to the first open VS Code workspace folder. It includes stored interactive Codex CLI and VS Code threads whose working directory matches that project.

## Export

Each session can still be exported as Markdown. The document contains session metadata, human prompts, file-change paths, and persisted diffs.

Feature-context export combines previous sessions around a page or feature node, such as a customers page. It preserves the earlier prompts, assumptions, mindset signals, touched files, and source sessions so a developer or coding agent can continue new work with the relevant history.

When a codebase-memory-mcp graph is available, these feature areas are the place to attach graph node IDs and relationships. Without an indexed graph, the extension infers nodes from the Codex sessions it can read.

## Context-agent roles

1. While Codex sessions are updated, the extension reads the workspace sessions and stores compact session summaries in `.codex-context-agent/context-memory.json`.
2. Each summary is related back to project code through recorded file changes and keyword-matched workspace paths.
3. The repository can be indexed with `DeusData/codebase-memory-mcp`; graph file and symbol nodes can then augment the stored `relatedCode` records and `graphNodeRefs`.

## Data availability

Account-wide daily and lifetime token activity comes from Codex account usage. Per-session and per-model token counts depend on the metadata retained by the installed Codex version for stored threads. Sessions remain visible even when an older thread does not contain token details.
