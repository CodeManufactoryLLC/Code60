# Bridge

- Tactic selection accepts only chat/project identity and a catalog ID or explicit
  null. Continue task accepts only existing chat/task identity. Never accept
  tactic prompts, versions or storage paths from the renderer. Private saved
  task schemas do not grant historical worker or plan authority.

- Review requests accept only project identity, generated review/revision/comment IDs and
  bounded feedback anchors. Revision file reads resolve saved file keys, never arbitrary paths.
  Agents may report addressed feedback but never resolve it or mark files reviewed.

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
