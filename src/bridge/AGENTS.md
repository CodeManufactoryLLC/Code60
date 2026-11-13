# Bridge

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

- Search summary requests carry only request/project identity, a bounded query, an optional project-file inclusion flag and bounded saved-source excerpts with local addresses. Empty source lists are valid; file sources are supplied only by main-process retrieval and returned with the completed overview. Reject unknown fields and malformed IDs; cancellation targets a request ID, never a generic agent command.

- Setup actions accept only a strict mode, session UUID and provider ID. Never accept commands, environment values or directories. Snapshots carry the main-process setup transaction and enabled membership; persisted command identities are hashes, not credentials or live connection assertions.

- Diff reads accept only a UUID request ID and validated run ID; cancellation accepts only the request ID. Reject unknown fields and paths. Keep the existing diff action as a compatibility adapter.

- Git setup requests accept only the current project, main-process session UUID and preview file UUIDs, plus bounded author values. Expose checkGit, beginGitSetup, previewGitSetupFile, initializeGit, commitGitSetup and cancelGitSetup; never accept arbitrary paths or commands. Readiness is visible in snapshots and worker context; agents have no setup mutation capability.
