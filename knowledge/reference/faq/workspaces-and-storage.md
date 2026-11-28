---
id: KB-REF-010
title: "FAQ: Workspaces, Worktrees, Data, and Storage"
domain: reference
kind: reference
status: active
summary: Frequently asked questions on repository setup, Git worktree lifecycle, local storage locations, and disk usage.
updated: 2026-11-27
code_refs:
  - src/git/tasks.ts
  - src/application/health-check.ts
  - src/application/log-store.ts
  - src/contracts/usage.ts
related:
  - KB-REF-009
  - KB-OPS-002
tags:
  - faq
  - workspaces
  - worktrees
  - storage
---

# FAQ: Workspaces, Worktrees, Data, and Storage

> **Applies to:** Code60 `v1.0.0-alpha.1` · **Last update:** `2026-11-27`
> Open **Manage → About** or run `code60 status` to check the local Code60 version.

## Workspaces and Worktrees

### Do I need to update my repository to use Code60?

No. Code60 requires no special configuration files, scripts, or dependencies inside a repository. Opening a project never initializes Git or edits repository files automatically.

- **Git repository:** Separate Git worktrees for project workers, **Scheduled Jobs**, and **Workflows** require a Git repository with at least one commit. Without Git, **Relay** can target a direct folder explicitly, or a project chat assistant or user can initialize Git with **Set up Git**.
- **Optional project config:** A user can optionally create `.code60/mcp.json` inside a repository for project-scope MCP servers. Git run records stay inside `<git-common-dir>/code60/runs/` without touching repository source files.

### Does Code60 automatically delete worktrees?

Only empty `code60/*` worktrees or worktrees with a discard mark past the **Heartbeat** age limit, while **Heartbeat** clean-worktree pruning stays on. Code60 never deletes a worktree with edits automatically.

- **Normal lifecycle events:** Finishing, cancelling, or stopping a run leaves existing worktrees intact. Closing the browser, stopping or restarting **Code60 Gateway**, updating Code60, or running `code60 uninstall` or `code60 service uninstall` also keeps them on disk.
- **Heartbeat clean-worktree pruning:** Under **Manage → Heartbeat**, Heartbeat removes inactive `code60/*` worktrees with zero diff against their base branch after 24 hours by default. It skips active runs, live processes, workflows, checkpoints, and every worktree with edits, while keeping `run.json` and `events.jsonl`.
- **Manual removal:** For an inactive run, open its actions menu (for example, in **Apps → Data Viewer**) and choose **Delete worktree**. Code60 blocks removal while the run or its agent process remains active.
- **Confirmation and history:** Before removing a worktree and its run branch manually, Code60 shows a confirmation dialog. That dialog lists the worktree path, branch, and every file with edits that removal erases. After removal, the session record stays visible as inactive.

## Data and Storage

### How does Code60 store data?

Code60 keeps all application data locally on the host machine. New run directories and files use private permissions (`0700` and `0600`), and Code60 does not encrypt local files.

- **Databases:** Project history, configurations, **Internal Prompts** edits, and `$` commands live in SQLite (default `$XDG_DATA_HOME/code60/databases/default.sqlite`). Application memory uses a separate private `memory.sqlite`.
- **Run records and transcripts:** Runs write `run.json` and `events.jsonl` under `<git-common-dir>/code60/runs/`, `$XDG_STATE_HOME/code60/dirs/<key>/runs/`, or `.code60_workspace/` beside the database. Code60 does not automatically scrub or expire transcripts.
- **Configuration, workflows, and logs:** MCP files live at `$XDG_CONFIG_HOME/code60/mcp.json` and `<project>/.code60/mcp.json`, and **Workflows** state lives under `$XDG_STATE_HOME/code60/workflows`. Diagnostic logs under `$XDG_STATE_HOME/code60/logs` carry a 7-day, 20 MiB cap.
- **Usage ledger:** Token metrics live in `$XDG_STATE_HOME/code60/usage/usage.sqlite` with a 90-day, 500,000-turn cap. That file holds numeric counts, provider IDs, model IDs, and opaque IDs without prompts, replies, file paths, or secrets.
- **Codebase search index:** Vector Codebase Search saves repository embeddings and full-text chunks in `$XDG_STATE_HOME/code60/codebase-index/index.sqlite` with private permissions (`0600`).
- **Credentials:** Provider logins stay in each provider's own backend-user storage. MCP secrets stay in macOS Keychain, Linux Secret Service, or explicit temporary backend memory.

### How much disk space does a Code60 installation use?

A base installation typically uses about **400 MB to 1 GB**, depending on platform and private provider installs. Total usage grows over time with Git worktrees and local transcripts.

| Component | Typical size or limit | Notes |
| --- | --- | --- |
| **Typical base total** | **About 400 MB to 1 GB** | Covers app files, local embeddings, and optional private providers. |
| Local embedding model | About 164 MB | Local INT8 weights for offline embeddings. |
| Embedding runtime dependencies | About 125 MB (macOS Apple Silicon) | Total with model is about 290 MB before other app files. |
| Private provider installs | Varies by provider | Lives under `~/.local/share/code60/providers/`. |
| Git worktrees | Varies by repository | **Heartbeat** prunes empty `code60/*` worktrees after 24 hours while keeping every worktree with edits. |
| Heartbeat history | Up to 512 KiB | Keeps the latest 50 sweeps in `$XDG_STATE_HOME/code60/heartbeat/state.json`. |
| Conversation transcripts | No automatic limit | Local `events.jsonl` and **Relay** journals never expire automatically. |
| Request checkpoints | Up to 256 MiB per chat | Keeps up to 100 prior requests per chat. |
| Workflow history | Up to 16 MiB | Keeps up to 1,000 workflow records. |
| Diagnostic logs | Up to 20 MiB | Automatically expires after 7 days or 20 MiB. |
| Usage history | Up to 90 days or 500,000 turns | Local `usage.sqlite` stores numeric counts and opaque IDs only. |
| **Scheduled Jobs** free-space guard | At least 2 GiB free | **Scheduled Jobs** refuse to start below 2 GiB free. |

Size figures reflect macOS Apple Silicon measurements from Code60 `v0.4.1` on `2026-11-25`. See [Low disk space](../../operations/runbooks/low-disk.md) for storage recovery guidance.
