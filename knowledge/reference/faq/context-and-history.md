---
id: KB-REF-015
title: "FAQ: Context, History, and Compaction"
domain: reference
kind: reference
status: active
summary: Frequently asked questions on context sent to agents, triggers, long conversation history, and automatic context handoff.
updated: 2026-11-27
code_refs:
  - src/application/memory-limits.ts
  - src/application/relay-service.ts
  - src/core/episodic-memory.ts
related:
  - KB-REF-014
  - KB-OPS-004
tags:
  - faq
  - context
  - memory
  - history
---

# FAQ: Context, History, and Compaction

> **Applies to:** Code60 `v0.5.0-beta` · **Last update:** `2026-11-27`
> Open **Manage → About** or run `code60 status` to check the local Code60 version. See [Code60 Terminology](../../../TERMINOLOGY.md) for key terms.

## Context and History

### What context does Code60 send to an agent?

Code60 sends the user's request, role instructions, relevant session continuity, and explicit attachments to the active **Agent Provider**.

- **Prompts and attachments:** Code60 sends the human message plus any `$` command or **Tactic** in a project chat. It also includes up to eight code references a user adds from **Files** or **Changes**.
- **Role instructions:** Project orchestrators receive the **Operating Contract**, **Relay** receives its own application instructions, and **Custom Assistants** receive their custom instructions. Workers receive only the standalone task prompt and follow-ups from their orchestrator.
- **Continuity, history, and recall:** **Relay** sends up to 64,000 characters of recent history once after a restart. Context handoffs send a continuity checkpoint, and active **Memory** adds relevant long-term recall.
- **Updates, plans, and helpers:** Orchestrators receive automatic worker-update summaries and plans the user accepts. **Search** overviews send matching project excerpts, and **Create with prompt** sends form fields, the root `README`, and `package.json` scripts.
- **Exclusions:** Code60 never sends provider passwords, MCP secrets, diagnostic logs, or composer drafts automatically. Once active in a repository, an agent can still read files under its operating-system permissions.

### When does Code60 send context to an agent?

Code60 sends context only during explicit user actions, active orchestration updates, **Scheduled Jobs**, or optional background helpers. Startup, page navigation, opening projects, viewing history, and provider checks send no prompts.

- **User actions:** Sending a chat message, accepting or resuming a plan, starting a **Workflow**, drafting in **Create with prompt**, or running **Search**.
- **Active orchestration and handoffs:** When a worker finishes or fails, Code60 delivers an automatic worker update to its orchestrator. Between turns at 70% capacity, Code60 runs a no-tool helper to build a continuity checkpoint before opening a fresh ACP session.
- **Scheduled Jobs:** **Code60 Gateway** sends a job's prompt for one headless turn when an active schedule reaches its next run time. Clicking **Run** manually also starts one headless turn.
- **Optional Memory extraction:** Only while **Memory** stays on, a no-tool helper periodically summarizes recent turns into long-term memories. Turning **Memory** off stops this capture.

### How does Code60 handle long conversation history?

Code60 keeps complete transcripts on disk, bounds what the browser loads into memory, and rotates long agent sessions automatically between turns.

- **Complete transcripts on disk:** Runs write full transcripts to local `events.jsonl` files, and **Relay** writes to private local journal files. Unlike diagnostic logs (which expire after 7 days or 20 MiB), conversation transcripts never expire automatically.
- **On-demand browser views and windows:** Inactive chats send only lightweight summaries (unread counts and worker status) over the app stream. Opening a chat loads its live window: up to 1,000,000 characters in **Relay**, or 512 events and 256,000 characters per worker target. Oldest events leave the live view when that budget fills, while complete records stay on disk.
- **Paged history tables:** In **Data Viewer** and **Scheduled Jobs** history, Code60 loads older records in server-side pages with expiring cursors to keep browser memory low.
- **Automatic context handoff:** Before a new turn crosses 70% of context capacity, Code60 summarizes recent context into a continuity checkpoint. Code60 assumes 128,000 tokens when a provider omits capacity, then opens a fresh ACP session without interrupting an active turn. Context handoff runs even when **Memory** stays off, while turning **Memory** on adds long-term recall.
- **Restart and reconnect windows:** After a restart, **Relay** attaches up to 64,000 characters of recent history once on the first human send. Continuing an inactive project run tries ACP session restore first, then falls back to a handoff summary without replaying past tasks.

### How does Code60 interact with an Agent Provider's context compaction?

Code60 neither triggers nor blocks an [Agent Provider's](../../../TERMINOLOGY.md#agent-provider) internal context compaction. If a harness compacts its own context during a turn, Code60 lets it run normally.

- **Live context gauge:** The composer footer shows the token count and capacity that the provider reports over ACP and never guesses from transcript length. When a provider compacts context, the gauge can drop to match the new report.
- **Interaction with Code60 context handoff:** Between turns, Code60 starts automatic context handoff at 70% of context capacity. That check uses the higher of the provider's report and Code60's own session estimate. Code60's 70% rollover often occurs before late-window provider compaction, while early provider compaction still runs inside the harness.
- **Safety and continuity:** Neither provider compaction nor Code60's context handoff deletes local transcripts, restores old permissions, or replays past tool calls. Code60 also carries explicit in-session **Model** choices into the fresh handoff session.
