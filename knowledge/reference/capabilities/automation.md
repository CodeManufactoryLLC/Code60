---
id: KB-REF-004
title: "Capabilities: Scheduled Jobs, Workflows, and Heartbeat"
domain: reference
kind: reference
status: active
summary: Generated capability specs for recurring Scheduled Jobs, native multi-step Workflows, and Core Heartbeat maintenance inside Code60 Gateway.
updated: 2026-11-27
code_refs:
  - src/contracts/knowledge.ts
  - src/contracts/navigation.ts
tags:
  - capabilities
  - automation
  - workflows
  - heartbeat
  - reference
---

# Capabilities: Scheduled Jobs, Workflows, and Heartbeat

Generated from `src/contracts/knowledge.ts`. Do not edit by hand; run `npm run generate:capabilities`.

Schema version: 1

## Scheduled Jobs

- ID: `automations`
- Status: shipped
- Purpose: Scheduled Jobs opens on Schedules in a Carbon product shell and supports both Single prompt and Workflow jobs. Scan job name, type, schedule status, next run, live run status and agent. Run/Stop applies to one job and works independently of Enabled/Paused. Expand for the saved prompt or workflow task list, cadence, repository, branch and policy. The row actions menu offers Edit job, Enable/Pause schedule, View history and Delete. New scheduled job and Refresh are in the schedules toolbar. Create and edit use a dedicated form with a Job type selector and optional workflow task copy helper. The Execution history tab supports current-page search, sorting, single execution selection and Older/Latest paging. View history opens an explicit schedule filter. Show all schedules clears it. Select a prompt run to open Transcript or Changes beside its row, including live, assembled execution transcripts, or select a workflow run to open it directly in Workflows or inspect Changes. Legacy saved grid preferences stay stored.
- Access: Automate → Scheduled Jobs (also Apps → Scheduled Jobs)
- Prerequisite: none
- Agent access: human-only
- Confirmation: Human installation and schedule consent.
- Limits: Concurrency uses per-type lanes (1 single-prompt job and 2 workflow jobs globally) plus per-repository exclusivity, holding slots until terminal state. Prompt jobs use a deny-by-default tool allowlist; workflow jobs branch from the saved local base branch, expose autoApprove and run natively inside Workflows. Transcripts subscribe before reading, refresh from saved-chunk notices, retain partial content on errors and show bounded evidence with execution status. Closing the browser and interactive Stop all leave scheduled work running. Stopping the backend stops both. Delete requires browser confirmation and refuses active jobs; evidence is preserved. Run state is independent of schedule enablement and history paging. Older services without live job state require a service restart for run/stop controls. Run/Stop controls use text labels; Carbon content follows Light/Dark/System while retaining its own productive typography and standard controls. Awareness never installs or probes the service.
- Pages: `automations`
- Settings sections: none
- Tools: none

## Workflows

- ID: `workflows`
- Status: shipped
- Purpose: Inspect saved definitions or edit a copy for fresh review. Use Execution history to open the player for one run, including runs started from Scheduled Jobs (marked with a Scheduled badge). Create ordered coding workflows manually or through Create with prompt, choose any verified Code60 provider, review and explicitly start them in dedicated saved-file worktrees, or schedule recurring workflows from Scheduled Jobs off a local base branch. Track independent verification, repairs, decisions and accepted diffs.
- Access: Automate → Workflows (also Apps → Workflows)
- Prerequisite: runtime
- Agent access: human-only
- Confirmation: Existing permissions apply.
- Limits: The player shows run activity with tool calls collapsed until expanded, recorded execution time, accepted-task progress, scheduled provenance when triggered by a schedule and ordered task configuration/results. Pause and resume are available for all active workflows. Choose Stop workflow to stop permanently. Cancel has initial focus. Execution runs directly inside Code60 Gateway using your verified Code60 providers over ACP with local SQLite state and private Git snapshots—no separate engine daemon, bundled runtime or separate workflow login is required. Automatic permission approvals default on. Work continues after closing the browser while the Code60 backend stays running; stopping the backend pauses or ends active workflows. Create with prompt uses the Carbon prompt line with Send and Stop and a 16,000-character input limit. Prompt drafting uses the verified primary provider, bounded root README/package scripts and no tools; generated fields never start work. Source files, HEAD and index stay unchanged; worktrees/evidence remain. No automatic apply or Undo integration. Read-only views never start execution. One active or uncertain workflow per source checkout across manual and scheduled runs; at most 100 ordered tasks with 30 checks each, repair/retry allowances 0–30 (default two), and 1,000 retained workflows within 16 MiB. Activity is paginated with labelled excerpts above 32,768 characters per detail and a display window of 1,000 events within one million characters. Drafting is bounded to 20 messages, 120 seconds, and 160,000 characters each for composed context and output.
- Pages: `workflows`
- Settings sections: none
- Tools: none

## Heartbeat

- ID: `heartbeat`
- Status: shipped
- Purpose: Inspect recurring and manual Core Heartbeat sweeps, view all eight maintenance actions with initiation, termination and duration timestamps, initiate manual or dry-run sweeps, browse recent sweep history, and configure autonomous hygiene policies.
- Access: Manage → Heartbeat (also Apps → Heartbeat) and local terminal → code60 heartbeat
- Prerequisite: none
- Agent access: read
- Confirmation: Manual Run heartbeat, Dry run, Cancel, and Policy changes are human-only in Manage → Heartbeat or local code60 heartbeat CLI.
- Limits: No database is required. Stores bounded policy and the last 50 sweeps in $XDG_STATE_HOME/code60/heartbeat/state.json (up to 512 KiB) without consuming the 5,000-entry Scheduled Jobs execution budget. Autonomously runs passive health sweeps, reconciles dead-owner runs, stops verified orphan processes, clears verified leftover-agent blocks, restarts capped stateless sidecars, applies 2 GiB/4 GiB low-disk pause/resume hysteresis, prunes stale temp/Git metadata, and removes terminal zero-diff or already-discarded code60/* worktrees past the configured age limit while preserving worktrees with edits, locks, and history. Never replays uncertain work, commits, merges, or pushes. Agents can read redacted aggregate status via code60_get_heartbeat_status without paths, hostnames, IPs, raw logs, or policy/trigger authority.
- Pages: `heartbeat`
- Settings sections: none
- Tools: `code60_get_heartbeat_status`
