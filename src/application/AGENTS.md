# Browser backend ownership

ApplicationHost is owned by the unified gateway, never by a browser page. These rules
define backend lifetime independently of browser views.
No Electron imports or UI/HTTP listeners belong here. UI detach cancels only view reads,
setup and pending human interactions; approved execution and memory extraction continue.
Gateway interaction ports replace native dialogs and pickers. Scheduled jobs have a separate
runtime/policy but share the owning gateway process. Backend shutdown stops all owners.
Keep existing storage formats and domain/ownership safeguards. Import other modules through indexes.

## MCP connector foundation

Phase 2's configuration store uses registered targets/revisions, private backups
and versioned journals. Phase 3 composes its human management wrappers; the active
execution loader remains unchanged. Preserve raw preimages, block affected targets after partial writes,
and require explicit known-state Complete/Roll back. Keep pending/unknown/corrupt
evidence; prune only completed verified unpinned backups. Accepted request IDs
never replay effects. Project files may use 0644; user files/evidence stay private.
Close drains queued operations without replaying pending effects. Follow
`docs/runbooks/mcp-configuration.md` before any recovery work.

Phase 1's pure resolver consumes validated documents and trusted backend-owned
identity/revision/approval metadata. Project definitions always shadow matching
user IDs, even when disabled or unapproved; never fall back. Bind project reads
to captured canonical execution targets, never sidebar selection or worktree
copies. Relay/custom assistants use user definitions; target-bound workers use
that target's project definitions. Excluded helper/scheduler roles receive none.
Eligibility is not authentication, connection health or permission to execute.
Do not wire the resolver into live loading until the later storage/runtime phases.
Keep transport dependencies injected; application must not import agents or own
new loopback listeners.

# Application

- Conversational browser automation is a lazy, per-chat `code60_browser` gateway
  tool. Follow the corresponding architecture section. Main fixes the pinned
  executable arguments and isolates mode/state between owners; never accept a
  command, environment, profile or CDP endpoint from the agent. Strip ambient
  Playwright overrides. Keep Existing Browser extension approval intact. Bound
  requests and output, never retry uncertain calls, and stop owned process groups
  on cancel/Stop/Undo/replacement/shutdown. Browser actions do not undo website
  effects. Workers and helpers receive no browser gateway or authority.
  Authorize only dispatched turns; revoke before cancellation and on terminal
  events. Propagate MCP/HTTP cancellation. Filter discovery and calls through the
  product tool allowlist. Launch npm only from a private generated context with
  fixed configuration outside repositories. Budget automatic artifacts separately
  from requested files. Await isolated browser-close acknowledgement before
  stopping its watchdog; retain uncertain cleanup ownership for verification.

- Install the optional stdout/stderr broken-pipe guards before desktop imports
  can log. A closed launching terminal must not raise an uncaught EPIPE dialog
  or stop desktop work. Handle only EPIPE on these optional GUI streams; keep
  unrelated errors, MCP stdout, agent pipes and persisted diagnostics unchanged.

## Conversation checkpoints

- Project chats and Relay persist a host-owned checkpoint before editable human
  work. Enroll additional direct targets before execution, including follow-ups.
  Isolated captures integrate automatically at safe turn boundaries through
  TaskLoop checkout leases and guarded journals, never automatic commits.
- Keep direct workers writable. Snapshot their bounded regular files and warn
  that Undo also rewinds manual edits since that snapshot. Deduplicate immutable
  preimages; exclude Git and Code60 state, reject unsupported coverage before
  launch, and account for failed/interrupted storage writes.
- Undo confirms the latest request and affected targets, warns before replacing
  a draft, stops/drains only owned work and invalidates late authority. Preflight
  all targets before guarded inverse writes, then rewind transcript, tasks,
  plans, memory and continuity. Return the original request unsent. Retire old
  provider context and hand off only surviving history on the next Send.
- Persist interrupted restore/rewind progress. Recovery is explicit; reopening
  never replays execution. Preserve discarded evidence privately and historical
  unapplied reviews read-only, including legacy journals and recovery.

- Settings About metadata reads the pinned embedding configuration from its
  side-effect-free shared module and resolves the ONNX package version beside
  Transformers. Read package JSON only, once; never import native inference into
  the application event loop, load/download assets or report a configured model as loaded.
  Unavailable package metadata is nonfatal and exposes no raw error/path.

## Application agent memory

- MemoryService owns optional desktop-only capture, scoped recall and coalesced
  extraction. SQLite, incremental vector indexing and search run in a bounded
  Node sidecar. Keep `memory.sqlite` private under application state, separate
  from project databases, transcripts and the manual RAG generations.
- One versioned application-wide On/Off preference gates all long-term learning
  and recall. Off cancels learning and discards unprocessed learning-only evidence;
  On never backfills Off-mode text. Restricted v1 settings migrate to Off.
  No daily generation allowance or hidden legacy role/type/conversation gates.
  Automatic context handoff uses bounded, session-local continuity independently
  of Memory; Off-mode continuity never becomes durable learning evidence.
  Retention deletes unpinned records with confirmed, revalidated policy changes,
  preserving evidence needed by retained records and original transcripts.
- Resolve durable project identities from canonical paths and full native
  directory identities. Workers receive only their assignment's project,
  conversation and human-promoted global records. Relay's current host-owned
  task targets, never sidebar selection, can widen its project recall.
  Mixed or unassigned Relay claims remain conversation-local.
- Only completed source ranges can publish a checkpoint, memories and cursor in
  one transaction. Preserve source attribution, contradictory evidence and human
  edits. Bound capture, extraction pages, provider calls, context and retrieval.
  Cancel generators on owner disposal, provider changes, Stop all and shutdown.
- Main validates every memory request. Confirm global promotion and forgetting
  through the confirmation port. Suppress forgotten source ranges and invalidate stale generation and
  recall. Keep content out of diagnostics and memory capabilities out of MCP.
  Ordinary sends may continue without unavailable memory while context fits;
  a required but unavailable handoff must pause before dispatch.

## Relay exceptions and ownership

- The Relay section of ARCHITECTURE.md supersedes single-project/database-wide
  rules below for Relay only. Keep desktop host, singleton Relay service, project
  host, execution host and database services separate within this module.
- Relay storage and its writer lock are application-owned, private and independent
  of databases. Missing/unsafe state is recovery, never permission to reset history.
  Pin journal identity and nanosecond change stamps. Bounded source reads and
  owned appends share storage I/O serialization, never the conversation queue.
  Outside changes invalidate exact Copy; only verified owned appends advance stamps.
- Keep historical gaps distinct from damaged storage. A valid journal with the
  persisted incomplete flag can connect and accept new messages. Preserve its
  warning and clear transient write-failure state only after successful validation.
- Batch Relay journal fragments with a single bounded writer. Flush at 50 ms,
  64 KiB, turn completion and lifecycle shutdown. Count in-flight data toward
  capacity. Journal failure disables only saving for that generation, exposes
  historySaving, and preserves live Send and worker delivery. Never replay an
  uncertain batch. Keep first-error diagnostics typed and source-free and report
  marker failures separately. Core run records and authoritative plan/review
  persistence retain their existing failure handling.
- Connect a fresh idle ACP session after verified setup, with zero startup prompts
  or restored worker/plan authority. Attach the shared bounded history window only
  to the first human Send. Never resume a native Relay session on restart.
- Relay's authenticated gateway alone may name an explicit absolute target cwd and
  direct/worktree mode. Resolve an opaque canonical target, recheck identity, reserve
  global conversation capacity before awaits and preserve accepted dispatch results
  despite later metadata errors. Never accept executable/environment overrides.
  Use bigint filesystem identities internally; rounding a native file ID to a
  number must not allow a replaced target or workspace to pass revalidation.
- Keep project chats bound to their own target with mandatory isolation. Project
  navigation preserves owners and views; actual close and database replacement
  dispose only their own work. Relay and its workers must survive those changes.
- In Relay mode, never restore database-wide legacy chat metadata or expose a global
  compatibility conversation. Explicit RAG is a read-only history-search exception,
  not a Relay history reader or a way to restore conversation authority.
  Only retained project runtimes load interactive project chats.
  Leave existing legacy files untouched, without migration or automatic deletion.
- Stop/shutdown every execution owner, even invisible targets; attempt all cleanup
  and preserve failures and force escalation. Never remove Relay's workspace.
- Capture scoped detail owners synchronously on subscription. Recheck identity
  and generation on every read/publication. Bound subscriptions, clear them on
  renderer reload/shutdown and isolate a failed listener from other owners.
- Build app summaries without copying transcript, file or worktree payloads.
  All conversations are compact, including the selected one. Push worker reply
  counters with metadata; only addressed details expose transcript contents.
- Relay file contexts belong to existing detail subscriptions, never the selected
  project. Resolve only its private workspace or an owned opaque target; recheck
  canonical identity, generation, subscription and view sequence around reads.
  Reuse Poller per root and share flights; release views on unsubscribe/reload,
  and gate previews on visibility without changing another root's context.
- Relay reviews use private application storage and on-demand individual records.
  Persist exact target/task/worker-turn provenance, never execution authority.
  The compatibility project key is Relay's UUID, not a cwd. Seed TaskLoop from
  the already captured first-default-dispatch baseline; do not recapture at Accept.
  Historical evidence reads cannot reconnect workers or replay feedback.
  Pin each review worker's accepted worktree identity, branch and base; recheck
  before capture/application so editable run records cannot redirect evidence.
- RAG discovery is database-wide and read-only, including archived/stopped chats
  and legacy/current project histories. Read saved chats for registered projects
  even when closed, and capture live events from all retained project owners.
  Exclude the application-owned Relay and its independent workers. Require the
  captured database epoch in Relay mode, including after A → B → A replacement.
  Missing or corrupt sources fail the
  entire rebuild. Keep private derived generations isolated by database beneath
  `.code60_workspace/rag`, with atomic publication and explicit size limits.
  Load bundled offline CPU inference only in the dedicated Node sidecar. Cancel
  and await it on database replacement, renderer reload/loss, Stop all and shutdown.
  No automatic indexing, agent/MCP access or provider requests. Clear requires
  browser confirmation and touches only derived data.
  Reuse ChatStore for the same storage root and reserve RAG metadata snapshots
  between its writes; never queue RAG cancellation behind a controller action
  that is waiting for that same operation.

- ChatStore owns bounded private orchestration metadata beneath `.code60_workspace/chats`,
  not SQLite or run records. Persist tactic selection/explicit null without execution.
  Freeze full versioned instructions per human request and associate worker turns,
  plans and feedback with that task. Batch automatic updates only within one task.
  Serialize delivery against pending context writes. Reload saved chats as stopped
  history only; never reconstruct ownership, gateways, queues or plan authority.
  Explicit continuation validates the saved provider command and process safety
  before creating a fresh gateway or attempting ACP recovery.

- Chat review persistence belongs in the focused review store beside the private workspace,
  never SQLite or run records. Capture Git outside the control queue through bounded reads.
  Validate revisions and anchors in the main process. Pending review feedback uses conversation
  delivery, pauses with Chat, and requires explicit retry after restart or failure. Reconnecting
  a saved review does not restore worker-control authority.
  Validate and read saved JSON through the same handle, rejecting links and bounding actual reads.

`src/application` owns application state and domain orchestration under the gateway.
Read [ARCHITECTURE.md](../../ARCHITECTURE.md) before changing it.

- Depend only on `core`, `bridge`, `automation` and the Node-only `platform` leaf.
- Scheduled automations belong to the separate scheduler runtime, not controller
  batches. Stop all affects application work; backend shutdown stops both owners.
- Human interaction ports are supplied by gateway; never create native UI or HTTP
  listeners here. Browser disconnect releases views and pending decisions only.
- Validate application arguments through `bridge`, and act only on owned runs.
- Serialize user actions and completion history refreshes in the controller. Allow overlapping batches, each with its own selected parallel limit, orchestrator, and subscriptions. Route actions and approvals to the owning batch, and retain earlier transcripts when adding sessions.
- Refuse folder and database switches until every batch has ended. Stop all and every shutdown path, including forced shutdown, must stop every batch.
- The host Open Project chooser enables explicit directory creation; opening never initializes Git. After a folder choice, confirm the full project path before opening or adding it to history. Default to Cancel; declining must leave the current project and history unchanged.
- Return only newly created session IDs from start. Require Git readiness on every project launch and continuation, with required isolation during core preparation. Never continue legacy non-isolated workers. Keep Chat and read-only history usable before Git setup.
- Use the supplied confirmation port before destructive actions. Reject unisolated project workers; guided Git setup uses its own explicit initial-commit confirmation.
- On backend shutdown, shut down every run through `core` and wait before releasing ownership. Never remove worktrees automatically.
- Keep the project database (`projects.ts`) to repository paths, open times, saved run configurations (name, batch settings, use count, last use), validated prompt template edits and explicitly saved reusable commands. Never store per-turn user task prompts or transcripts in it, never modify a database that is not a Code60 database, and never recreate a missing one silently. Use the supported Node 24 SQLite runtime.
- Validate command saves/deletes again in main, confirm deletion through the confirmation port, and resolve commands from the connected database at send time. Preserve exact typed transcript text separately from delivered expansion. Commands are shared across projects, not databases. The current orchestrator's authenticated MCP gateway may create commands on user request using the same validation and serialized writes, but cannot update/delete them; workers gain no command capability.
- Route every repeated external read (run history, config, run configurations, worktrees) through the `Poller` in `poller.ts`. Keep reads single-flight, discard results after a workspace or database switch, keep worktree scans outside the exclusive queue, and stop the poller on shutdown. Never poll agent events or watch files. Persist only user overrides under `polling` in desktop.json.
  In Relay mode, the scoped registry captures application/database/target owners
  before the first await. Navigation hides target scheduling but does not dispose
  a live scope or redirect an existing flight. Actual close/replacement stops
  that scope and prevents late publication. Reuse the existing Poller scheduler.
- Own private desktop-only diagnostic JSONL storage separately from transcripts
  and SQLite. Enforce total active-file quota, expiry and cross-process locking.
  Bound capture, streaming reads, cursor state, notices and shutdown flushing.
  Never throw logging failures into lifecycle operations or recursively log them.
- Validate query/detail/clear IPC, accept no paths, batch payload-free notices,
  and confirm clear through the confirmation port. Logs remains usable without a database. Clear and
  retention affect diagnostic segments only. Keep every shutdown path on the
  same idempotent diagnostic flush. Never expose logs to agents or MCP.

- On successful database open or startup reconnection, ensure `.code60_workspace` exists beside the SQLite file, with mode `0700` for a newly created directory. Preserve existing directory contents. Validate the database before creating the directory and surface filesystem conflicts through the database connection error path.

- Own the agent setup transaction in the main process. Require versioned verified setup for every installation; legacy providers do not unlock entry. Atomically persist primary, enabled providers and command identity hashes only on Finish. Keep ACP probes single-flight, cancellable, bounded to 15 seconds and rooted in private temporary directories independent of any database. Send no prompts and create no runs/transcripts/worktrees. Stop the process before directory removal. Ignore stale results on cancellation, config changes, renderer loss/reload and shutdown. Refresh executable discovery on retries; npx alone is not provider detection. Never install provider CLIs or store credentials.

- Own multiple independent orchestration Chat sessions, each rooted in a generated private subfolder of `.code60_workspace` beside the database. Restore saved chats as stopped history once verified setup/provider/database are available; start an initial idle chat only when none are saved. New chat adds a session without stopping existing ones. Reuse all chats and selection across renderer reloads and project switches, and replace live sessions on provider/command/database changes without deleting history. New session replaces only its target chat. Use core for run records, streaming, once-only decisions using the live orchestration approval setting, cancellation and process cleanup. Chat actions are the explicit exception to the open-project run rule: accept only IDs of existing orchestration runs, and never accept a workspace path. Keep each chat's event stream separate from project events; stop every chat on Stop all and every shutdown path.

- Expose worker dispatch and control only through the chat's authenticated MCP gateway. Validate arguments, require the current project/chat scope for mutations, and act only on workers created by that chat in the open project. Never pass the gateway to workers. Keep ownership and request-ID deduplication in memory, enforce `maxParallel` including idle workers, and preserve normal worktree and leftover-process safeguards.
- Deliver bounded worker turn-end/failure updates only between orchestration turns, with automatic prompt origin. Stop and Stop all pause automatic updates; user send or Resume updates unpauses them. Revoke the gateway on chat replacement and clear update timers on shutdown.

- Include current-project worker IDs owned by each chat generation in every chat snapshot. Renderer aggregate activity must not derive ownership from the global list or process existence. Preserve POSIX process ownership and sandbox boundaries.

- Database-wide Search reads the complete connected registry, including closed projects, through four bounded read-only project readers. Never use `listRuns`, reconcile interrupted history, initialize storage, open runtimes or resume agents during retrieval. Legacy database-wide, Relay and Custom Assistant histories remain excluded. Keep project-qualified excerpts in a private temporary SQLite store, with immutable global ranking and 100-result pages. Resolve only captured opaque source IDs, checking database epoch, retained membership and directory identity; closed-project navigation uses the browser Open Project confirmation. Preserve archived history as read-only.
- Search overview helpers consume only main-captured search evidence, with the configured provider in a generated temporary directory, denied permissions and no gateway, run records, worktrees or chat entries. Bound excerpts, response and runtime; serialize replacement and stop processes before deleting their directories. Project/page selection preserves Search. Replacement/clear, database changes, renderer reload, Stop all and shutdown dispose owned reads, helpers and results; provider changes cancel only the overview. New registry entries join the next search; removal invalidates captured searches. Return exact project-attributed numbered evidence, never accept renderer excerpts or filesystem roots.

- Enforce enabled membership and unchanged verified command identities in snapshots, desktop launch/recovery, saved configurations and MCP worker tools. Internal headless executor behavior stays unchanged. Provider add transactions preserve primary and live chats; primary changes require active work to finish or stop. Keep existing settings until commit.

- Diff preparation is serialized with lifecycle mutations; expensive reads run through DiffReads outside the action queue, with at most two in flight. Cancel reads on context replacement, renderer reload and shutdown, and settle a run's reads before discard. Queued preparation cancellation must not deadlock the control queue.
  Retained-project reads capture their runtime even when selected. Tag diff,
  review capture and review-file reads with that owner. Project close/stop/reset
  and discard cancel only its reads; reload and shutdown still cancel all owners.
- ConversationCoordinator owns in-memory conversation authority, dispatch deduplication and between-turn delivery. Keep process creation/shutdown and application orchestration in ApplicationHost; preserve scope checks and pause semantics through coordinator calls.
- Generate chat titles after the first completed exchange through an isolated, bounded, permission-denied ACP helper with no MCP servers or run records. Cancel on manual rename, replacement, Stop all and shutdown. Persist title/archive state with private chat metadata; archive only hides navigation and never deletes records or stops work. Archiving the last chat never creates a replacement session; creation requires an explicit New chat action.

- DesktopKnowledge is a read model, not authority or storage. Derive facts on demand
  from existing owners; validate renderer reports by generation, sequence and owner,
  and clear them on reload. Recheck owners after async reads, bound every response,
  and keep credentials, environments, drafts, logs and memory records out of it.

- GitSetup owns project/session/file identities and single-flight cancellation. Run setup outside the action queue after checking stopped workers/leftovers; preserve partial state and probe HEAD after uncertain commits. Never replay dispatch. Cancel on context replacement, renderer reload and shutdown. Desktop history includes legacy directory records and routes writes to their original store.

## Custom Assistants

The Custom Assistants section of `ARCHITECTURE.md` extends the Relay-only rules above.
Reuse the Relay runtime for custom application-owned conversations. Route all
requests by explicit conversation/generation ownership, including file previews,
worker controls, review reads, memory and cleanup. Keep built-in Relay unchanged.
Custom definitions are private, revision-checked and database-independent.

## Providers

Follow the Providers navigation and management section of `ARCHITECTURE.md`.
Providers replaces the Agents settings destination. Preserve v1 verified membership,
model defaults, histories and external logins. Set-primary/disconnect are strict
human-only bridge actions, guarded in main against active desktop work, setup and
overlapping writes. The primary must be replaced before disconnecting. Publish
main-owned blocking reasons; keep sidebar/gallery/details state and actions aligned.
Reserve provider transitions across Relay/Custom Assistant sends, including
pending request preparation. Reload saved project chats on primary changes;
recovering an invalid primary retains all unaffected verified memberships.

## Plan execution time

Display Execution time above the 12px progress bar, with a once-per-second local
clock only while the visible plan is running. Use shared duration formatting and
role=timer with aria-live=off. Progress is Math.round(completed / total * 100),
followed by the equally weighted task count; neither timing nor counts belong to
Markdown. View Plan is only in the centered blank/empty Files choices; retain
latest-plan selection, keyboard focus, tab identity and captured conversation
ownership, including Relay/custom assistants browsing a project's files.

Optional host-owned executionTiming on Plan contains elapsedMs, runningSince and
historyIncomplete. New drafts start at zero; legacy executed plans without timing
show Not recorded. Resuming a legacy plan records new time with a recorded-only
label. Only running intervals count, once per plan rather than per worker. Queue,
pause/failure/finished periods do not count. State-transition writes finalize
intervals; five-second serialized private-record checkpoints preserve revisions,
accepted revision and Markdown. A checkpoint failure preserves saved state and
reports a fixed desktop warning without changing execution authority.

Recovery removes running anchors, retains the last checkpoint and pauses existing
execution as before; never count offline time or restore authority. An abrupt
crash may lose the last five-second interval (or more if storage writes failed).
Undo restores checkpoint timing, clears anchors and freezes discarded plans.
Owner teardown cancels timers; failed timing writes do not authorize or dispatch
work. This adds no preference, agent-write field, IPC endpoint or dependency.

## Transmission prototype

Transmission workflows are owned by DesktopWorkflows, independently of databases, projects and Relay. Keep the private registry locked, identity checks and durable start keys intact. Quit disconnects readers without stopping the engine; never silently bootstrap on reads. Draft helpers have no gateway, denied permissions and generation-scoped cancellation. See ARCHITECTURE.md for the approved exception.

Route each record to its saved engine version. Records lacking a version belong to staging.18. Reconnect and recovery require explicit actions tied to that record.


## MCP connector guided management (phase 3)

Apps → MCP Servers manages dedicated mcp.json files through five narrow human
operations. Keep active legacy loading and connector execution untouched. User
scope needs no database; project scope requires the captured runtime UUID/epoch
and canonical storage identity. Serialize writes with lifecycle changes and pass
stable request IDs/revisions into the store. Never accept paths or expose this
surface to agents. Explicit management reads may contain definitions/references;
ordinary snapshots, awareness and diagnostics must not. Publish payload-free
notices only. Preserve malformed files, pending evidence and failed drafts. New
entries are disabled; edits preserve enabled state. Templates/paste are reviewed
definitions, never launch requests. Authentication and connections are unchecked;
no secret entry, approval persistence, activation, editor/reset or recovery GUI yet.
