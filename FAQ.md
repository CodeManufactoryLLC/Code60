# Code60 FAQ

> **Applies to:** Code60 `v0.5.0-beta` · **Last update:** `2026-11-26`
> Open **Manage → About** or run `code60 status` to check the local Code60 version. See [Code60 Terminology](TERMINOLOGY.md) for key terms.

## Contents

- [Overview](#overview)
- [Requirements and Setup](#requirements-and-setup)
- [Workspaces and Worktrees](#workspaces-and-worktrees)
- [Data and Storage](#data-and-storage)
- [Security and Permissions](#security-and-permissions)
- [Licensing and Pricing](#licensing-and-pricing)
- [Orchestration and Workers](#orchestration-and-workers)
- [Context and History](#context-and-history)
- [Plans and Workflows](#plans-and-workflows)
- [Scheduled Jobs](#scheduled-jobs)
- [Accessibility](#accessibility)
- [Architecture and Development](#architecture-and-development)
- [Support and Feedback](#support-and-feedback)
- [Provider Support](#provider-support)

## Overview

### Is Code60 an agent?

No. Code60 is a local [orchestration](TERMINOLOGY.md#orchestration) application for coding agents. External [Agent Providers](TERMINOLOGY.md#agent-provider) supply the underlying models and coding agents.

Code60 connects to those providers through [Agent Client Protocol (ACP)](TERMINOLOGY.md#acp) and coordinates them using its [Two-Layer Architecture](TERMINOLOGY.md#two-layer-architecture). Code60 provides the browser interface, [Code60 Gateway](TERMINOLOGY.md#gateway), separate Git worktrees, plans, reviews, **Scheduled Jobs**, **Workflows**, and Model Context Protocol (MCP) management.

## Requirements and Setup

### Which platforms does Code60 support?

Code60 supports **macOS Apple Silicon** (`arm64`) and **Linux `x64`**.

- **macOS:** Requires Apple Silicon (`arm64`).
- **Linux:** Requires `x64` with `glibc` and `libgomp1`. Per-user background service setup also requires an active user `systemd` session. Alpine (`musl`) and Linux `arm64` remain outside current support.
- **Software prerequisites:** Requires Node.js 24 (`>=24.22.0 <25` for setup, updates, and uninstall), `npm`, Git, and at least one **Agent Provider**.
- **Browser access:** Runs in a modern browser on the host machine, or from another device on a private network through **Web Server (Beta)**.

### Does Code60 support Windows?

No. Code60 currently supports **macOS Apple Silicon** and **Linux `x64`** only and blocks startup on Windows hosts.

A Windows device can still open Code60's browser interface over a private local network through **Web Server (Beta)**. Code60 must still run on a macOS or Linux host for that setup.

### What are the system requirements for running Code60?

- **Operating system:** **macOS Apple Silicon** (`arm64`) or **Linux `x64`** with `glibc` and `libgomp1`. Linux service enrollment also requires an active user `systemd` session.
- **Runtime and tools:** Node.js 24 (`>=24.22.0 <25` for setup, updates, and uninstall), `npm`, Git, and at least one **Agent Provider**.
- **Hardware and power:** Code60 runs local embeddings on the CPU and requires no graphics card. Background scheduling requires an awake machine with an active user login session.
- **Browser and optional tools:** A modern desktop browser for the interface. Browser automation (`code60_browser`) also requires Chrome on the host machine, plus Microsoft's Playwright Chrome extension for existing-browser mode.

### What software do I need to run Code60?

- **Core software:** Node.js 24 (`>=24.22.0 <25` for setup, updates, and uninstall), `npm`, Git, and a modern web browser.
- **Agent Provider:** At least one [Agent Provider](TERMINOLOGY.md#agent-provider). A user can connect an existing command-line interface (CLI) or install a private copy for catalog providers from **Connect → Providers**.
- **Optional software:** Chrome on the host machine for `code60_browser` web automation (plus Microsoft's Playwright Chrome extension for existing-browser mode). Docker with Compose v2 is only for optional contributor container workflows.

See [What are the system requirements for running Code60?](#what-are-the-system-requirements-for-running-code60) for operating-system and hardware details.

### Do I need Docker to run Code60?

No. Code60 installs, runs, and supports local development without Docker.

Code60 runs natively on macOS Apple Silicon and Linux x64. It uses [Code60 Gateway](TERMINOLOGY.md#gateway) (a local Node.js 24 backend), a browser interface, and separate Git worktrees for coding agents.

Code60 also provides a Linux `x64` Docker image (`mjholliday/code60`) on port `6060` for container setups. See the [Docker distribution guide](docs/distribution/docker.md) for setup and security options.

Only optional contributor workflows require a local Linux Docker engine with Compose v2. Docker Desktop remains optional.

- **Linux development container:** Contributors run `npm run devcontainer -- start` for the optional [Linux development container](.devcontainer/README.md).
- **Clean-install acceptance tests:** Contributors run `npm run test:packaged:clean` for the container acceptance test suite.

Optional Docker agent workers for stricter filesystem and network boundaries appear on the future roadmap. Code60 runs without them.

### Does Code60 have a CLI?

Yes, for local lifecycle management only. The `code60` CLI cannot submit prompts or run coding agents.

- **Opening and pairing:** `code60 open` opens the browser interface, and `code60 pairing on|off|status` controls local pairing codes.
- **Installation and backend service:** `code60 setup`, `code60 status`, `code60 update`, `code60 uninstall`, and `code60 service` manage installation and the per-user Code60 Gateway service.

### Does Code60 have a native desktop app?

No. Code60 runs [Code60 Gateway](TERMINOLOGY.md#gateway) (a local Node.js 24 backend) with a React browser interface.

There is no Electron wrapper, native window application, or DMG, DEB, or AppImage installer. Closing or refreshing the browser keeps active agents, **Scheduled Jobs**, and **Workflows** running in the background.

### Does Code60 have a native mobile app?

No. Code60 has no native iOS or Android app.

A phone or tablet on the same private local network can open Code60's browser interface through **Web Server (Beta)**. A user turns it on from the controlling localhost browser under **Experiments → Web Server (Beta)** and enters the single-use 60-second code. File choosers still browse files on the host machine running Code60.

## Workspaces and Worktrees

### Do I need to update my repository to use Code60?

No. Code60 requires no special configuration files, scripts, or dependencies inside a repository. Opening a project never initializes Git or edits repository files automatically.

- **Git repository:** Separate Git worktrees for project workers, **Scheduled Jobs**, and **Workflows** require a Git repository with at least one commit. Without Git, **Relay** can still target a direct folder explicitly, or a user can run **Set up Git** in Chat.
- **Optional project config:** A user can optionally create `.code60/mcp.json` inside a repository for project-scope MCP servers. Git run records stay inside `<git-common-dir>/code60/runs/` without touching repository source files.

### Does Code60 automatically delete worktrees?

No. Code60 never deletes Git worktrees automatically.

- **Normal lifecycle events:** Finishing, cancelling, or stopping a run leaves existing worktrees intact. Closing the browser, stopping or restarting Code60 Gateway, updating Code60, or running `code60 uninstall` or `code60 service uninstall` also keeps them on disk.
- **Scheduled Jobs and Workflows:** Worktrees from **Scheduled Jobs** and **Workflows** stay on disk. A user can inspect changes and diffs with normal Git tools.
- **Manual removal:** For an inactive run, open its actions menu (for example, in **Apps → Data Viewer**) and choose **Delete worktree**. Code60 blocks removal while the run or its agent process remains active.
- **Confirmation and history:** Before removing a worktree and its run branch, Code60 shows a confirmation dialog. That dialog lists the worktree path, branch, and every file with edits that removal erases. After removal, the session record stays visible as inactive.

## Data and Storage

### How does Code60 store data?

Code60 keeps all application data locally on the host machine. New run directories and files use private permissions (`0700` and `0600`), and Code60 does not encrypt local files.

- **Databases:** Project history, configurations, **Internal Prompts** edits, and `$` commands live in SQLite (default `$XDG_DATA_HOME/code60/databases/default.sqlite`). Application memory uses a separate private `memory.sqlite`.
- **Run records and transcripts:** Runs write `run.json` and `events.jsonl` under `<git-common-dir>/code60/runs/`, `$XDG_STATE_HOME/code60/dirs/<key>/runs/`, or `.code60_workspace/` beside the database. Code60 does not automatically scrub or expire transcripts.
- **Configuration, workflows, and logs:** MCP files live at `$XDG_CONFIG_HOME/code60/mcp.json` and `<project>/.code60/mcp.json`, and **Workflows** state lives under `$XDG_STATE_HOME/code60/workflows`. Diagnostic logs under `$XDG_STATE_HOME/code60/logs` carry a 7-day, 20 MiB cap.
- **Credentials:** Provider logins stay in each provider's own backend-user storage. MCP secrets stay in macOS Keychain, Linux Secret Service, or explicit temporary backend memory.

### How much disk space does a Code60 installation use?

A base installation typically uses about **400 MB to 1 GB**, depending on platform and private provider installs. Total usage grows over time with Git worktrees and local transcripts.

| Component | Typical size or limit | Notes |
| --- | --- | --- |
| **Typical base total** | **About 400 MB to 1 GB** | Covers app files, local embeddings, and optional private providers. |
| Local embedding model | About 164 MB | Local INT8 weights for offline embeddings. |
| Embedding runtime dependencies | About 125 MB (macOS Apple Silicon) | Total with model is about 290 MB before other app files. |
| Private provider installs | Varies by provider | Lives under `~/.local/share/code60/providers/`. |
| Git worktrees | Varies by repository | Code60 never deletes worktrees automatically. |
| Conversation transcripts | No automatic limit | Local `events.jsonl` and **Relay** journals never expire automatically. |
| Request checkpoints | Up to 256 MiB per chat | Keeps up to 100 prior requests per chat. |
| Workflow history | Up to 8 MiB | Keeps up to 200 workflow records. |
| Diagnostic logs | Up to 20 MiB | Automatically expires after 7 days or 20 MiB. |
| **Scheduled Jobs** free-space guard | At least 2 GiB free | **Scheduled Jobs** refuse to start below 2 GiB free. |

Size figures reflect macOS Apple Silicon measurements for Code60 `v0.4.1` on `2026-11-25`. See [Low disk space](docs/runbooks/low-disk.md) for storage recovery guidance.

## Security and Permissions

### How does Code60 Auto-Approval work?

**Code60 auto-approval** sets one application-wide permission policy across both layers of Code60's [Two-Layer Architecture](TERMINOLOGY.md#two-layer-architecture). It covers orchestrators (**Relay**, **Custom Assistants**, and project chats) and their workers. The toggle sits beside **Harness mode** in the composer, starts on, and persists across restarts.

- **When on:** Code60 answers each new ACP permission request with a once-only allow option and never grants an always-allow rule. If the agent offers no matching once-only option, Code60 cancels the request.
- **When off:** Each new ACP request waits in the requesting conversation for a human to choose **Allow once** or **Deny**. The **Workspace** approval count opens a waiting conversation, including a project chat in the archive.
- **Live changes:** The toggle remains available during a turn and applies to new ACP requests in live and future sessions. Any request already waiting for review still needs a human answer after switching auto-approval back on.
- **Harness mode:** **Code60 auto-approval** operates separately from **Harness mode**. Choosing an Ask mode on a provider harness leaves **Code60 auto-approval** on. Any sandboxing depends on that provider harness.
- **Other run types and limits:** Manual runs, **Scheduled Jobs**, and **Workflows** keep separate permission policies. ACP permissions do not create an operating-system sandbox and cannot block actions an agent takes without requesting approval.

### Does Code60 provide a sandbox for my agents?

No. Code60 does not provide an operating-system, filesystem, or network sandbox for coding agents or MCP servers. Every agent runs with the backend user's operating-system permissions.

- **Code60 safeguards:** Browser and gateway checks protect the web interface and local application programming interface (API). Git worktrees separate Git working files, and the [Operating Contract](TERMINOLOGY.md#operating-contract) and ACP permissions guide behavior and approval prompts.
- **Security limits:** None of those controls creates an operating-system security boundary or blocks actions an agent takes without requesting ACP approval. See the [Security Policy](SECURITY.md) for full details.
- **Roadmap:** Optional Docker workers with filesystem, network, and resource boundaries appear in the [Code60 roadmap](ROADMAP.md).

### How do I provide a sandbox for my agents with Code60?

Apply sandboxing outside Code60 or through each [Agent Provider](TERMINOLOGY.md#agent-provider).

- **Provider sandbox:** Enable the sandbox settings and **Harness mode** options that each **Agent Provider** supports in its own CLI or configuration.
- **Container or virtual machine:** Run Code60 inside a container (such as the optional [Linux development container](.devcontainer/README.md)) or a virtual machine. A separate operating-system user account with narrow filesystem and network access also limits what agents can touch.
- **Manual approval review:** Turn off **Code60 auto-approval** in the composer to review each ACP permission request. Manual review helps inspect prompts, while operating-system boundaries still come from the provider sandbox, container, virtual machine, or user account.

### How does Code60 interact with my Agent Provider's sandbox?

Code60 leaves sandbox rules and enforcement to each [Agent Provider](TERMINOLOGY.md#agent-provider) and its own configuration.

- **Harness mode forwarding:** Code60 shows any **Harness mode** options an **Agent Provider** offers over ACP and forwards the user's choice. The harness determines what each mode does, including any sandbox behavior.
- **Separate from Code60 auto-approval:** **Code60 auto-approval** only answers ACP permission requests. Switching it on or off does not change a provider's operating-system sandbox. Choosing an Ask mode on the harness also leaves **Code60 auto-approval** on.
- **Workflows:** Each **Workflow** runs on the active **Agent Provider** the user selects, and that provider's harness owns any sandbox rules it applies.

### What security measures does Code60 take?

Code60 protects the browser interface, local API, orchestration gateway, files, processes, and credentials, while agents still run with the user's operating-system permissions. See the [Security Policy](SECURITY.md) for full details.

#### Browser, local network, and API boundaries

- **Localhost interface:** Code60 Gateway listens on `127.0.0.1` by default and enforces Host, Origin, and Content Security Policy (CSP) checks. Browser tabs use per-tab session tokens, explicit **Take control** transfers, and optional `code60 pairing on` codes.
- **Web Server (Beta) limits:** Optional local-network access starts off and uses only the primary private IPv4 address. It enforces single-use 60-second pairing codes with rate limits, separates local and network sessions, serves only static release assets, and blocks management routes.
- **Narrow application API:** Code60 Gateway validates every request against a strict operation map and exposes no generic shell or filesystem interface. File choosers accept only opaque IDs inside local workspace roots, and human confirmations stay browser-only.

#### Process, filesystem, and storage safeguards

- **Process safety:** Code60 spawns subprocesses with argument arrays without a shell and checks process identity before stopping any process. Local management commands authenticate through private filesystem metadata outside browser origins.
- **Symlink and file guards:** Private configuration and state operations reject symlinks, hard links, and world-writable paths using `O_NOFOLLOW` and atomic staging. New run directories and files use private permissions (`0700` and `0600`).
- **Diagnostics and redaction:** Operational errors and `stderr` tails apply best-effort redaction for common tokens, headers, and private keys. Diagnostic logs keep only strict event metadata and exclude prompts, transcripts, paths, and secrets.

#### Orchestration, MCP, and browser-tool controls

- **Orchestration gateway:** Code60's orchestration MCP server runs behind a token check on `127.0.0.1` with size and time limits. Workers never receive Code60's orchestration tools.
- **MCP servers and network policy:** Project MCP definitions start off and require human approval for their exact revision. Stdio servers run without a shell in an allowlist environment. HTTP servers check Domain Name System (DNS) destinations, block cloud metadata addresses, and require HTTPS for credentials outside loopback.
- **MCP secrets and OAuth:** Secrets stay in macOS Keychain, Linux Secret Service, or explicit temporary memory and never reach the browser. OAuth, an open authorization protocol, enforces S256 Proof Key for Code Exchange (PKCE), exact issuer checks, and single-use five-minute callbacks.
- **Browser automation tool:** The `code60_browser` tool runs Playwright in a private context and blocks host-code execution, installation, file upload, and page WebMCP tools. Workers, helpers, and **Scheduled Jobs** do not receive it.

#### Package integrity and repository checks

- **Provider setup and updates:** In-app provider setup checks release integrity, disables npm lifecycle scripts, and accepts only exact official HTTPS login domains. Code60 updates verify SHA-512 digests and complete file inventories before replacing a release, without running registry bootstrap code.
- **Repository security scans:** Security workflows run CodeQL, lockfile dependency audits, and Gitleaks secret scans on pull requests, pushes to `main`, and a weekly schedule.

### How does Code60 handle secrets?

Code60 keeps secrets out of configuration files, browser storage, diagnostic logs, and agent tool payloads, with different boundaries for each secret type.

- **Agent Provider credentials:** Code60 never asks for provider passwords or stores provider API keys. Each **Agent Provider** keeps credentials in its own backend-user storage. Temporary device codes and OAuth links stay inside the active setup dialog and never enter snapshots, browser storage, or logs.
- **MCP secrets and OAuth:** `mcp.json` files hold credential references and contain no raw secret values. Users save secrets into macOS Keychain, Linux Secret Service, or explicit temporary **Code60 Gateway** memory (which clears on restart or sign-out). Unavailable keychains never fall back silently, and no browser endpoint can read secrets back.
- **Session and management tokens:** Browser session tokens stay in per-tab session storage outside URLs and cookies. Local CLI management tokens stay in private local files outside browser reach, and single-use pairing codes expire after 60 seconds.
- **Redaction and transcript limits:** Diagnostic logs exclude prompts, transcripts, paths, and secrets, while error messages and `stderr` tails apply best-effort credential redaction. Code60 does not encrypt or automatically scrub conversation transcripts (`events.jsonl`), so users must keep secrets out of prompts and command arguments.

## Licensing and Pricing

### Can I use Code60 for commercial purposes?

Yes. Code60 ships under the [Apache License, Version 2.0](LICENSE), which permits commercial use, modification, and distribution under its terms.

- **Notices:** Redistributions must keep the license and attribution notices in [LICENSE](LICENSE) and [NOTICE](NOTICE).
- **Trademarks:** "Code60" and the Code60 logo belong to Code Manufactory LLC. The Apache License grants no trademark rights, so forks and commercial offerings must follow the [Trademark Policy](TRADEMARKS.md).
- **Provider terms:** Commercial use of external coding-agent providers also depends on each provider's own terms of service.

### How much does Code60 cost to use?

Code60 is free and open-source under the [Apache License, Version 2.0](LICENSE). Code60 uses your existing third-party coding agents and tools and is subject to their cost structure.

### How does Code60 affect token usage?

Code60 does not bill for tokens, and actual usage depends on the active **Agent Provider** and models. Total token usage balances extra upfront coordination against potential net savings on complex, multi-step tasks.

- **Upfront cost versus net savings:** Running an orchestrator alongside workers in Code60's [Two-Layer Architecture](TERMINOLOGY.md#two-layer-architecture) adds upfront tokens for instructions, tools, and updates. On complex, long-trajectory tasks, narrow worker contexts, plan review, and independent verification can reduce drift and rework. That higher reliability may reduce net token usage across the full task.
- **Parallel runs and workflows:** Running multiple workers in parallel increases immediate token usage. **Workflows** also spend tokens on independent verification, repair passes, and fresh-session retries.
- **Optional helper features:** Active **Memory** extraction, **Search** overviews, **Create with prompt** drafting, and automatic context handoffs send relevant context to the active provider. Turning **Memory** off stops memory extraction and recall.
- **Cost control and visibility:** The composer footer shows live context usage whenever the provider reports it. The **Model** picker lets a user set separate model and reasoning defaults for orchestrators and workers.

## Orchestration and Workers

### How are Code60 subagents different than my Agent Provider's subagents?

In Code60's [Two-Layer Architecture](TERMINOLOGY.md#two-layer-architecture), Code60 subagents (workers) are full Code60 sessions that run in separate Git worktrees. An [Agent Provider's](TERMINOLOGY.md#agent-provider) internal subagents run inside that single provider's process and stay outside Code60's orchestration controls.

- **Separate Git worktrees:** Each Code60 project worker edits files in its own Git worktree and run branch. Code60 integrates those edits safely and supports message-level **Undo**, whereas a provider's internal subagents typically share one working directory.
- **Cross-provider flexibility:** Code60 can dispatch workers using any active **Agent Provider** and apply separate model defaults for orchestrators and workers. A provider's internal subagents stay within that single provider's harness.
- **Direct visibility and control:** Each Code60 worker has its own sidebar chat, live transcript, and diff viewer. A user can directly message, cancel, stop, or resume a worker. Provider-internal subagents usually run as internal tool calls without separate Code60 worker views.
- **Local run records:** Code60 keeps local run records, transcripts, and process-group tracking for each worker. A user or orchestrator can inspect or continue an inactive worker later.
- **Using both together:** Code60 does not block a provider's internal subagents. If a harness spawns its own subagents inside a worker session, they run within that worker's worktree under that provider's control.

### Does Code60 use my Agent Provider's subagents?

No. Code60 does not call or manage an [Agent Provider's](TERMINOLOGY.md#agent-provider) internal subagents directly.

In Code60's [Two-Layer Architecture](TERMINOLOGY.md#two-layer-architecture), orchestrators delegate coding tasks by starting Code60 worker sessions through ACP. Each project worker runs in its own Git worktree with its own transcript and lifecycle controls.

Code60 does not block a provider's internal subagents. If a harness spawns its own subagents during a turn, they run inside that session's directory or worktree under that provider's control.

### Does Code60 have Computer Use capabilities?

No. Code60 has no native desktop [Computer Use](TERMINOLOGY.md#computer-use) control.

- **Web browser automation:** **Relay**, **Custom Assistants**, and project chats include the `code60_browser` tool using Playwright. It controls web pages in **Headless**, **Visible**, or **Existing Browser** mode and cannot control native desktop applications.
- **Scope and limits:** Workers, helpers, and **Scheduled Jobs** do not receive `code60_browser`. Message **Undo** does not undo external website changes.
- **External MCP servers:** A user can connect external MCP servers under **Connect → MCP Servers** for extra automation outside Code60's browser tool.

### Does Code60 support MCP?

Yes. Code60 supports [MCP](TERMINOLOGY.md#mcp) for both its own orchestration tools and external tool servers. See [MCP Configuration](MCP.md) for full details.

- **Orchestration tools:** In Code60's [Two-Layer Architecture](TERMINOLOGY.md#two-layer-architecture), orchestrators receive Code60's MCP tools for worker control, planning, reviews, and browser automation. Workers never receive those tools.
- **External MCP servers:** Under **Connect → MCP Servers**, a user can manage User and open-project servers with visual forms or strict JSON. Project server IDs override User IDs, new servers start off, and project servers require human approval for their exact revision.
- **Transports and scope:** Code60 supports `stdio` and Streamable HTTP transports for tools only. It omits legacy Server-Sent Events (SSE), resources, prompts, sampling, and elicitation.
- **Secrets and limits:** MCP secrets stay in macOS Keychain, Linux Secret Service, or explicit temporary memory, with S256 PKCE OAuth support. **Scheduled Jobs**, setup probes, and internal helpers receive no external MCP servers.

### Does Code60 limit the number of agents that I can run simultaneously?

Yes. Code60 applies per-feature concurrency limits alongside the host machine's resources and each **Agent Provider's** rate limits.

- **Interactive workers:** Each orchestration conversation (such as **Relay**, a **Custom Assistant**, or a project chat) defaults to **4** simultaneous workers (`maxParallel` in `config.json`). Idle workers still hold a slot while their process stays alive. Finishing or stopping an idle worker frees its slot.
- **Adjusting worker slots:** A user can raise `maxParallel` to any positive integer in `config.json`. Manual multi-copy runs cap at **32** copies per batch.
- **Scheduled Jobs:** At most **1** job from **Scheduled Jobs** runs globally at a time.
- **Workflows:** **Code60 Gateway** allows at most **1** active **Workflow** per source repository checkout at a time. A workflow whose start or stop still awaits confirmation also holds that slot until a user resolves it.
- **Custom Assistants:** Code60 supports up to **64** **Custom Assistants** application-wide.
- **Hardware and provider limits:** Running many agents at once still depends on local CPU, memory, and each **Agent Provider's** own rate limits.

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

Code60 neither triggers nor blocks an [Agent Provider's](TERMINOLOGY.md#agent-provider) internal context compaction. If a harness compacts its own context during a turn, Code60 lets it run normally.

- **Live context gauge:** The composer footer shows the token count and capacity that the provider reports over ACP and never guesses from transcript length. When a provider compacts context, the gauge can drop to match the new report.
- **Interaction with Code60 context handoff:** Between turns, Code60 starts automatic context handoff at 70% of context capacity. That check uses the higher of the provider's report and Code60's own session estimate. Code60's 70% rollover often occurs before late-window provider compaction, while early provider compaction still runs inside the harness.
- **Safety and continuity:** Neither provider compaction nor Code60's context handoff deletes local transcripts, restores old permissions, or replays past tool calls. Code60 also carries explicit in-session **Model** choices into the fresh handoff session.

## Plans and Workflows

### What is the difference between Plans and Workflows?

**Plans** guide interactive chat orchestration in [Code60 Gateway](TERMINOLOGY.md#gateway), while [Workflows](TERMINOLOGY.md#workflow) run standalone multi-task coding runs inside **Code60 Gateway**.

- **Execution and providers:** Both **Plans** and **Workflows** run on any active **Agent Provider** through ACP. **Plans** run inside chat (**Relay**, **Custom Assistants**, or project chats), while **Workflows** run under **Develop → Workflows** with a per-workflow provider choice.
- **Structure and verification:** A **Plan** is an optional task list that an orchestrator revises in chat and executes by dispatching interactive Code60 workers. A **Workflow** defines up to 100 sequential tasks with independent verification criteria, optional check commands, and automatic repair and retry limits.
- **Changes and lifecycle:** **Plans** integrate worker edits with message-level **Undo**, while **Workflows** keep all edits inside a separate Git worktree without automatic apply or **Undo**. Both continue running after closing the browser and pause or stop when **Code60 Gateway** stops.

### Do Plans use my Agent Provider's planning feature?

No. Code60 **Plans** use Code60's own orchestration MCP tools (`code60_create_plan`, `code60_read_plan`, and `code60_update_plan`).

Code60 still forwards any provider **Harness mode** (including a provider's own Plan mode) when a harness offers one in the composer. Selecting a provider's Plan mode controls only that harness's internal behavior. It does not open a Code60 plan tab, enforce Code60's **Accept** button, or tie tasks to Code60 workers.

### How are Code60 Plans different from agent plans?

Code60 **Plans** are application-level plans with human approval gates and worker tracking across Code60's [Two-Layer Architecture](TERMINOLOGY.md#two-layer-architecture). Agent plans live inside a single provider harness.

- **Human Accept gate:** A Code60 draft plan blocks new worker dispatches in that conversation until a human clicks **Accept** on that exact revision. No agent tool can accept a Code60 plan.
- **Worker-level tracking:** After human acceptance, the orchestrator dispatches separate Code60 workers with task IDs (`planTaskId`) and reports progress with evidence notes and worker IDs.
- **Provider independence:** Code60 **Plans** work identically across every active **Agent Provider** and open in Chat's right panel with progress and execution time.
- **Safe persistence:** Code60 stores plan Markdown files under the conversation workspace (`plans/<id>.md`) and reopens the latest plan through **View Plan**. Restarting Code60 keeps the plan document without restoring execution authority.

## Scheduled Jobs

### Where do Scheduled Jobs run?

**Scheduled Jobs** run locally on the host computer inside a mandatory separate Git worktree. There is no cloud runner or remote service.

- **Local backend service:** The per-user [Code60 Gateway](TERMINOLOGY.md#gateway) service (`launchd` on macOS or user `systemd` without linger on Linux) runs each job directly on the host machine. The machine must stay awake with an active user login session.
- **Separate Git worktree:** Each run creates a separate Git worktree from the job's local repository and base branch. It runs one headless turn under an explicit deny-by-default permission allowlist, without external MCP servers or implicit memory.
- **Manual review:** Code60 keeps the worktree, transcript, and diff on disk and never automatically applies, merges, commits, or pushes changes.

### Do Scheduled Jobs automatically resume when I restart my computer?

Future occurrences resume automatically when the per-user Code60 Gateway service is active, while incomplete runs and occurrences during downtime never replay.

- **Automatic service startup:** After `code60 service install`, `launchd` (macOS) or user `systemd` without linger (Linux) starts Code60 Gateway again when the user logs in. Future occurrences from **Scheduled Jobs** continue on their normal cadence.
- **No catch-up or replay:** Code60 never replays a run that stops during a reboot and never catches up on occurrences from sleep or downtime.
- **Uncertain leftover processes:** If a reboot leaves uncertain process ownership behind, Code60 pauses new launches. A user must confirm the old process no longer runs and clear the block in **Apps → System Manager**.

### Do Scheduled Jobs re-try automatically?

No. **Scheduled Jobs** never retry runs that fail, time out, or overlap with another active job.

Each occurrence runs one headless turn, and at most one job from **Scheduled Jobs** runs at a time. Code60 records the outcome in **Execution history** and waits for the next future occurrence. A user can inspect the transcript and changes under **Automate → Scheduled Jobs**, then click **Run** manually when ready.

## Accessibility

### Is Code60 accessible?

Code60 includes broad keyboard, screen-reader, contrast, and motion accessibility support, though formal accessibility certification remains future work on the [Code60 roadmap](ROADMAP.md).

- **Keyboard and focus:** Code60 uses IBM Carbon Design System components and includes a **Skip to main content** link. Menus, tables, trees, dialogs, and the command palette (`Cmd+K` or `Ctrl+K`) support full keyboard navigation. Closing overlays restores focus to the trigger control.
- **Screen readers and status cues:** Controls include accessible labels, Accessible Rich Internet Applications (ARIA) states, and polite or alert status announcements. Status indicators include text labels alongside color.
- **Themes, text, and system preferences:** **Personalize** settings offer **Light**, **Dark**, and **System** themes, a customizable accent color, adjustable interface text size, and optional signal colors. The interface also respects operating-system `forced-colors` (high-contrast) and `prefers-reduced-motion` settings by switching to system colors and turning off animations.
- **Current compliance status:** Code60 makes no formal Web Content Accessibility Guidelines (WCAG) compliance claim today. Full accessibility readiness sits under the `v0.12.0` milestone in the [Code60 roadmap](ROADMAP.md).

## Architecture and Development

### What programming language does Code60 use?

Code60 uses **TypeScript** for both Code60 Gateway (its local Node.js 24 backend) and its React browser interface.

- **Application code:** Core logic, gateway services, management commands, and the React user interface use TypeScript (`.ts`, `.tsx`, and `.mts`).
- **Styling and markup:** The browser interface uses Cascading Style Sheets (CSS), Sass (`SCSS`), and HyperText Markup Language (HTML) with IBM Carbon Design System styles.
- **Tooling and packaging:** Build, validation, and distribution scripts use JavaScript modules (`.mjs`) running on Node.js 24.

## Support and Feedback

### How do I report a bug?

Search existing issues first, then open the **Bug report** form on [GitHub Issues](https://github.com/CodeManufactoryLLC/code60/issues/new/choose).

- **Details to include:** Include the Code60 version or commit SHA, operating system, architecture, actual versus target behavior, and minimal reproduction steps.
- **Privacy checks:** Remove credentials, private prompts, repository content, and personal data from logs and screenshots before posting. Never attach whole run directories, raw transcripts, or private MCP journals and backups.
- **MCP reports:** For MCP problems, review and copy the opt-in safe troubleshooting report under **Apps → MCP Servers**.

### How do I report a security vulnerability?

Email **[support@code60.dev](mailto:support@code60.dev)** privately. Do not open a public issue or publish exploit details before coordinating disclosure.

- **Details to include:** Share the Code60 version, platform, reproduction steps, potential impact, and a minimal example without credentials, private prompts, or sensitive data. Only the latest release receives security fixes.
- **Response target:** Maintainers aim to acknowledge reports within five business days before reviewing and coordinating fixes. That five-day window is a response target and does not guarantee a fix date. See [Reporting a vulnerability](SECURITY.md#reporting-a-vulnerability).

### How do I request a feature?

Search existing issues first, then open the **Feature request** form on [GitHub Issues](https://github.com/CodeManufactoryLLC/code60/issues/new/choose).

- **Focus on the problem:** Describe the user problem before suggesting an implementation. Include the target behavior, observable acceptance criteria (such as error states and accessibility), and scope boundaries.
- **Review and other forms:** Maintainers check proposals against [ARCHITECTURE.md](ARCHITECTURE.md), including its non-goals, before scheduling work. Use the **Maintenance** form for tooling, documentation, dependency, or refactoring proposals.

## Provider Support

Code60 connects both layers of its [Two-Layer Architecture](TERMINOLOGY.md#two-layer-architecture) to coding-agent providers through ACP. It never asks for provider passwords and never stores API keys. Each provider keeps its own credentials in the backend user's storage.

The standard provider catalog covers **Antigravity, Claude, Codex, Copilot, Droid, Kiro, and OpenCode**. Under **Connect → Providers**, a user can verify a CLI that already holds an active login. A user can also run Code60's in-app installation and browser sign-in flow.

In-app setup verifies release integrity before placing exact versions into private backend-user storage. It leaves existing CLIs and configuration intact. Users manage API keys, account switching, logout, enterprise endpoints, and custom launch commands outside Code60.

The sections below cover individual providers:

- [Claude](#claude)
- [Codex](#codex)
- [Kiro](#kiro)
- [OpenCode](#opencode)
- [Droid](#droid)
- [Cursor](#cursor)

### Does Code60 work with local models?

Yes, through any agent that supports local models. Code60 does not run local language models directly and connects to coding-agent harnesses through ACP.

- **Through a harness:** A user can run local models when an ACP harness, such as **OpenCode**, points to a local model server. Code60's **Model** picker shows the models that active harness reports.
- **External setup:** Code60's in-app setup flows cover official cloud sign-ins only. Configuring a harness to call a local model server happens outside Code60 in that harness's own configuration.
- **Workflows:** **Workflows** support any active **Agent Provider** from **Connect → Providers**, including harnesses that call local model servers.
- **Local embeddings:** Separately from coding agents, Code60 runs its own embedding model offline on the CPU without a graphics card or external service.

### Does Code60 use my Agent Provider's existing repository skills?

Yes in the worker layer, **Scheduled Jobs**, and **Workflows**, where each **Agent Provider** discovers skills from the repository working directory.

- **Worker layer, Scheduled Jobs, and Workflows:** Code60 starts project workers, **Scheduled Jobs**, and **Workflows** inside the repository's Git worktree (or direct target folder). Each **Agent Provider** discovers repository skills and instruction files there according to its own rules.
- **Orchestration layer:** In Code60's [Two-Layer Architecture](TERMINOLOGY.md#two-layer-architecture), **Relay**, **Custom Assistants**, and project orchestrators run in private Code60 workspace folders outside the Git checkout. Provider harnesses generally do not auto-discover repository skills for the orchestrator.

### Does Code60 use my Agent Provider's existing user-level skills?

Yes, through each **Agent Provider**. Code60 does not read provider skill files directly, and it does not disable user-level skills during normal sessions.

- **Host environment:** Code60 launches **Agent Providers** with the backend user's normal home directory (`HOME`). Both orchestrators and workers receive whatever user-level skills and configuration that provider normally loads from the user's home directory.
- **Containers and custom paths:** The optional Linux development container gives each worktree its own private provider home volume separate from the host home directory. **Workflows** use the same provider environment as interactive sessions.

---

## Claude

### How does Code60 authenticate with Claude?

Code60 connects to Claude through ACP. It never asks for a password and never stores credentials.

- **Existing CLI:** If a Claude CLI with an active login already exists on the machine, verify and connect it under **Connect → Providers**.
- **In-app setup:** From **Connect → Providers**, install a private copy of Claude and its ACP adapter (`@agentclientprotocol/claude-agent-acp`) without overwriting existing tools. Choose **Claude subscription** or **Anthropic Console** sign-in, then complete login on `claude.ai`, `platform.claude.com`, or `console.anthropic.com`. Paste the authorization code from the browser into the setup dialog.
- **Storage and limits:** Claude keeps credentials in its own backend-user storage. Users manage API keys, account switching, logout, and custom launch commands outside Code60.

## Codex

### How does Code60 authenticate with Codex?

Code60 connects to Codex through ACP. It never asks for a ChatGPT password and never stores credentials.

- **Existing CLI:** If Codex already exists on the machine with an active login, select **Codex** under **Connect → Providers** to verify and connect it.
- **In-app installation:** Choose **Install Codex and sign in** or **Sign in to Codex**. Installation puts `@openai/codex@0.171.0` in `~/.local/share/code60/providers/codex/0.171.0` without replacing an existing CLI.
- **Device-code sign-in:** Copy the device code on screen, open `https://auth.openai.com/codex/device`, and authorize with a ChatGPT account. ChatGPT security settings must allow device-code login. Keep setup open until ACP verification finishes and shows "Connected."
- **Storage and limits:** Codex keeps credentials in its normal backend-user storage. Users manage API keys, account switching, logout, and custom launch commands outside Code60.

## Kiro

### How does Code60 authenticate with Kiro?

Code60 connects to Kiro through ACP (`kiro-cli acp`). It never asks for a password and never stores credentials.

- **Existing CLI:** If `kiro-cli` already exists on the machine with an active login, verify and connect it under **Connect → Providers**.
- **In-app setup:** Install a private copy of Kiro from **Connect → Providers** and start its browser device-code flow on `app.kiro.dev` or `view.awsapps.com`. Copy the code on screen, authorize in a browser, and wait for ACP verification to finish.
- **Storage and limits:** Kiro keeps credentials in its own backend-user storage. Organization policies may block device-code sign-in. Custom enterprise settings and custom launch commands require external setup.

## OpenCode

### How does Code60 authenticate with OpenCode?

Code60 connects to OpenCode through ACP (`opencode acp`). It never asks for passwords and never stores credentials.

- **Existing CLI:** If OpenCode already exists on the machine with model-provider credentials, verify and connect it under **Connect → Providers**. Code60 uses those credentials directly.
- **In-app setup:** Install a private copy of OpenCode from **Connect → Providers**. Sign in to **ChatGPT** (`auth.openai.com/codex/device`) or **GitHub Copilot** (`github.com/login/device`) through browser device-code OAuth, an open authorization protocol.
- **Temporary login server:** During sign-in, Code60 runs a temporary local loopback OpenCode server with a password and with external plugins off. Code60 stops that server when login finishes or stops.
- **Storage and limits:** OpenCode keeps credentials in its own backend-user storage. API keys, other model integrations, and custom launch commands require external setup.

## Droid

### How does Code60 authenticate with Droid?

Code60 connects to Droid through ACP (`droid exec --output-format acp`). It never asks for a password and never stores credentials.

- **Existing CLI:** If Droid already exists on the machine with an active login, verify and connect it under **Connect → Providers**.
- **In-app setup:** Install a private copy of Droid from **Connect → Providers** and complete Factory's browser device-pairing flow on `app.factory.ai`. Code60 runs an authentication-only handshake that grants no file, terminal, or tool permissions. It shows the verification link, plus a code when Factory sends one, then runs a fresh ACP check after pairing finishes.
- **Storage and limits:** Droid keeps credentials in its own backend-user storage. Custom launch commands and account management outside initial sign-in require external setup.

## Cursor

### How does Code60 authenticate with Cursor?

Cursor is currently absent from Code60's standard provider catalog. That catalog covers **Antigravity, Claude, Codex, Copilot, Droid, Kiro, and OpenCode**.

Code60 offers no in-app installation or sign-in flow for custom or external ACP launch commands. Users must authenticate those tools outside Code60 through each tool's own CLI.
