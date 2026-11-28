---
id: KB-REF-014
title: "FAQ: Orchestration, Workers, MCP, and Concurrency"
domain: reference
kind: reference
status: active
summary: Frequently asked questions on Code60 workers versus provider subagents, browser automation, MCP support, and concurrency limits.
updated: 2026-11-27
code_refs:
  - src/core/orchestrator.ts
  - src/core/config.ts
  - src/contracts/automation.ts
  - src/application/mcp-gateway.ts
related:
  - KB-REF-011
  - KB-REF-015
  - KB-REF-016
tags:
  - faq
  - orchestration
  - workers
  - mcp
---

# FAQ: Orchestration, Workers, MCP, and Concurrency

> **Applies to:** Code60 `v1.0.0-alpha.1` · **Last update:** `2026-11-27`
> Open **Manage → About** or run `code60 status` to check the local Code60 version.

## Orchestration and Workers

### How are Code60 subagents different than my Agent Provider's subagents?

In Code60's Two-Layer Architecture, Code60 subagents (workers) are full Code60 sessions that run in separate Git worktrees. An Agent Provider's internal subagents run inside that single provider's process and stay outside Code60's orchestration controls.

- **Separate Git worktrees:** Each Code60 project worker edits files in its own Git worktree and run branch. Code60 integrates those edits safely and supports message-level **Undo**, whereas a provider's internal subagents typically share one working directory.
- **Cross-provider flexibility:** Code60 can dispatch workers using any active **Agent Provider** and apply separate model defaults for orchestrators and workers. A provider's internal subagents stay within that single provider's harness.
- **Direct visibility and control:** Each Code60 worker has its own sidebar chat, live transcript, and diff viewer. A user can directly message, cancel, stop, or resume a worker. Provider-internal subagents usually run as internal tool calls without separate Code60 worker views.
- **Local run records:** Code60 keeps local run records, transcripts, and process-group tracking for each worker. A user or orchestrator can inspect or continue an inactive worker later.
- **Using both together:** Code60 does not block a provider's internal subagents. If a harness spawns its own subagents inside a worker session, they run within that worker's worktree under that provider's control.

### Does Code60 use my Agent Provider's subagents?

No. Code60 does not call or manage an Agent Provider's internal subagents directly.

In Code60's Two-Layer Architecture, orchestrators delegate coding tasks by starting Code60 worker sessions through ACP. Each project worker runs in its own Git worktree with its own transcript and lifecycle controls.

Code60 does not block a provider's internal subagents. If a harness spawns its own subagents during a turn, they run inside that session's directory or worktree under that provider's control.

### Does Code60 have Computer Use capabilities?

No. Code60 has no native desktop Computer Use control.

- **Web browser automation:** **Relay**, **Custom Assistants**, and project chats include the `code60_browser` tool using Playwright. It controls web pages in **Headless**, **Visible**, or **Existing Browser** mode and cannot control native desktop applications.
- **Scope and limits:** Workers, helpers, and **Scheduled Jobs** do not receive `code60_browser`. Message **Undo** does not undo external website changes.
- **External MCP servers:** A user can connect external MCP servers under **Connect → MCP Servers** for extra automation outside Code60's browser tool.

### Does Code60 support MCP?

Yes. Code60 supports MCP for both its own orchestration tools and external tool servers. See [MCP Configuration](../../../MCP.md) for full details.

- **Orchestration tools:** In Code60's Two-Layer Architecture, orchestrators receive Code60's MCP tools for worker control, planning, reviews, and browser automation. Workers never receive those tools.
- **Codebase search tools:** Orchestrators, workers, **Workflows**, and **Scheduled Jobs** receive Code60's read-only Vector Codebase Search tools (`code60_search_codebase` and `code60_codebase_index_status`).
- **External MCP servers:** Under **Connect → MCP Servers**, a user can manage User and open-project servers with visual forms or strict JSON. Project server IDs override User IDs, new servers start off, and project servers require human approval for their exact revision.
- **Transports and scope:** Code60 supports `stdio` and Streamable HTTP transports for tools only. It omits legacy Server-Sent Events (SSE), resources, prompts, sampling, and elicitation.
- **Secrets and limits:** MCP secrets stay in macOS Keychain, Linux Secret Service, or explicit temporary memory, with S256 PKCE OAuth support. **Scheduled Jobs**, setup probes, and internal helpers receive no external MCP servers.

### Does Code60 limit the number of agents that I can run simultaneously?

Yes. Code60 applies per-feature concurrency limits alongside the host machine's resources and each **Agent Provider's** rate limits.

- **Interactive workers:** Each orchestration conversation (such as **Relay**, a **Custom Assistant**, or a project chat) defaults to **4** simultaneous workers (`maxParallel` in `config.json`). Idle workers still hold a slot while their process stays alive. Finishing or stopping an idle worker frees its slot.
- **Adjusting worker slots:** A user can raise `maxParallel` to any positive integer in `config.json`. Manual multi-copy runs cap at **32** copies per batch.
- **Scheduled Jobs:** Concurrency lanes allow at most **1** single-prompt job globally and at most **2** workflow jobs globally at a time. Each active job holds its lane slot and repository lock until it finishes or stops.
- **Workflows:** **Code60 Gateway** allows at most **1** active **Workflow** per source repository checkout across manual and **Scheduled Jobs** runs. A workflow whose start or stop still awaits confirmation also holds that slot until a user resolves it.
- **Custom Assistants:** Code60 supports up to **64** **Custom Assistants** application-wide.
- **Hardware and provider limits:** Running many agents at once still depends on local CPU, memory, and each **Agent Provider's** own rate limits.
