---
name: qa
description: Validate Code60 changes through complete, realistic user journeys using the existing headless Playwright browser harness. Use for QA, regression reproduction, release confidence, and validation of renderer, loopback API, bridge, configuration, provider fixture, lifecycle, or packaging changes, even when described as having no UI changes. Report evidence and blocked coverage honestly.
---

# Workflow QA

Read [AGENTS.md](../../../AGENTS.md) and the changed modules' instructions.
Use the existing harness, not a new QA plugin or a live agent.

## Choose the journey before the checks

1. Inspect the diff, the reported symptom and its **original starting state**.
   Reproduce that state, not a cleaner state that avoids the bug.
2. Map the change to user outcomes and adjacent ownership/lifecycle risks.
   Configuration, HTTP, fixtures and packaging can break complete journeys without
   changing renderer source. Do not automatically classify them as “no UI impact.”
3. Read the matching [workflow cards](references/workflows.md). Start with the
   golden path: request → plan → human acceptance → automatic working changes →
   read-only diff → code attachment → declined Undo → confirmed message Undo. Add affected
   first-use, navigation, restart, cancellation, scheduler or memory scenarios.
4. Write the selected starting states, checkpoints, independent expected outcomes
   and cleanup plan before running anything. Use the [report template](assets/report.md).

## Exercise the production path

- Drive visible controls through the real renderer, loopback API, bridge and main
  process. The checked-in golden path is `test/browser-workflow.e2e.ts`.
- Start first-use journeys in isolated HOME/config/state with **no saved verified
  setup**. A fixture may configure the fake provider executable, but cannot mark
  setup complete. Manual-database journeys create/select through the UI. The
  independent setup journey must prepare its database through the actual packaged
  setup CLI and still verify the provider and open the project through visible UI.
- Mock only external providers and native service supervisor boundaries. Drive
  host selection and confirmation through the browser dialogs. Use the real
  scriptable fake-agent subprocess, ACP, MCP gateway, filesystem and Git worktree.
  Assert chooser scope and both decline/confirm behavior.
- Do not call mutating `window.code60` methods, inject controller state, or
  invoke internal plan/dispatch/apply APIs to bypass steps being tested. Such
  tests may be useful **supporting integration tests**, not full user journeys.
- Assert intermediate invariants, not just final screenshots. Observe that no
  worker exists before acceptance; pin ownership through navigation/reload;
  compare exact files and Git index before/after automatic integration and Undo.
  Read-only snapshots may supplement UI evidence but cannot replace user actions.
- Use bounded condition-based assertions. Do not add arbitrary sleeps or retries
  that mask races. Do not require live providers, credentials or network access.

## Run safely

- Follow the [shared-host rules](../../../AGENTS.md#concurrent-work-on-a-shared-host).
  Record the assigned checkout/branch, selected host/container environment, owned
  process/container identities, ports and evidence paths before execution. Do not
  stop another task's listener or container, change shared Docker/Git settings,
  or treat a worktree label as ownership of every process in that container.
  Keep worker caps and coordinate heavy jobs; preserve failures and investigate
  resource contention before rerunning without weakening test thresholds.
- Run focused unit/static checks first, then `npm run check`. This command does
  **not** run the browser E2E suite.
- Build and exercise the production path with `npm run test:browser`. Use
  `npm run test:browser -- --grep "browser: first use"` for the golden path.
  Headless Chromium can run on the host; Electron and native-window tests have
  been removed. CI uses this same suite on Linux Node 24; manual native validation
  also runs it on macOS Apple Silicon.
- Start only isolated foreground gateways. Never install a per-user service,
  activate Git hooks or call a live provider without separate authorization.
  Inject native service controls for registration and handoff tests. Unit tests
  of service definitions do not establish native login/reboot behavior.
- Missing-provider journeys must use a clean environment and controlled PATH.
  Production path recovery adds common host tool directories even with a temporary
  HOME; use the trusted Node composition port to retain fixture paths while keeping
  real detection, installation and ACP verification. Never inherit host credentials
  or let a routine fixture probe an installed provider.
- Build with `npm run package:app`, then run `npm run test:packaged` to verify an
  installed npm tarball, bundled browser assets and offline embedding assets.
  This smoke test does not install a login service.
- For clean installation changes, also run `npm run test:packaged:clean` on the host
  after packaging. Follow the [harness guide](../../../test/clean-install/README.md).
  Its separate driver reuses the golden scenario against an installed, offline
  customer runtime; preserve run-specific traces and verified Docker cleanup.
- Platform payload changes additionally follow the [artifact workflow](../../../knowledge/operations/distribution/artifacts.md):
  run `npm run test:payload` on each supported target and the explicit Linux
  payload mode of the clean-install harness. Preserve the existing tarball journey.
  Verify extraction needs no npm/compiler/scripts and record both targets' exact
  descriptors, model results and owned staging/process cleanup. Bootstrap help and
  version checks alone do not prove acquisition, installation or setup; exercise
  the affected managed/setup journeys as well.
- Managed installation changes follow the [installation internals](../../../knowledge/operations/distribution/installation.md).
  Exercise the managed clean-install mode after cache removal and real login/
  interactive shells. Keep artifact-only and legacy journeys independent. Assert
  owned receipts/current pointer, command identity, preserved profile contents,
  cancellation and lock behavior. Never edit host profiles or install host fish.
- If a required runtime, browser, model or platform is unavailable, mark that
  journey BLOCKED. Do not substitute static checks for runtime evidence.
- Close test browser contexts, isolated gateways and provider processes on every
  exit path. Preserve traces and synthetic evidence. If Docker is used by any
  additional validation, remove only that run's containers and temporary images;
  never globally prune Docker or remove other work's resources.

- Setup changes additionally require `npm run test:setup` and the clean-install
  `--setup` mode. Assert files-only consent, strict metadata/data preservation,
  cache removal, repeated/restarted backend identity, read-only status and the full
  golden journey from a setup-created database. Use the dedicated bounded backend
  supervisor fixture, never legacy scheduler fixtures or a real host service.

- Update changes additionally require `npm run test:update` and clean-install
  `--update` mode. Assert verification and consent before interruption, original
  PID preservation on decline/preparation cancellation, quiescence before
  publication, authenticated new-version readiness and explicit recovery. Retain
  custom database/preferences, prior activation and original engine bindings.
  Exercise the shared golden journey after source caches are removed and while
  release/activation trees are read-only. On native macOS additionally verify
  approved workflows survive the actual update on their original engine/runtime.
  Native update file preparation is an independently bounded fixture, before
  visible onboarding, provider verification and approval. It creates no live
  backend or engine authority. Candidate generation and initial installation may
  run concurrently into separate owned destinations, with serialized evidence
  writes and both operations drained before cleanup. Keep its recorded timing/cleanup evidence and the
  existing six-minute user journey and ten-minute suite limits.

## Report what actually happened

Uninstall changes additionally require clean-install `--uninstall` mode and
`npm run test:uninstall` on the native supported target. Begin with the full shared
golden journey, then verify missing-consent/unowned-file refusal without backend
interruption, original backend/provider exit, exact owned file/service removal,
standalone repeated recovery and retained-data reinstall. Compare logical SQLite,
selection/configuration bytes, profiles and complete Git/index/HEAD/worktree state.
Keep read-only golden mounts; inspect the separate maintenance customer's shared
PID/loopback namespace and exact owned writable volumes. Real shell removal uses
`npm run test:installation`; report missing native/fish coverage explicitly.
Bounded supervisor fixtures are not native login/reboot certification.
An emulated kernel that cannot prove the recorded Node executable is BLOCKED
for native adoption; do not weaken identity checks or count it as native evidence.
Linux host checks can also report file-holder inspection BLOCKED on a kernel
permission refusal. The required native Linux container runs these process tests
with `CODE60_REQUIRE_NATIVE_PROCESS_INSPECTION=1`: that test-only setting forbids
permission-based skips and rejects unverifiable emulation. It does not change
application inspection or authorize native adoption.
Linux delivery also requires `npm run test:packaged:concurrent -- --uninstall release/payloads/linux-x64.json`:
CI runs it in a separately bounded required job after verifying the baseline
producer's exact artifact; do not append it to a nearly exhausted baseline job.
two complete journeys, with independent owner-labelled inventories and a real
survivor readiness/assets probe after the first cleanup. Retain both run reports
and the orchestration summary; injected gate tests alone are supporting evidence.

Write `test-results/qa/<run>/report.md` from the template, and summarize locally.
For each selected journey use PASS, FAIL or BLOCKED, exact command, starting state,
steps/checkpoints reached, expected versus actual results, evidence paths and gaps.
Unit/static checks, screenshots, test collection, documentation and plans cannot
establish E2E PASS. Label partial integration and authorized live-provider checks
separately. Do not promote a blocked journey to PASS because its unit tests pass.
Record process/container/image cleanup and retained evidence. Sanitize artifacts;
do not include real prompts, tokens or user content. Never post externally on your own.
