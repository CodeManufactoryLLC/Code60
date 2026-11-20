---
name: qa
description: Validate Code60 changes through complete, realistic user journeys using the existing Playwright/Linux-container harness. Use for QA, regression reproduction, release confidence, and validation of renderer, preload, bridge, configuration, provider fixture, lifecycle, or packaging changes, even when described as having no UI changes. Report evidence and blocked coverage honestly.
---

# Workflow QA

Read [AGENTS.md](../../../AGENTS.md) and the changed modules' instructions.
Use the existing harness, not a new QA plugin or a live agent.

## Choose the journey before the checks

1. Inspect the diff, the reported symptom and its **original starting state**.
   Reproduce that state, not a cleaner state that avoids the bug.
2. Map the change to user outcomes and adjacent ownership/lifecycle risks.
   Configuration, IPC, fixtures and packaging can break complete journeys without
   changing renderer source. Do not automatically classify them as “no UI impact.”
3. Read the matching [workflow cards](references/workflows.md). Start with the
   golden path: request → plan → human acceptance → automatic working changes →
   read-only diff → code attachment → declined Undo → confirmed message Undo. Add affected
   first-use, navigation, restart, cancellation, scheduler or memory scenarios.
4. Write the selected starting states, checkpoints, independent expected outcomes
   and cleanup plan before running anything. Use the [report template](assets/report.md).

## Exercise the production path

- Drive visible controls through the real renderer, preload, bridge and main
  process. The checked-in golden path is `test/agent-workflow.e2e.ts`.
- Start first-use journeys in isolated HOME/config/state with **no saved verified
  setup**. A fixture may configure the fake provider executable, but cannot mark
  setup complete. Create the database and open the project through the UI.
- Mock only external provider and native dialog boundaries. Use the real
  scriptable fake-agent subprocess, ACP, MCP gateway, filesystem and Git worktree.
  Assert native dialog types/options and both decline/confirm behavior.
- Do not call mutating `window.desktop` methods, inject controller state, or
  invoke internal plan/dispatch/apply APIs to bypass steps being tested. Such
  tests may be useful **supporting integration tests**, not full user journeys.
- Assert intermediate invariants, not just final screenshots. Observe that no
  worker exists before acceptance; pin ownership through navigation/reload;
  compare exact files and Git index before/after automatic integration and Undo.
  Read-only snapshots may supplement UI evidence but cannot replace user actions.
- Use bounded condition-based assertions. Do not add arbitrary sleeps or retries
  that mask races. Do not require live providers, credentials or network access.

## Run safely

- Run focused unit/static checks first, then `npm run check`. This command does
  **not** run Electron tests.
- Collect with `npx --no-install playwright test --list agent-workflow.e2e.ts`.
  Collection only proves selection, not runtime success.
- Local desktop execution uses only
  `npm run test:desktop:container -- --grep "workflow: first use through plan, automatic edits, code references and message Undo"`.
  Use the same container entry point with other matching scenario names.
  CI already runs registered Playwright tests. Do not create duplicate QA CI.
- If Docker, disk space, assets or sandboxing blocks execution, stop that step
  and report BLOCKED. Never build a new image under an active disk-pressure
  restriction or fall back to host Electron. Never install a scheduler/service,
  activate Git hooks or call a live provider without separate authorization.
- The container runner removes its owned container and temporary exported image.
  Check both cleanup results, including failures/interruption. Keep BuildKit and
  dependency caches and host test artifacts. Never globally prune Docker.

## Report what actually happened

Write `test-results/qa/<run>/report.md` from the template, and summarize locally.
For each selected journey use PASS, FAIL or BLOCKED, exact command, starting state,
steps/checkpoints reached, expected versus actual results, evidence paths and gaps.
Unit/static checks, screenshots, test collection, documentation and plans cannot
establish E2E PASS. Label partial integration and authorized live-provider checks
separately. Do not promote a blocked journey to PASS because its unit tests pass.
Record process/container/image cleanup and retained evidence. Sanitize artifacts;
do not include real prompts, tokens or user content. Never post externally on your own.
