# Bridge

`src/bridge` is the typed IPC contract shared by `desktop` and `renderer`.

- Use the browser-safe `contracts` module for shared validation. Import only types from `core`, and nothing from Node.js, Electron, or React, so the renderer can use this module.
- Validate every renderer request here: reject unknown fields, check sizes, and check run-ID and permission-ID formats.
- Offer only once-only permission answers (`allow` or `deny`). Never add generic file access or command execution.
- Chat snapshots expose current-project worker IDs scoped to the owning conversation.
  Keep lifecycle timing metadata optional for older events; add no clipboard or generic
  filesystem capability for renderer presentation.

- Search summary requests carry only request/project identity, a bounded query, an optional project-file inclusion flag and bounded saved-source excerpts with local addresses. Empty source lists are valid; file sources are supplied only by main-process retrieval and returned with the completed overview. Reject unknown fields and malformed IDs; cancellation targets a request ID, never a generic agent command.
