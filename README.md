# Codex Usage Monitor

A VS Code dashboard for ChatGPT Codex usage.

## Features

- Codex plan usage percentage and reset time
- Account token activity for the previous 10 days
- Current-workspace Codex sessions
- Per-session token totals when persisted usage metadata is available
- Codex model distribution charts
- Dedicated Activity Bar icon and sidebar dashboard
- Full dashboard view
- Markdown session-context export containing human prompts and recorded file changes
- Automatic refresh and status-bar summary

## Install

```bash
code --install-extension codex-usage-monitor-0.2.0.vsix
```

Reload VS Code, open a project, and select the **Codex Usage** icon from the Activity Bar.

Codex CLI must be installed and authenticated:

```bash
codex login
```

## Commands

- `Codex Usage: Open Full Dashboard`
- `Codex Usage: Refresh`
- `Codex Usage: Export Session Context`
- `Codex Usage: Restart App Server`

## Session scope

The session list is filtered to the first open VS Code workspace folder. It includes stored interactive Codex CLI and VS Code threads whose working directory matches that project.

## Export

Each session can be exported as Markdown. The document contains session metadata, human prompts, file-change paths, and persisted diffs. The export is designed to be readable by people and reusable as context for another coding agent.

## Data availability

Account-wide daily and lifetime token activity comes from Codex account usage. Per-session and per-model token counts depend on the metadata retained by the installed Codex version for stored threads. Sessions remain visible even when an older thread does not contain token details.
