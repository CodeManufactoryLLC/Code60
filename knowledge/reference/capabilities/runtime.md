---
id: KB-REF-007
title: "Capabilities: Runtime Lifecycle and Monitoring"
domain: reference
kind: reference
status: active
summary: Generated capability specs for browser/backend lifecycle, Updates, Uninstall, System Manager, Health Check, and Usage.
updated: 2026-11-27
code_refs:
  - src/contracts/knowledge.ts
  - src/contracts/navigation.ts
tags:
  - capabilities
  - runtime
  - operations
  - reference
---

# Capabilities: Runtime Lifecycle and Monitoring

Generated from `src/contracts/knowledge.ts`. Do not edit by hand; run `npm run generate:capabilities`.

Schema version: 1

## Browser access and backend

- ID: `browser-runtime`
- Status: shipped
- Purpose: Connect a browser to the local Code60 backend and manage its lifetime.
- Access: Terminal → code60 setup, status or open; Workspace → Stop Code60 Backend
- Prerequisite: none
- Agent access: human-only
- Confirmation: Take control explicitly replaces another browser's control; stale page confirmations are rejected. Stopping the backend confirms cancellation of all interactive and scheduled work. Restart never replays uncertain tasks.
- Limits: macOS Apple Silicon and Linux x64 setup requires Node >=24.22.0 <25, npm and Git; Linux needs a working user systemd session for service enrollment. Managed installations support code60 setup [--yes] [--no-open] and read-only code60 status. A Linux x64 Docker image (mjholliday/code60) is also available on port 6060 for containerized browser access. Setup installs a durable launcher, separately requests shell-profile approval and default-no service consent, preserves valid custom selections and opens the browser for provider verification. Gateway startup and setup initialize the default database under XDG_DATA_HOME/code60/databases/default.sqlite (default ~/.local/share) when no selection exists yet. No provider authority or agent work is seeded. Without a TTY, service changes require Code60’s trailing --yes; no profiles are edited. Declined service consent returns files-only success with explicit incomplete status and a continuation command. --no-open skips the opener; opener failure retains a usable URL. Repeated setup reuses healthy files and selections without implicit updates. Status never repairs or starts services. The opt-in per-user backend starts at login. Browsers connect without a code by default, with per-tab sessions and one controlling browser. Local code60 pairing on/off/status makes the code requirement optional; setting changes require consent and revoke browser sessions without cancelling approved work. When enabled, the code is single-use and expires after sixty seconds. Closing or refreshing a browser preserves approved work. Workspace chooser roots default to the user's home and require local configuration to expand. No Electron, public hosting or general agent execution CLI.
- Pages: none
- Settings sections: none
- Tools: none

## Updates

- ID: `updates`
- Status: shipped
- Purpose: Inspect the installed version and terminal update/recovery commands.
- Access: Manage → Updates (also available from Apps → Updates)
- Prerequisite: none
- Agent access: human-only
- Confirmation: Local terminal consent is required before interrupting interactive/scheduled work; non-TTY changes require Code60's --yes. Prior releases, histories, custom databases, worktrees and settings are preserved. The browser shows installed version and terminal instructions only.
- Limits: Managed installations require Node >=24.22.0 <25 on macOS arm64 or Linux x64. code60 update resolves the stable npm bootstrap, verifies registry integrity and exact platform payloads before shutdown, then activates atomically and repairs service registration. code60 update status is read-only; code60 update recover explicitly repairs the current activation after interruption without database downgrade or replay. Setup never updates. No automatic downloads or checks from browser awareness, native installers or bundled Node.
- Pages: none
- Settings sections: `updates`
- Tools: none

## Uninstall Code60

- ID: `uninstall`
- Status: shipped
- Purpose: Remove an owned managed application installation while preserving user data.
- Access: Local terminal → code60 uninstall [--yes]
- Prerequisite: none
- Agent access: human-only
- Confirmation: Default-no local terminal consent is required; non-TTY operation needs Code60's trailing --yes. Shell-profile removal has its own exact preview and explicit interactive approval; --yes never approves profiles. Awareness cannot run uninstall, inspect service/process ownership or modify files.
- Limits: Requires a receipted installation and Node >=24.22.0 <25 on macOS arm64 or Linux x64. Linux workflow removal requires readable native procfs ownership evidence; restricted or unverifiable emulated process mappings refuse removal. Active or uncertain application, scheduled or independent workflow ownership refuses removal. The command quiesces verified idle owners, unregisters only its backend and removes receipted application releases and launcher. Databases, configuration, run records and project worktrees remain. Unrelated global/npm installations and changed launchers or profile blocks are preserved. No data-purge option. A printed absolute recovery launcher survives partial application/cache deletion; unfinished removal must be recovered before reinstalling. Reinstall validates retained ownership and data through normal setup; an old recovery cannot remove a later activation.
- Pages: none
- Settings sections: none
- Tools: none

## System Manager

- ID: `system-manager`
- Status: shipped
- Purpose: Inspect Backend Service scheduling health on the Services tab and active right-sidebar terminal sessions with their associated project on the Terminals tab.
- Access: Manage → System Manager (also Apps → System Manager; Services and Terminals tabs)
- Prerequisite: none
- Agent access: human-only
- Confirmation: Human CLI consent is required for service changes; scheduled jobs and terminal sessions retain their own explicit controls.
- Limits: Services automatically checks scheduler health every two seconds (respecting global Pause polling and backing off to sixty seconds on failure), with manual refresh. Install, repair, start, stop and uninstall use local code60 service commands. Terminals lists all live interactive shells with their project/Relay association, working directory, shell, PID, start time, and Close terminal control. No database is required; awareness never probes or controls services or terminals.
- Pages: `system-manager`
- Settings sections: none
- Tools: none

## Health Check

- ID: `health-check`
- Status: shipped
- Purpose: Inspect read-only system health across the Code60 backend, scheduler, providers, workspace stores, memory, MCP connectors, disk space and local machine context with granular per-check, category or full rechecks.
- Access: Manage → Health Check (also available from Apps → Health Check)
- Prerequisite: none
- Agent access: human-only
- Confirmation: Read-only diagnostics; active probes run only when explicitly requested by the user.
- Limits: No database is required. Passive local checks run on page open; active provider authentication probes, embedding checksum verification and optional registry release checks run only on explicit human request with per-check cancellation and never repair services or mutate state. Copy health report omits hostname, IP addresses, proxy hosts and filesystem paths by default unless explicitly opted in. Relay and awareness cannot run health probes or read host-identifying details.
- Pages: `health-check`
- Settings sections: none
- Tools: none

## Usage

- ID: `usage`
- Status: shipped
- Purpose: Monitor estimated token burn rates by provider, model and surface, inspect heavy chats and workflows, audit individual turns, and export JSON, CSV or Markdown reports.
- Access: Manage → Usage (also Apps → Usage) and local terminal → code60 usage
- Prerequisite: none
- Agent access: human-only
- Confirmation: Choose Clear usage history to remove retained usage rows while keeping transcripts, databases and worktrees. Cancel keeps history.
- Limits: No database is required. Captures quantitative per-turn telemetry across Relay, Custom Assistants, project chats, workers, Scheduled Jobs, Workflows and background helpers using a three-tier ladder (exact ACP PromptResponse.usage, derived usage_update/tool-wave estimates, and wire-text lower bounds). Local storage under $XDG_STATE_HOME/code60/usage/usage.sqlite retains up to 90 days or 500,000 turns of counts and opaque IDs only, never prompts, replies, file paths or credentials. Read-only monitoring without spend limits or guessed dollar rate tables; never exposed to agents, MCP or awareness.
- Pages: `usage`
- Settings sections: none
- Tools: none
