---
id: KB-OPS-002
title: Low Disk Space Recovery
domain: operations
kind: runbook
status: active
summary: Diagnose volume exhaustion affecting the 2 GiB scheduler floor, transcripts, databases, or diagnostics.
updated: 2026-11-27
code_refs:
  - src/automation/executor.ts
  - src/application/health-check.ts
related:
  - KB-OPS-001
  - KB-OPS-003
  - KB-OPS-004
tags:
  - runbook
  - disk
  - storage
---

# Low Disk Space Recovery

## 1. Symptoms

Scheduled Jobs history or **Manage → Health Check** reports `low_disk`, scheduled dispatches pause, persistence fails, or chat history and diagnostic logs cannot save. Scheduled job launches enforce a **2 GiB** free-space floor (not a capacity guarantee); interactive chat turns do not have that automatic guard.

## 2. Read-only diagnosis

1. Check free space on the repository, `HOME`/`XDG` state, and temporary/build volumes using `df -h` (or OS storage tools) and inspect `code60 heartbeat status --json` or **Manage → Heartbeat** — these can be separate mounts. Core Heartbeat proactively pauses future scheduled dispatches below 2 GiB and resumes them only when headroom recovers above 4 GiB (never overriding a manual pause or persistence-failure latch).
2. Inspect backend service status and execution history using [scheduler.md](scheduler.md).
3. Distinguish disk exhaustion from permissions, unsafe path identity, or live process ownership; freeing disk space does not repair those conditions.
4. Do not run builds or image builds during disk pressure merely to diagnose an installation.

## 3. Supported recovery (only after explicit consent)

1. Stop starting new agents, image builds, model downloads, and packaging jobs.
2. Ask permission before pausing future schedules or cancelling active work. Closing the browser leaves both interactive and scheduled work running; **Stop all** stops interactive work only; **Stop Code60 Backend** (`code60 service stop`) stops interactive agents, scheduled jobs, and active workflows together.
3. Remove only identified disposable output owned by the current task and no longer needed. Obtain explicit authorization before deleting any other user data, and retain evidence needed to diagnose failed or uncertain runs.
4. Never delete `node_modules`, package/BuildKit caches, other worktrees, SQLite databases, transcripts, Relay history, or lock files as a quick repair. Never run global Docker prune; `npm run devcontainer -- down` removes only its own container and exported image while preserving host artifacts and caches.
5. After restoring headroom on every affected volume, clear any persistence latch via supported stop/start or recheck procedures, then obtain explicit approval before resuming future schedules.

## 4. Verify

Recheck free space on every affected volume, **Manage → Health Check**, **Automate → Scheduled Jobs**, and history-saving status. Confirm checkouts, Git indexes, and worker evidence remain intact. A successful read does not prove writes recovered; verify a user-authorized synthetic write rather than replaying a failed or uncertain task.

## 5. Stop and escalate

If space cannot be freed from owned disposable output, ask the user what to move or delete or move to another host. Stop on identity/ownership errors or continuing persistence failures; never trade user data for a passing check.
