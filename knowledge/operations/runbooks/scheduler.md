---
id: KB-OPS-001
title: Backend Service and Scheduled Jobs Recovery
domain: operations
kind: runbook
status: active
summary: Diagnose and recover Code60 Backend Service registration, paused schedules, and unfinished-work blocks.
updated: 2026-11-27
code_refs:
  - src/gateway/server.ts
  - src/management/cli.ts
  - src/renderer/system-manager.tsx
  - src/automation/scheduler.ts
related:
  - KB-OPS-002
  - KB-ARCH-006
tags:
  - runbook
  - scheduler
  - service
---

# Backend Service and Scheduled Jobs Recovery

## 1. Symptoms

**Automate → Scheduled Jobs** reports the backend service unavailable, the login service does not restart after an update, future schedules are paused, or unfinished work blocks new launches. Closing the browser keeps both interactive agents and scheduled jobs running; **Stop all** stops interactive work only, whereas **Stop Code60 Backend** (`code60 service stop`) stops interactive agents, scheduled jobs, and active workflows together.

## 2. Read-only diagnosis

1. Open **Manage → System Manager** (Services tab). Health checks poll every two seconds while visible and back off to sixty seconds when unavailable. Global **Pause polling** (under **Workspace** or **Manage → Polling**) pauses these checks; use **Refresh Backend Service** for an explicit check.
2. Inspect installation, connectivity, pause state, active runs, and blocks independently. Open **Automate → Scheduled Jobs** to review saved schedules and execution history. An unreachable service does not prove execution stopped; preserve that failure.
3. Run read-only terminal checks under the affected user account and normal `HOME`/`XDG` environment:
   - `code60 status` and `code60 service status`
   - Verify the user is logged in and awake, the installed Node 24 runtime exists, and the per-user supervisor (`launchd` on macOS, `systemd --user` without linger on Linux) owns the service. Never launch a competing standalone scheduler.

## 3. Supported recovery (only after explicit consent)

1. **Manage service lifecycle from the local terminal:** Browser controls never install, start, stop, repair, or uninstall the backend service (`src/gateway/server.ts`). Use consented CLI commands:
   - `code60 service stop` — explains interruption, cancels active interactive/scheduled/workflow work, and stops the backend.
   - `code60 service start` — starts an installed stopped service.
   - `code60 service repair` — refreshes registered Node/application paths for a stale runtime (or run `code60 update recover` after an interrupted managed update). Never bypass ownership or cleanup refusals.
2. **Cancel a single running job:** In **Automate → Scheduled Jobs**, use the job's **Stop** button (recurrence pause/enable is independent).
3. **Clear an unfinished-agent block:** Verify that recorded owned processes have exited, then click **Recheck** in **Manage → System Manager**. Live or unverifiable ownership must remain blocked.
4. **Clear a persistence-failure latch:** Fix underlying storage (see [low-disk.md](low-disk.md)) before running `code60 service stop` and `code60 service start`.
5. **Resume schedules:** Inspect execution history and repository/provider identities, then click **Resume jobs** in **Manage → System Manager**. Resuming enables future occurrences only; never click **Run** to replay uncertain work.

## 4. Verify

Observe healthy status in **Manage → System Manager** (`code60 service status`) and refresh **Automate → Scheduled Jobs**. Confirm connectivity, expected pause state, cleared blocks, future run times, and zero duplicate executions. Keep worktrees and history intact.

## 5. Stop and escalate

Stop on malformed or unsafe storage, changed repository/provider identity, unavailable service managers, unverifiable ownership, or failed cleanup. Preserve state and evidence; never delete locks, edit claims, erase records, replay interrupted work, or repeat install loops.
