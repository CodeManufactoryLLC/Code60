# Code60 browser backend migration

This is the implementation record for the approved browser-only revision of the
unified gateway plan. It replaces the earlier optional-browser/Electron proposal.
The user authorized implementation in a worktree based on the latest origin/main.
No release, service installation on the developer machine, or external publishing
is part of that authorization.

## Scope

- One Node 24 backend owns the application and scheduler, with separately scoped
  authority and existing stores. The React browser UI is the only product UI.
- macOS Apple Silicon and Linux x64 remain supported. Enrollment is an explicit
  per-user launchd/systemd login service. Execution requires an awake, logged-in
  machine; no privileged service, Linux linger or bundled Node.
- Closing/refreshing the browser leaves approved work running. A separate
  confirmed Stop Backend quiesces both components and preserves evidence.
- Distribution is an npm tarball with manual update/repair. Electron, preload,
  automatic updater, DMG/DEB/AppImage installers and signing machinery are removed.
- `code60 open` and `code60 service install|status|start|stop|repair|uninstall`
  provide local lifecycle management only. Noninteractive consent uses `--yes`.
- Feature-slice reorganization and SQLite consolidation remain separate work.

## Implementation

`application` contains the existing domain host extracted from the old desktop
module. `gateway` constructs it and one scheduler runtime, serves bundled Vite
assets and validates the browser operation map. `management` implements the
narrow local CLI. React Fast Refresh handles frontend development; backend
compilation restarts only the isolated development backend. Development does not
install a service or open native windows.

The gateway binds an ephemeral `127.0.0.1` port. Private connection metadata holds
a management secret. The CLI opens a token-free URL. Browsers connect directly by default; local
code60 pairing on/off/status controls an optional 60-second single-use code.
The browser receives only its own session token, and policy changes revoke page
sessions without cancelling approved work. Tokens use explicit
same-origin headers, never cookies or URLs. Session storage permits refresh in
the same tab; backend restart invalidates sessions and direct entry establishes a
new session automatically when pairing is off. One controller has an explicit
lease generation and per-page identity. Takeover/detach invalidates pending page
decisions without cancelling approved work. New permissions remain explicit.

Bounded HTTP requests and a fetch-consumed event stream carry the fixed typed API.
Consequential operations are never automatically retried after transport failure.
Request IDs reject conflicting duplicates. Streams resynchronize after gaps;
slow streams are disconnected rather than retaining unlimited data. Host/Origin
checks, API version checks, CSP and manifest-only asset serving constrain exposure.
No LAN/remote hosting, generic shell RPC, filesystem upload or service worker is
introduced. Host choosers use opaque IDs under locally configured roots and
revalidate containment, inode identity and selections before use.

The integrated scheduler retains its own store, saved allowlists, mandatory
worktrees, recurrence/claim rules and deny-by-default execution. Startup failure
degrades scheduler availability without disabling interactive chats. Confirmed
legacy scheduler handoff records the original pause setting before removing the
old registration. Uncertain ownership fails closed and retains handoff metadata.
Repair checks the live native PID against authenticated management state, drains
work before replacing registration and preserves histories and worktrees.

## Validation and release gates

- Full unit/static/instruction/unused-code checks retain the four-metric coverage
  floors. Moved application paths retain their floors. Only the deleted Electron
  preload's individual 100% floor is retired; no surviving floor is lowered.
- Headless Playwright drives the built browser/backend through first-use provider
  verification, database creation, project choice, accepted plan, automatic edits,
  read-only diff, attachment, refresh and declined/confirmed Undo. Independent
  Git/index/file assertions guard against lost user edits and duplicate workers.
- Additional browser journeys cover takeover, approved work across browser close,
  custom assistants, memory preferences, scheduled work and confirmed backend stop.
- Clean-prefix npm installation verifies the management CLI, bundled assets,
  backend startup and offline embeddings. The separate offline model smoke tests
  relevance, persistence, cancellation and failure with network disabled.
- Native service definitions, consent and ownership/handoff logic are exercised
  with injected supervisors. Actual login/logout, launchd and systemd enrollment,
  service repair/update/uninstall and macOS package execution still require native
  environment validation. Fake supervisor tests do not establish those results.
- Linux Node 24 CI runs check/browser/package gates. Manual macOS Apple Silicon
  validation uses the same checks. The protected aggregate check stays `CI passed`.
  Release preparation must bump the major version for removed supported native
  interfaces and pass native lifecycle validation before tagging a release.

See [architecture](../ARCHITECTURE.md), [development](../CONTRIBUTING.md),
[release steps](../RELEASING.md) and [QA](../.factory/skills/qa/SKILL.md).
