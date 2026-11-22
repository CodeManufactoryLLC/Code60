# Bridge

- `code60_browser` is an orchestrator gateway tool, not a renderer process API.
  Re-export its browser-safe strict requests only; modes are conversation-local
  and no mode preference or generic execution method crosses desktop IPC.

- Scheduling Service status reuses automation scheduler/status with a browser-safe
  typed installation/native/live result. It grants no process/path capability or
  automatic installation authority; the live scheduler protocol remains unchanged.

- `snapshot.versions` may include read-only configured embedding metadata and
  installed ONNX Runtime identity/version/execution details. These are main-owned
  display values, not accepted model/path/command inputs or inference authority.

- Application memory accepts only opaque record/conversation/project IDs, strict
  bounded settings and revision-checked actions. Expose snapshot, paged browsing,
  cited detail, fixed actions and payload-free change notices. Never accept paths,
  provider commands, arbitrary SQL or worker memory authority. Manual RAG retains
  its separate identity, lifecycle and Clear action.

- Relay is application-owned and usable without a database. Carry explicit
  conversation/target/project identities, lifecycle generations and revisions.
  Desktop chat kinds are Relay and project only; no legacy-chat presentation type.
  Relay history paging accepts only bounded opaque cursors, never paths.
  Explicit-directory dispatch is restricted to the authenticated main-process MCP
  gateway; it adds no generic renderer filesystem or process capability.
  Original-message Copy reads use conversation identity and expiring opaque source
  cursors only, never paths or caller-supplied journal offsets.
- Relay file contexts name an existing conversation/target detail subscription
  and increasing view sequence, with bounded relative folders/preview only.
  Accept no root paths or project identities; main resolves the owned root.
- Relay review provenance retains conversation/generation/task, opaque target,
  canonical cwd/mode and exact native directory identity as decimal strings.
  This saved evidence is not authority. Relay review requests use opaque IDs and
  the current presentation generation, with no cwd or project-path fallback.
  Worker evidence may include a pinned checkout identity, canonical directory,
  branch and base. These are main-produced provenance, never request fields.
- Conversation timeline pages contain bounded capture metadata and optional
  frozen worker outcomes, not full reviews, checkout provenance or file bodies.
  Older revisions without outcomes remain valid evidence; never infer success
  or turn associations for them. Application tabs carry opaque proposal/file
  identities and remain read-only. Host-owned checkpoints integrate edits;
  message Undo and explicit interrupted-operation recovery retain confirmation.
- Send accepts at most eight strict saved-code references with generated review/
  revision IDs and optional file/side/line bounds, never filesystem capabilities.
  Undo accepts only the chat, checkpoint UUID and draft-replacement status.
  Its result returns the original unsent text and saved-code references; renderer fields grant no restore
  authority. Initialize Zod jitless parsing before constructing exported schemas.
- RAG requests accept only opaque database identity, request UUID, captured
  database epoch and bounded query text. Relay-enabled main requires the epoch.
  Expose status/rebuild/retrieve/cancel/clear and pushed progress,
  never paths, model IDs, URLs or commands. Retrieval is text-only.

- Tactic selection accepts only chat/project identity and a catalog ID or explicit
  null. Continue task accepts only existing chat/task identity. Never accept
  tactic prompts, versions or storage paths from the renderer. Private saved
  task schemas do not grant historical worker or plan authority.

- Review requests accept only project identity, generated review/revision/comment IDs and
  bounded feedback anchors. Revision file reads resolve saved file keys, never arbitrary paths.
  Agents may report addressed feedback but never resolve it or mark files reviewed.
  Project review/task/Git requests pair the runtime UUID with its database epoch.
  Optional fields support legacy single-project callers only; Relay-enabled main
  requires both. Return this ephemeral address separately from persisted review data.
- Database selection, folder picking, project history and command/configuration/prompt writes wrap their existing validated
  request with a database epoch. Main requires the epoch in Relay mode and
  rechecks it after native dialogs and inside the action queue; never persist
  it as database content. Empty picker/history requests accept no extra payload.
- Explicit polling carries the originating target runtime UUID and database epoch.
  Application-only configuration polling needs neither. Database-only polling
  needs the epoch, not project membership. Main never refreshes a stale address.
- App update frames include the preceding broadcast revision so missed deltas
  require a full snapshot read. Full snapshot responses omit that delta marker.
- Production updates and appSummary reads carry summaryOnly and omit all
  transcripts/history/file/worktree/review detail, including the selected view.
  Explicit snapshot reads retain compatibility. Run summaries include constant-size
  reply counts, not prompt bodies; details carry full requested view data.
  Open-project workerSummaries carry the same compact run metadata for inactive
  sidebar groups; do not put transcripts, prompts or file payloads in them.
  App summaries may include bounded subscription UUID/revision hints only, never
  detail payloads, so a dropped final detail frame can recover independently.
- Detail requests use strict project/epoch, conversation/generation or opaque
  target/Relay-generation addresses and a subscription UUID. Accept no paths.
  Read requires an existing matching subscription; unsubscribe accepts its UUID
  only. Terminal frames cannot be interpreted as replacement-owner data.

`src/bridge` is the typed IPC contract shared by `desktop` and `renderer`.

- Use the browser-safe `contracts` module for shared validation. Import only types from `core`, and nothing from Node.js, Electron, or React, so the renderer can use this module.
- Validate every renderer request here: reject unknown fields, check sizes, and check run-ID and permission-ID formats.
- openWebLink accepts only a bounded absolute HTTP(S) URL without credentials, controls, whitespace or backslashes. Main validates again before a native confirmation; no other protocols or filesystem access.
- Offer only once-only permission answers (`allow` or `deny`). Never add generic file access or command execution.
- Logs exposes bounded query/detail and explicit-confirmation clear requests, plus
  a payload-free change subscription. No paths, agent access, generic filesystem,
  or diagnostic write endpoint may cross this bridge.
- Chat snapshots expose current-project worker IDs scoped to the owning conversation.
  Keep lifecycle timing metadata optional for older events; add no clipboard or generic
  filesystem capability for renderer presentation.

- Project Search accepts strict captured database epochs and request UUIDs with bounded query/Type/Sort values. Paging uses opaque cursors; cancellation uses the query identity; source opening uses an opaque captured source ID. Main resolves the complete registered project set, never caller roots. Overview requests reference captured search evidence plus their own UUID, never raw renderer excerpts, paths or provider commands. Return project-qualified provenance and exact numbered evidence. Reject stale database/member/source actions; native closed-project confirmation is revalidated before navigation.

- Setup actions accept only a strict mode, session UUID and provider ID. Never accept commands, environment values or directories. Snapshots carry the main-process setup transaction and enabled membership; persisted command identities are hashes, not credentials or live connection assertions.

- Diff reads accept only a UUID request ID and validated run ID; cancellation accepts only the request ID. Reject unknown fields and paths. Keep the existing diff action as a compatibility adapter.

- Git setup requests accept only the current project, main-process session UUID and preview file UUIDs, plus bounded author values. Expose checkGit, beginGitSetup, previewGitSetupFile, initializeGit, commitGitSetup and cancelGitSetup; never accept arbitrary paths or commands. Readiness is visible in snapshots and worker context; agents have no setup mutation capability.

## Custom Assistants

The Custom Assistants section of `ARCHITECTURE.md` extends the Relay-only rules above.
Reuse the Relay runtime for custom application-owned conversations. Route all
requests by explicit conversation/generation ownership, including file previews,
worker controls, review reads, memory and cleanup. Keep built-in Relay unchanged.
Custom definitions are private, revision-checked and database-independent.

- The legacy sidebar-backdrop channel controls window-wide blur using only strict
  bounded viewport width, 0–100 strength and visibility. Positive width gates display;
  main derives the full bounds from its owned window. Never accept coordinates,
  window handles, materials, paths or code; no screen capture access is granted.
- Legacy transparency/hit-test interfaces remain validated, but the removed toggle
  cannot affect live backdrop alpha or enable foreground mouse-event passthrough.

Transparent Linux windows use three renderer caption buttons in the native drag
strip because Electron hides its native caption controls for translucent windows.
A strict minimize/maximize/close enum targets only the owned main window. Close
must call the normal guarded close path, never destroy the window or kill work.
macOS retains native window controls. No arbitrary window IDs cross the bridge.

Native window backdrop failures use a payload-free main-to-renderer notification.
The renderer shows a fixed error; no native error, path or window handle crosses IPC.

Native window backdrop visibility follows owner show/hide/minimize events and immediate
renderer hidden reports, without Electron's macOS native visibility predicate. Hide the
decorative window from Mission Control. A payload-free failure notice reports native
event failures beside Appearance controls, separately from preference save errors; a
successful adjustment clears the native error. Keep caption controls inside the active
splash/setup dialog on Linux so modal top-layer and inert rules cannot block them.
Conversation icon/label insets shrink at narrow sidebar widths to preserve readable names.


## Providers

Follow the Providers navigation and management section of `ARCHITECTURE.md`.
Providers replaces the Agents settings destination. Preserve v1 verified membership,
model defaults, histories and external logins. Set-primary/disconnect are strict
human-only bridge actions, guarded in main against active desktop work, setup and
overlapping writes. The primary must be replaced before disconnecting. Publish
main-owned blocking reasons; keep sidebar/gallery/details state and actions aligned.

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

Workflow requests accept opaque picker/form/workflow/request IDs, revisions and bounded definitions only. No paths, endpoints, executable/environment fields or generic execution authority. Draft output can change only name/tasks; workflow approval is a separate human action.
