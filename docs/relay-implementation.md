# Relay implementation status

## PR review correctness follow-up

Reconnect validates the retained private workspace before preparation and again
at process launch. Failed target controls do not cancel later queued controls.
Accepted dispatch retries preserve worker-turn review provenance; explicit Git
bases resolve anew for each distinct dispatch, while default task baselines remain
shared. Only own configured provider entries authorize execution.

Review application uses the canonical Git checkout root for repository-relative
paths, retaining the requested target directory and its identity checks.
Project helper cancellation follows the originating request, not view selection.
Opening a restored project loads the conversation made visible, without starting
its provider. Search and Episodic Memory accept project runs only.

Relay navigation and historical display use its stable conversation identity even
when startup fails without a live run. Relay keyboard input does not complete
slash commands. Selecting Relay leaves project drafts intact but clears the
effective worker selection. All open projects push compact worker summaries;
inactive views do not subscribe to transcripts merely to refresh sidebar status.

This branch implements Relay and retained project runtimes as described in
`ARCHITECTURE.md`. Validation status and native-platform gaps are listed below.

## Available

- One application-owned Relay identity and private persistent workspace, independent
  of databases and the selected project.
- A fresh idle ACP connection after verified setup. Startup sends no prompts and
  restores no native provider session, worker authority or unfinished task.
- A shared historical window of at most 64,000 Unicode characters, including its
  serialized labels. The first human Send attaches that window once. Reading older
  history uses bounded, expiring opaque cursors and never sends a prompt.
- Private framed source storage, exclusive writer ownership, metadata validation,
  atomic updates and explicit incomplete/recovery errors. Original core records
  remain on disk. Unsafe or missing metadata is not silently recreated.
- Relay-only authenticated dispatch with required absolute `cwd` and explicit
  `direct` or `worktree` mode. Targets are canonicalized and rechecked before agent
  launch. Direct mode never silently becomes isolated work, or vice versa.
- Conversation-wide capacity reservations across targets, accepted-request
  deduplication, task-qualified authority and originating-task result delivery.
- Target-labelled worker rows, bounded live transcript windows and human worker
  controls without an open project or database. Direct workers show the absence
  of isolated apply, undo and discard.
- Target-qualified plans with revision-specific human acceptance, live task
  authority and first-default-dispatch baselines shared per task and target.
  Saved plans never regain execution authority from a request retry.
- Target-grouped Changes, bounded review pages, pinned revision diffs, reviewed
  files, line-anchored feedback and checkout-local prepare/preview/apply/undo.
  Direct edits are labelled separately and never offer isolated application.
  Review records, immutable source captures and application journals are private,
  application-owned evidence, independent of any project database.
- Review workers pin native checkout identity before agent launch. Capture and
  application recheck canonical target/checkout identities, branch, base, task,
  worker turns, process ownership and current files, including after native
  confirmation. Redirecting a run record to another checkout in the same Git
  repository cannot redirect review. Older unpinned evidence stays readable only.
- Feedback delivery runs between Relay turns with originating-task context,
  bounded queues and delivery receipts. Failures preserve editable evidence;
  restart never reconnects workers or replays pending submissions. Interrupted
  review-index rollover recovers only a validated single pending page, without
  scanning lifetime history or restoring execution authority.
- Stop/shutdown attempt every owner even when helper cleanup fails. Connection
  epochs prevent delayed preparation from starting an ACP session after Stop all.
- Database-wide legacy chat files are not loaded, migrated or exposed in the UI.
  Existing files remain untouched. The old global New chat action is not offered.
- Multiple open project runtimes, with project-bound chat creation, sidebar
  accordions, retained chat drafts, transcript caches, explorers and file tabs.
  Navigation does not stop another project's work or retarget its chat gateway.
- Separate confirmed project close and folder stop. Close stops the project's
  work only; folder stop also pauses Relay's existing task/target assignments.
  Database replacement cleans up all database-owned projects without replacing Relay.
- Runtime UUIDs and database epochs invalidate closed owners. Manual launch,
  file-context, review, task and Git requests capture both before navigation.
  Review/task/Git reads and actions bind their owner even when it is selected,
  so an await cannot redirect publication or cancellation to a different project.
- Selected-project diffs remain bound across navigation. Close, folder stop,
  workspace reset and discard settle only that project's diff/review reads,
  without cancelling another project's read. Reload and shutdown still cancel
  all reads. Slow harness-mode completions resume only their originating
  project's delivery, for both chats and manual workers.
- Database command/configuration/prompt writes, project-history actions and native
  database/folder pickers retain the originating database epoch. Main checks it
  before dialogs, after each dialog and inside the action queue. A delayed picker
  cannot modify a replacement database, including a reopened instance of the same
  SQLite path. Retained renderer callbacks never refresh their epoch to retry.
- Scoped polling captures application, database-instance and project-runtime
  owners before scheduling. Each scope has independent flights, failures and
  timers. Navigation preserves live reads, close discards late results, and
  slow history reads no longer hold the control queue. Explicit refresh requests
  retain the displayed runtime UUID and database epoch.
- Hidden inventory refreshes omit worktree sizes. Visible recursive size scans
  check the captured owner and visibility throughout traversal, stopping on hide,
  navigation or close without publishing partial totals. CLI listing defaults
  remain unchanged. Detail publication checks owner-local versions before
  constructing payloads, and failed listeners cannot strand other owners.
  App summaries carry only bounded subscription UUID/revision hints. A dropped
  final detail frame triggers its own single-flight recovery, including when the
  hint arrives during the initial read; unchanged owners are not recopied.
- The app stream subscribes before its snapshot read, buffers at most 32 frames
  and recovers from overflow or a missing broadcast with a fresh full snapshot.
  Reads remain single-flight, recovery is bounded to three attempts, and
  disposal ignores late responses. A real desktop test deliberately drops a
  project-chat broadcast and checks complete messages and retained draft state.
- Strict project/epoch, conversation/generation and Relay target detail addresses,
  a bounded 128-subscription main registry, fixed IPC and renderer detail readers.
  App and detail streams share bounded subscribe-before-read recovery, while
  retaining independent revision fences. Unsubscribe/reload releases registrations;
  close/generation replacement terminates old addresses instead of retargeting them.
  Project detail reads no longer build unrelated conversations or Relay history.
- Production app broadcasts and the dedicated app-summary initial/recovery read
  omit all transcripts, Relay history, worker prompt bodies, files, worktree listings
  and review data, including the selected view. Explicit full snapshot callers
  retain compatibility. Requested project/conversation/Relay-target detail readers
  hydrate views without advancing their data fences on unrelated app summaries.
  Existing compact plan status/progress summaries remain pushed, so background
  revisions and completion do not require navigation or transcript reads.
  Constant-space pushed reply counters preserve unread counts across navigation
  and renderer reload. Retained detail caches preserve previously visited views
  and are pruned by complete owner identity, not by path.
- Worker summaries push compact reply counters as well. Relay worker selection
  subscribes to its current-generation opaque target, independent of database and
  project navigation. Per-target event windows retain at most 512 events and
  256,000 serialized UTF-16 code units; another target cannot evict that window.
  Truncation is labelled, and original worker records remain on disk.
- Explicit Relay file views browse its private workspace or an owned target,
  without borrowing a project context. They use subscription UUIDs, increasing
  view sequences, bounded relative paths, canonical identity checks and shared
  per-root Poller flights. Hidden views stop scheduling previews. Root changes
  preserve plan tabs and discard file tabs. A real development-React StrictMode
  fixture checks effect replay, release/re-registration, stale sequence frames,
  root changes and ignored responses for released subscriptions.
- Shared historical message presentation, safe assistant Markdown, labelled
  excerpts and exact-source Copy for complete messages and partial excerpts.
  Original-source reads use pinned, expiring opaque cursors outside lifecycle
  queues, with at most two concurrent bounded reads. Copy never sends a prompt
  or grants task authority. Explicit full-message Copy does not enlarge display pages.
  Journal reads pin exact native identity and nanosecond change stamps across
  calls. Verified owned appends preserve existing source bounds; outside edits
  or pathname replacement invalidate Copy rather than returning altered source.
- Relay's worker transcript tool reads the bounded live target event window,
  never a lifetime worker journal. It returns window revision and incompleteness;
  numeric page positions belong to that window. Original run records stay on disk.
- Stop all blocks replacement dispatch during cleanup, preserves forced
  escalation and stops every execution owner. Presentation callback failures
  cannot turn an accepted dispatch into a retry or strand its process.

CLI defaults, run-record format and SQLite schema 5 are unchanged.

## Implemented plan and navigation details

Execution now freezes current saved files per live conversation generation,
human task and canonical target. Explicit Git bases resolve to commits; direct
mode never captures a baseline. Concurrent dispatches share preparation, failures
remain retryable, and folder/Stop all cancels pending captures. Real-Git tests
check isolated contents, ignored credential fixtures, unchanged HEAD and staging.
Target-qualified plans and review bindings share these baselines.

Relay plans require canonical target/mode assignments in
proposals, persist their private records outside the ACP workspace and show
those assignments before human acceptance. Only live in-memory task provenance
may authorize an accepted plan. Revisions, target changes, cancellation and
restart cannot recover or silently expand that authority. Relay plan
documents use the existing human Accept/Resume/Dismiss bridge, not an agent
acceptance tool. Dispatch and progress must match the accepted task's target and
mode; metadata failure after worker acceptance must preserve dispatch identity.
The target-qualified plan slice now passes its focused unit and desktop tests,
including database-free acceptance and paused restart without authority.

As specified in the approved plan, current-file baselines freeze before the first
default-base dispatch, not at Accept. Later default-base workers in the same
task/target reuse that capture; explicit Git bases resolve independently. Direct
rows do not capture files. Folder stop and Stop all cancel pending preparation.
Retrying a saved draft request never grants it new live authority, even if its
target identities still happen to match.

Navigation opens newly added project accordions and
reveals externally selected worker ancestors without discarding manual disclosure
state. Explicit Browse project files, Search file links and review navigation may
open that project's labelled file view alongside Relay without changing Relay's
authority or creating a project chat. File-context activation/deactivation carries
the project UUID and database epoch, including delayed requests after close/reopen.
Activation also rechecks the selected owner after filesystem validation. Project
headings identify the selected project without duplicating the active conversation
highlight. The explicit target label sits above the file content, not beside it.
File snapshots match validated fields rather than JSON property order, and cached
directory listings must match the project instance and database epoch. Default
project-chat names are numbered within their project in both navigation and the
conversation heading. Retained projects do not show the obsolete splash warning
that active work prevents project navigation.
Returning from an empty project restores the destination project's selected
conversation when it has one, without replacing Relay or creating a chat.

Record stores coordinate pending writes by canonical storage directory and run,
including separate filesystem wrappers sharing the application's storage scope.
Independent runs do not share a write queue. In-flight listings of a shared store
with identical injected readers are deduplicated and cloned for each caller;
different reader limits or access policies cannot inherit another reader's result.
Results are not cached after the read settles. This is not cross-process locking
or coordination of every shared Git operation.

Worktree create/remove, internal task snapshots and initial commits now share a
process-local queue by canonical Git common directory, including linked checkouts
and aliases across Git instances. Other repositories remain independent. Waiting
operations recheck both checkout identity and its current Git-directory mapping,
so a replaced checkout or redirected `.git` file cannot retarget a queued write.
Interactive shutdown cancels queued worktree creation; started commands wait for
owned hook/process cleanup. Headless calls retain the previous Git runner.
Nine focused real-Git queue tests and the interactive shutdown regression pass.
Git's own cross-process locks and checkout-local application locks remain distinct.

## Validation still required

- Native Windows/macOS desktop, packaged and installer validation has not run in
  this environment. Linux containers do not validate native ACLs, process jobs,
  native dialogs or packaged startup on those platforms.

Live update capacity failures pause automation and leave original worker evidence
on disk. Inspect that evidence before continuing; a bounded visible window is not
proof of complete work.

## Reproducible validation

```sh
npm run check
npm run test:desktop:container
npm run test:relay:performance
```

The performance command builds the app, creates synthetic journals of 1, 512 and
8,192 messages plus one 500,020-character oversized message, then starts a fresh
Node process and real local ACP fixture for each case. It checks zero startup
prompts, the serialized character budget, bounded reads, prompt-free paging and
once-only first-Send history injection. Original-source Copy streams to an
independent expected SHA-256 hash; each response is at most 16,000 characters.
The largest journal is approximately 522 MB. Temporary synthetic data is removed.
Reported RSS covers the Node Relay service, not Electron, the renderer or the ACP
child process. Startup measurements exclude the preceding build and fixture
generation; the command itself includes both.

### Final measured results

Node 24.22.0 on macOS arm64, one fresh process per synthetic journal:

| Messages | Journal bytes | Startup bytes read | Service startup | History characters | Parent peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 63,746 | 63,746 | 139.4 ms | 16,146 | 178.3 MiB |
| 512 | 32,639,890 | 255,000 | 140.6 ms | 48,070 | 195.6 MiB |
| 8,192 | 522,247,082 | 255,004 | 169.3 ms | 48,073 | 195.1 MiB |
| 1 oversized | 2,004,052 | 272,710 | 146.0 ms | 52,290 | 203.0 MiB |

Across these runs, maximum event-loop delay was 5.2 ms and first Send took
4.3–14.3 ms. The largest fixture's entire fresh-process wall time was 232.7 ms.
Exact oversized-source Copy took 18.2 ms, with at most 132,106 bytes read per call.
These service-only measurements do not measure desktop rendering or clipboard
assembly. They measure the final audited implementation, including pinned journal
change stamps, checkout provenance and bounded worker transcript tools.

### Relay baseline checks (before the sidebar follow-up)

`npm run check` passed: 1,575 tests passed, 16 skipped, 174 test files passed
and one platform-specific file skipped. Typecheck, Biome, Knip and all four
coverage non-regression gates passed. Coverage was 66.96% statements, 60.45%
branches, 60.82% functions and 69.09% lines. Existing Biome output includes
14 warnings and three informational notices.

The first final check passed its tests but failed the preload's 100% coverage
gate because the new fixed Relay review forwarder lacked a test. The forwarding
test was added, and the complete check above passed without changing any gate.

Focused real desktop coverage passed the two-unopened-target Changes flow:
capture, Monaco diff, reviewed state, checkout-local preview/apply/undo,
originating-task feedback and a full application restart with historical evidence
and no restored workers. The complete Linux desktop rerun passed all 60 tests in
4.3 minutes. Its first run passed 59/60 and exposed missing-final-detail recovery
after owner-local publication; bounded revision hints fixed the original scenario
without changing the test or restoring broad transcript broadcasts.

`npm run test:relay:performance` passed, including its full production build.
The benchmark independently checked the oversized source SHA-256, bounded I/O,
zero startup prompts, prompt-free paging and exactly-once first-Send history.
`git diff --check` passed.

Native Windows/macOS desktop, packaged and installer tests remain unrun.
All session test containers and images were removed, verified with both container
and image listings. BuildKit cache and host artifacts are retained. Final desktop
artifacts are under `test-results/container/2026-11-12T22-10-10.282Z-aPAMeL`.

### Sidebar UI follow-up

Relay no longer reads or exposes database-wide legacy chats. The regression
creates existing legacy metadata, verifies `ChatStore.load` is never called,
rejects old conversation actions and verifies the stored file contents are
unchanged. Project persistence, the CLI and SQLite schema 5 are unchanged.

The desktop regression opens three projects and creates six conversations plus
two owned workers. It checks actual label coordinates: every project aligns with
Relay, project chats add 24px and their owned workers add another 24px.
It also checks right-edge chevrons, separate actions, anchored and viewport-clamped
menus, outside/Escape/scroll/resize dismissal, focus restoration, project
collapse/reopen, project close/reopen, retained drafts and unchanged idle workers.
The connected opener remains Open Project throughout.

Screenshot inspection covers Light and Dark at 180px, 220px and 480px sidebar
widths, including 24px navigation text and reduced motion. The expanded checks
exposed narrow-row label drift and large-text activity clipping; both were fixed.
Normal navigation retains its existing row-height formula, while two-line project
headings grow independently to fit their activity label.

`npm run check` passed: 1,576 tests passed, 16 skipped, 174 files passed and one
platform-specific file skipped. Typecheck, Biome, Knip and all four unchanged
coverage gates passed. Coverage was 67.05% statements, 60.48% branches, 60.99%
functions and 69.18% lines. Biome retains 14 warnings and three informational notices.

The first full desktop run passed 54/61. Six failures expected the old opener or
left-side chevron; their replacements also verify selected-project identity in
the project heading. One failure caught the normal-navigation row-height change,
which was fixed without weakening its numeric checks. All seven and the expanded
sidebar scenario then passed together (8/8).

The final complete Linux desktop run passed all 61 tests in 4.5 minutes, including
the production build. Artifacts and screenshots are under
`test-results/container/2026-11-12T23-19-03.885Z-zwlWya`.
All session-owned test containers and images were removed. Container, labeled
image and tagged image listings were empty; BuildKit cache and host artifacts
remain intentionally retained. `git diff --check` passed.

Native Windows/macOS desktop, packaged and installer validation remain unrun.
The earlier Relay performance results above are baseline measurements, not a new
performance run for this UI-only follow-up.
The sidebar fixes remain uncommitted for review; no push, PR update or automatic
host-app launch was performed.
