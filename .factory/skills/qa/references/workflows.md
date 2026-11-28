# User workflow cards

## State-preserving uninstall

- Start with a real managed installation, retained customer database/preferences,
  fake verified provider and synthetic Git work. Complete the shared golden
  journey before removal; capture data, Git/index/HEAD/worktrees and process IDs.
- Decline service removal and verify no backend interruption or installation
  changes. With explicit consent, inspect active/uncertain workflow ownership
  before quiescence, unregister only the owned service and verify exact process
  exit before removing application files. Inspecting engines must not start them.
- Interrupt cleanup and resume using durable support after temporary caches are
  gone. Modified files/directories/links and foreign launchers remain intact with
  recovery guidance. Repeated uninstall and reinstall preserve and validate data;
  there is no purge or uncertain-work replay.
- Approve profile removal separately in an interactive terminal; check real
  Bash/zsh/fish startup, declined/non-TTY behavior, CRLF/permissions, outside edits
  and partial completion. Preserve modified or ambiguous blocks and unrelated
  bytes. Do not install host fish or touch real host profiles/services.
- Retain full Linux/native evidence and independently verify owned process and
  Docker resource cleanup. Unit tests establish supporting behavior only; native
  login/reboot certification remains separate Phase 9 work.
- Exercise the actual recovery launcher from another directory after entrypoint
  and temporary cache deletion. Changed HOME/XDG must not select another service
  scope. Verify SIGINT/SIGTERM results and helper-process exit independently;
  release failures remain failures even after completed deletion. Preserve
  completed receipts and prove an old recovery cannot remove a reinstallation.

## Explicit update and recovery

- Start from a real isolated managed installation with a valid custom database,
  verified fake provider and synthetic Git project. Obtain a newer stable
  bootstrap through internal registry transport injection; verify its integrity
  and embedded descriptors as data, without executing its code.
- Assert that preparation and declined consent preserve the original backend PID
  and current activation. With consent, verify full quiescence and PID exit before
  publication, then new-version authenticated readiness through the durable launcher.
  Complete the shared golden journey, including attachment, refresh and both Undo decisions.
- Compare database/preferences, Git/index/HEAD/worktrees and retained prior files
  independently.
- Fault registry/hash, shutdown, registration, readiness and publication boundaries.
  Recovery retains whichever generation was published, never downgrades a database,
  replays work, overwrites outside service edits or reclaims uncertain locks.
- Use bounded supervisor fixtures only; retain logs/traces and unique artifact,
  process/container/image/volume identities. Verify cleanup without touching other
  agents' state. Real login/reboot certification remains separate Phase 9 work.

## Native workflows

- **Start:** isolated HOME, config/data/state, verified fake ACP provider, and a
  synthetic Git repository with staged, unstaged, and untracked edits.
- **Actions:** create workflows manually and via Create with prompt, select a
  verified provider, review and start, pause and resume across reload, steer,
  answer permission decisions, inspect accepted diffs, and cancel with confirmation.
- **Invariants:** reads/review never start execution. Source files, index, and
  HEAD stay unchanged; workers write only the dedicated worktree.
- **Evidence:** `npm run test:browser -- --grep 'workflow:'`, with traces,
  screenshots, persisted SQLite/registry assertions, and independent Git checks.

Use synthetic projects and isolated private state. Each card is a user journey,
not a claim that all of its steps are already automated. Check current selectors
and supported controls before extending tests. Retain evidence under ignored
`test-results/`, and clean up only resources created by the run.

## Request through undo (golden path)

- **Prerequisites:** built Node backend and bundled browser app, Git, fake ACP executable,
  real host chooser and browser confirmations, committed synthetic repository.
- **Starting state:** empty HOME/config/state, provider command configured but no
  verified setup; repository has unrelated staged and unstaged edits.
- **Actions:** choose/connect provider in setup, close setup, create database,
  Start, open project, select Relay; send a readable target request, inspect plan,
  Accept; wait for automatic checkout changes and one quiet files-changed link.
  Open the pinned read-only diff, select code and Add to chat with an existing
  draft. Reload, verify retained draft/reference, decline Undo on the latest
  user message, then confirm it. Verify returned unsent request and chat rewind.
- **Intermediate invariants:** no worker worktree/process before Accept; one
  accepted plan owns worker dispatch; isolated work integrates automatically
  without Apply; incoming results do not open panels or steal focus. Attachment
  preserves the draft and sends nothing. Reload does not redispatch; declined
  Undo leaves changes/context/draft untouched. Confirmed Undo never resends.
- **Independent checks:** exact worker and checkout bytes, worktree inventory,
  unchanged unrelated staged/unstaged bytes, index and HEAD throughout isolated
  integration/Undo; worker evidence survives privately; owned workers exit on
  Undo, unrelated conversations remain active, and discarded provider context
  cannot return on the next Send or restart. Direct-folder snapshots explicitly
  warn and test that manual edits since their checkpoint rewind too.
- **Evidence:** selected plan/revision and dialog assertions, worker/result paths
  in synthetic artifacts, Git/index comparisons, retained failure trace.
- **Cleanup:** close the isolated backend, verify owned processes gone, remove isolated fixture
  only after checks; retain artifacts/cache; no native service is installed.

## Setup-created database first use

- Start with isolated empty state and invoke the actual packaged setup entry with
  internal artifact transport injection and a bounded backend supervisor fixture.
- Default-no/non-TTY setup reports files-only success; explicit service consent
  reaches authenticated readiness and database preparation without provider authority.
- Remove transient caches, run the persistent launcher elsewhere and complete the
  shared golden journey with provider verification and project choice through UI.
- Compare database/preferences, exact Git/index/HEAD/worktree state, process identity,
  repeat/restart/pairing behavior and owned cleanup. Keep manual-database coverage.
- Real native login lifecycle remains separately isolated Phase 9 coverage.

## First use and reopening

- **Prerequisites/start:** fake provider only, empty private storage, committed
  synthetic repository; no preseeded setup/database/project selection.
- **Actions:** visible setup, database create/select, Start, Open Project; complete
  a real request, stop/restart the isolated backend using the same isolated state.
- **Invariants:** setup verification comes from connection, database picker
  cancellation does not fake a connection, reopening retains evidence but does
  not grant saved workers or pending plans authority.
- **Independent checks/evidence:** private settings and SQLite existence, no
  duplicate worker worktrees/process launches; UI checkpoint/trace.
- **Cleanup:** close browser contexts and the isolated backend and verify no children remain.

## Navigation and concurrent ownership

- **Prerequisites/start:** two synthetic committed projects, one active worker
  in A; Relay work in a separate known target when relevant.
- **Actions:** A → B → A during work, select worker and plan, switch database,
  close/reopen A at the same path using visible controls.
- **Invariants:** selection changes presentation only; late A replies cannot
  overwrite B, replacement runtime, database epoch or file views; closing A
  stops A-owned work, not Relay work merely using that directory.
- **Independent checks/evidence:** distinct worktree outputs/PIDs and owner-local
  revisions; compare both repositories, UI selection/stream checkpoint trace.
- **Cleanup:** stop each owner explicitly, close the isolated backend and verify child exit;
  preserve evidence needed for failed ownership checks before fixture removal.

## Cancellation, reload and restart

- **Prerequisites/start:** fake slow worker at a condition-controlled checkpoint,
  plus completed worker evidence and an accepted plan.
- **Actions:** navigate/reload during progress, cancel via UI, stop/restart the backend after
  completion; try historical review and supported explicit continuation only.
- **Invariants:** cancellation settles owned cleanup; reload does not dispatch
  another worker; backend restart restores evidence, not live authority, pending
  feedback, provider context or uncertain work.
- **Independent checks/evidence:** PID exit, no late filesystem changes, exact
  worktree/run counts and retained transcripts; checkpoint trace and cleanup.
- **Cleanup:** release fixture gates, close the isolated backend and check all owned process trees.

## Scheduler ownership and recovery

- **Prerequisites/start:** isolated injected service/native-service environment,
  fake agents, saved schedule and pinned repository/provider; never a real
  per-user installation without explicit permission.
- **Actions:** use Automations to review disabled schedule, run once with consent,
  pause/cancel; close the browser while backend-owned work is active; reopen and
  inspect history/block, following the [scheduler runbook](../../../../knowledge/operations/runbooks/scheduler.md).
- **Invariants:** interactive Stop all/browser close do not stop service-owned automation;
  no catch-up/retry, automatic apply or restored uncertain work; service remains
  sole metadata writer. No unit-only injected-clock result counts as UI E2E.
- **Independent checks/evidence:** backend versus provider PIDs, persisted occurrence
  claims/history, worktree diff and absence of checkout/index mutation.
- **Cleanup:** explicitly stop the isolated service and its children, uninstall
  only a registration created for this run with authorization. Otherwise BLOCKED.

## State-preserving uninstall and retained-data reinstall

- **Start:** exact platform payload, isolated setup-created/custom database and
  fake provider, complete shared golden journey through confirmed Undo. Retain
  the original backend PID, independent SQLite/preferences and Git/worktree state.
- **Actions:** reject invalid options, missing non-TTY consent and unowned release
  additions; approve application/service removal separately from shell changes.
  Repeat standalone recovery, reinstall the same verified artifact and reopen data.
- **Invariants:** no interruption before consent/ownership proof; original backend
  and providers exit; only receipted installation files disappear. Databases,
  configuration, engine bindings/history, profiles and worktrees remain. Old
  recovery cannot remove the new activation or stop its backend.
- **Evidence/cleanup:** full traces, logical SQLite and file/Git hashes, original
  process absence, completed receipts and independently inspected Docker inventory.
  Writable maintenance shares only this run's PID/loopback namespaces and volumes;
  the browser journey retains read-only application trees. Never count test-only
  supervisor coverage as native login/reboot certification.

## Memory and context handoff

- **Prerequisites/start:** synthetic conversations/projects, fake verified provider,
  isolated memory storage; include existing saved memory and pending generation.
- **Actions:** Settings → Memory Off, complete a synthetic exchange, turn On,
  complete a new exchange, navigate Data Viewer → Memories; inspect evidence,
  correct/pin/forget with supported confirmations, cross a session handoff.
- **Invariants:** Off cancels pending learning/recall but preserves saved records;
  On is prospective, not an import of Off-mode content. Provenance remains
  scoped; handoff neither replays dispatched work nor restores authority.
- **Independent checks/evidence:** fake-provider input/output at its external
  boundary, saved synthetic records/citations/revisions, no duplicate execution;
  record scoped UI state and exact inclusion/exclusion evidence.
- **Cleanup:** stop app/provider processes, remove only isolated synthetic state;
  do not export actual memory, prompts or transcripts.

## Heartbeat self-healing and health verification

- **Prerequisites/start:** isolated foreground gateway with real `MemoryService`,
  `HeartbeatService`, and `HealthCheckService`; include both a healthy baseline
  and a fault-injected unresponsive sidecar / operational warning case.
- **Actions:** run a manual Heartbeat sweep, navigate to Health Check and run
  **Memory service**, then run a second consecutive Heartbeat sweep. In seam
  tests, fault-inject an unresponsive sidecar IPC failure before Sweep 1, verify
  Health Check after Sweep 1, run Sweep 2, and separately inject a responsive
  operational warning before Sweep 3.
- **Invariants:** Heartbeat retires an unresponsive sidecar via `retireSidecar()`
  without latching `MemoryService.closed` or `paused`; Health Check never reports
  `Unavailable` / `"Memory service is stopping"` after self-healing; responsive
  warnings are surfaced without tearing down a healthy sidecar; Sweep 2 stays
  steady-state (`restartedSidecars: 0`) and persistent failures hit the restart
  cap cleanly.
- **Independent checks/evidence:** non-conditional Playwright assertions in
  `test/heartbeat.e2e.ts` plus real-wiring seam verification in
  `test/heartbeat-memory-seam.test.ts`; never stub `memory.close()`.
- **Cleanup:** stop isolated gateway/sidecar processes and remove isolated temp state.
