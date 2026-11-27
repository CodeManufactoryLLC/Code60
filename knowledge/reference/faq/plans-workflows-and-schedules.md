---
id: KB-REF-016
title: "FAQ: Plans, Workflows, and Scheduled Jobs"
domain: reference
kind: reference
status: active
summary: Frequently asked questions on Code60 Plans versus Workflows, provider planning modes, and Scheduled Jobs execution and recovery.
updated: 2026-11-27
code_refs:
  - src/core/workflow-engine.ts
  - src/application/plans.ts
  - src/automation/scheduler.ts
related:
  - KB-REF-014
  - KB-OPS-001
tags:
  - faq
  - plans
  - workflows
  - scheduler
---

# FAQ: Plans, Workflows, and Scheduled Jobs

> **Applies to:** Code60 `v0.5.0-beta` · **Last update:** `2026-11-27`
> Open **Manage → About** or run `code60 status` to check the local Code60 version.

## Plans and Workflows

### What is the difference between Plans and Workflows?

**Plans** guide interactive chat orchestration in Code60 Gateway, while Workflows run standalone multi-task coding runs inside **Code60 Gateway**.

- **Execution and providers:** Both **Plans** and **Workflows** run on any active **Agent Provider** through ACP. **Plans** run inside chat (**Relay**, **Custom Assistants**, or project chats), while **Workflows** start manually under **Automate → Workflows** or on a cadence under **Automate → Scheduled Jobs**.
- **Structure and verification:** A **Plan** is an optional task list that an orchestrator revises in chat and executes by dispatching interactive Code60 workers. A **Workflow** defines up to 100 sequential tasks with independent verification criteria, optional check commands, and automatic repair and retry limits.
- **Changes and lifecycle:** **Plans** integrate worker edits with message-level **Undo**, while **Workflows** keep all edits inside a separate Git worktree without automatic apply or **Undo**. Both continue running after closing the browser and pause or stop when **Code60 Gateway** stops.

### Do Plans use my Agent Provider's planning feature?

No. Code60 **Plans** use Code60's own orchestration MCP tools (`code60_create_plan`, `code60_read_plan`, and `code60_update_plan`).

Code60 still forwards any provider **Harness mode** (including a provider's own Plan mode) when a harness offers one in the composer. Selecting a provider's Plan mode controls only that harness's internal behavior. It does not open a Code60 plan tab, enforce Code60's **Accept** button, or tie tasks to Code60 workers.

### How are Code60 Plans different from agent plans?

Code60 **Plans** are application-level plans with human approval gates and worker tracking across Code60's Two-Layer Architecture. Agent plans live inside a single provider harness.

- **Human Accept gate:** A Code60 draft plan blocks new worker dispatches in that conversation until a human clicks **Accept** on that exact revision. No agent tool can accept a Code60 plan.
- **Worker-level tracking:** After human acceptance, the orchestrator dispatches separate Code60 workers with task IDs (`planTaskId`) and reports progress with evidence notes and worker IDs.
- **Provider independence:** Code60 **Plans** work identically across every active **Agent Provider** and open in Chat's right panel with progress and execution time.
- **Safe persistence:** Code60 stores plan Markdown files under the conversation workspace (`plans/<id>.md`) and reopens the latest plan through **View Plan**. Restarting Code60 keeps the plan document without restoring execution authority.

## Scheduled Jobs

### Where do Scheduled Jobs run?

**Scheduled Jobs** run locally on the host computer inside a mandatory separate Git worktree. There is no cloud runner or remote service.

- **Local backend service:** The per-user Code60 Gateway service (`launchd` on macOS or user `systemd` without linger on Linux) runs each job directly on the host machine. The machine must stay awake with an active user login session.
- **Separate Git worktree:** Each run creates a separate Git worktree from the job's local repository and base branch. Single-prompt jobs run one headless turn under an explicit deny-by-default allowlist, while workflow jobs run multi-task **Workflows** with an `autoApprove` option. Both receive Code60's read-only Vector Codebase Search tools without external MCP servers or implicit memory.
- **Manual review:** Code60 keeps the worktree, transcript, and diff on disk and never automatically applies, merges, commits, or pushes changes.

### What kinds of jobs can Scheduled Jobs run?

**Scheduled Jobs** uses an extensible action model that currently supports **Single prompt** jobs and **Workflow** jobs.

- **Single prompt jobs:** A single-prompt job runs one headless turn inside a separate Git worktree from the local base branch. It uses an explicit deny-by-default tool allowlist and records a transcript and diff in **Execution history**.
- **Workflow jobs:** A workflow job launches a multi-task **Workflow** from the local base branch with repairs, retries, and an `autoApprove` toggle. When `autoApprove` stays off, permission requests pause the run for human review.
- **Live workflow interaction:** Every workflow run from **Scheduled Jobs** appears inside **Automate → Workflows** with a **Scheduled** tag. A user can inspect activity, pause, resume, steer, answer questions, or stop the run there.

### Do Scheduled Jobs automatically resume when I restart my computer?

Future occurrences resume automatically when the per-user Code60 Gateway service is active, while incomplete prompt runs and occurrences during downtime never replay.

- **Automatic service startup:** After `code60 service install`, `launchd` (macOS) or user `systemd` without linger (Linux) starts Code60 Gateway again when the user logs in. Future occurrences from **Scheduled Jobs** continue on their normal cadence.
- **No catch-up or prompt replay:** Code60 never catches up on downtime occurrences and never replays a single-prompt run that stops during a reboot. Active **Workflow** runs still use **Workflows** restart reconciliation under **Automate → Workflows** and re-attach their status in **Scheduled Jobs**.
- **Uncertain leftover processes:** If a reboot leaves uncertain process ownership behind, Code60 pauses new launches. A user must confirm the old process no longer runs and clear the block in **Apps → System Manager**.

### Do Scheduled Jobs re-try automatically?

No. **Scheduled Jobs** never retry occurrences that fail, time out, or overlap with another active job.

Single-prompt jobs run one headless turn, while workflow jobs still apply their own in-run verification, repair passes, and fresh-session retries within that single run. Concurrency lanes enforce per-type limits and allow at most one active job per repository checkout. Code60 records every outcome in **Execution history** so a user can review results and click **Run** manually when ready.
