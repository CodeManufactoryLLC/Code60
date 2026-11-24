# MCP connectors implementation plan

Implement an MCP Servers page for adding, editing, moving, enabling, testing,
authenticating and recovering MCP servers. Provide guided forms and direct JSON
editing backed by the same validation and storage services.

Implementation is authorized for phases 1–3. Phases 4–7 remain planned. This record
does not authorize installation of real user services.

After each completed phase, run the required checks, create a DCO-signed commit,
push the task branch and update the same draft PR. Phases 1–2 are published together
as the starting change set; each remaining phase gets its own commit. Publishing
this draft does not authorize merging it.

## Scope and agreed decisions

- Use dedicated user and project `mcp.json` files, separate from general settings.
  The proposed locations are `$XDG_CONFIG_HOME/code60/mcp.json` (default
  `~/.config/code60/mcp.json`) and `<project>/.code60/mcp.json`.
- Moving means transferring a server between user and project configurations,
  rather than reordering a list.
- Factory defaults contain no user-added servers and enable none. Reset is
  distinct from discarding a draft or restoring a backup.
- Use a single new, versioned configuration schema. No users require backward
  compatibility, so no migration of the existing `config.json` MCP entries or
  legacy inline credentials is required.
- Support stdio and Streamable HTTP initially. Each definition has explicit
  enabled state and structured authentication settings with credential references.
- Initial MCP support is tools only. Resources, prompts, sampling and elicitation
  are explicitly unsupported.
- Project definitions always shadow matching user IDs, including when disabled or
  unapproved. Connections are isolated per ACP session and connector, not pooled.
- Include generic authentication: secure credential storage and OAuth with
  user-supplied registration details where required. Runtime discovery and
  registration support belong to the generic protocol implementation.
- Include optional pre-bundled MCP definitions, such as Playwright, as templates.
  Adding one creates a normal reviewable definition managed through the same
  forms, editor, activation controls and troubleshooting as any other server.
  Templates do not activate or launch automatically.
- Keep the existing built-in Code60 orchestration gateway and managed browser
  capability distinct from optional pre-bundled definitions. Resetting user MCP
  configuration does not remove those built-in capabilities.

### Exclusions

- First-class dedicated integrations, including a bespoke GitHub integration,
  service-specific account flows, Code60-owned OAuth registrations, bundled client
  IDs or client secrets, and a hosted authentication or token-exchange service.
  These are separate future work, not another name for pre-bundled templates.
- Compatibility readers, migrations, dual configuration formats and legacy
  inline-credential migration.
- Legacy SSE transport unless a specific requirement is added later.
- Automatic installation of MCP packages, browsers or prerequisites. If a
  user-approved launch command can download packages, explain that before launch.
- Automatic activation of repository-provided definitions or replay of uncertain
  tool calls after errors or restart.
- Generic filesystem/shell APIs, agent-controlled connector administration, remote
  hosting, and changes to scheduler execution policy or helper tool access.

## Phase 1: Define configuration and runtime architecture

Define the new schema, supported transports, server identities, enabled state,
credential bindings, user/project applicability and duplicate-name precedence.
The UI must explain the effective source and any shadowed definition rather than
silently selecting a conflicting server.

Establish backend ownership of connections, authentication and lifecycle, with
scoped adapters for ACP providers. Check provider integration against protocol
fixtures before committing to the connection design. Define session ownership,
tool and permission forwarding, cancellation, teardown and which execution paths
may receive configured connectors. Preserve scheduler and helper exclusions.

Keep responsibilities within the existing modules: shared browser-safe schemas
and DTOs in contracts, orchestration in application, narrow validation in bridge
and gateway, protocol integration in agents, filesystem and secure-store access
in platform, and presentation in renderer. Cross-module imports use public entry
points. Expose no raw credentials or generic host capabilities to agents.

Project definitions require human review before activation. Bind that approval to
the reviewed configuration revision and canonical project identity. External
changes to launch settings, endpoints or authentication invalidate the applicable
approval. Opening or cloning a repository never launches its servers.

Update [architecture](../ARCHITECTURE.md) before implementing behavior currently
excluded there, particularly credential storage, project settings and config
writes. Update module instructions and dependency boundary tests together where
the approved design changes their rules.

**Completion:** architecture, schema, precedence, trust and lifecycle decisions are
documented, with protocol and schema fixtures covering the chosen boundaries.

### Phase 1 implementation record

Status: complete. Implementation, required checks and owned-resource cleanup verified.

- Added the version-one browser-safe schema, fixed validation errors, typed
  literal/credential bindings, OAuth registration metadata and separate
  configuration/observation status types in `src/contracts/mcp-connectors.ts`.
- Added pure, deterministic application-owned resolution. Canonical project and
  revision metadata are backend inputs; no filesystem, credential resolution,
  network calls or live configuration loading occur. Returned definitions are
  detached from inputs. User/project source and shadowing are explicit.
- Project chats require a captured project. Project-targeted workers use that
  project; workers without a project use user definitions. Relay/custom assistants
  use user definitions regardless of sidebar/project data. Scheduler, provider
  verification, memory/search and other isolated helpers receive none.
- Approval binds the canonical source-project identity and document revision in
  private backend state. Changed identity/revision invalidates it. Disabled and
  unapproved project overrides never fall back to user entries.
- Documented one upstream connection per ACP session/connector, with provider-facing
  stdio adapters and scoped ephemeral capabilities. Gateway owns composition and
  private listeners; agents owns protocol; application receives injected ports.
  Only gateway-to-agents module access was added to the boundary rules.
- Added real ACP/stdio subprocess feasibility fixtures for new/load/resume,
  discovery, allow/deny, inactive/revoked/cross-session rejection, cancellation and
  backend-only upstream credentials. These are supporting integration tests, not
  a production connector adapter or certification of real provider support.
- Added the [ownership architectural view](../docs/architectural-views/mcp-connector-ownership.md)
  and the [target runtime contract](../ARCHITECTURE.md#mcp-connector-foundation-and-target-runtime).
  Updated module instructions and distinguished active MCP behavior from the
  staged target design in `MCP.md`.
- No new page, management request, snapshot, tool or availability was introduced.
  No capability catalog entry or regeneration is needed in this phase. Later
  user-visible slices must update the catalog and availability tests.

Validation environment: assigned `mcp-connectors` worktree at PR #313's merge
commit `e21fc8687e497f0b016b0ee8edc8b3cf2a3d9c2d`, with host Node 24 tooling and a
dedicated Linux amd64 devcontainer. Worktree label: `9de795df015cc483`; reserved
gateway/Vite ports: `40190`/`40191`. Evidence is retained under ignored
`test-results/qa/mcp-connectors-phase-1/`.

Validation results:

- Focused schema/resolver/boundary/protocol run passed. The final full suite
  includes 74 tests across those four files (one redundant type-only test was
  removed after the first 75-test focused run).
- `npm run check` passed inside the dedicated container: 295 test files and
  2,853 tests, with all four coverage non-regression gates satisfied. Measured
  statements/branches/functions/lines: 71.39% / 64.60% / 65.36% / 73.78%.
- `npm run test:browser -- --grep "browser: first use"` passed after the full
  check, through visible setup, acceptance, integration, diff, attachment, reload
  and declined/confirmed Undo. This is full UI regression evidence, separate from
  the connector protocol feasibility proof.
- The initial full check stopped at three unused bridge re-exports. Those exports
  were removed, then the complete check passed without changing exclusions,
  coverage floors, test timeouts or retry policy. Original failure evidence is
  retained beside the successful run.
- Final instruction/reference validation passed after the implementation record
  was added. Worktree-owned containers and exported images were removed with
  the helper; independent container and image inventories were empty. Dependency,
  build, npm, browser and model caches, port reservations and QA evidence were
  intentionally retained. No user service was installed or live provider contacted.
- Production MCP loading, UI, filesystem transactions, broker/adapters, OAuth and
  secure-store/native-platform validation remain phases 2–7. No production
  connector or real-provider compatibility is claimed by this phase.

## Phase 2: Build validated configuration storage

Use one schema for forms, the JSON editor, backend writes and runtime loading.
Validate schema version, strict JSON syntax, duplicate keys, server identities,
reserved names, transport-specific fields, URLs, argument arrays, enabled state
and credential references. Reject unknown fields and unsupported versions.

Return bounded structured issues with safe field paths and line/column locations.
Do not echo secret values or raw parser errors. Both UI and backend reject invalid
saves; a syntactically valid definition can still fail a connection test.

Implement bounded reads, private backups, serialized mutations, atomic file
replacement and revision checks against external edits. Reject unsafe file
identities and symlinks. A failed or conflicting write preserves the previous
configuration and the user's draft. Missing files represent empty defaults;
malformed files remain available for explicit editing and recovery.

Moves span two files and need a recoverable transaction record with verified
preimages. Preflight collisions and ownership, then coordinate the writes without
losing either definition. Interrupted moves require explicit completion or
rollback; never delete locks or replay uncertain work to repair them.

**Completion:** tests prove invalid saves leave files unchanged, concurrent edits
are detected, backups restore correctly, and interrupted moves retain evidence.

### Phase 2 implementation record

Status: complete. Implementation, required checks and owned-resource cleanup verified.

- Added bounded browser-safe strict text validation sharing the version-one schema:
  decoded duplicate keys, source locations, safe issues and UTF-8 round-trip checks.
  Limits are 1 MiB, 32 nesting levels, 32,768 nodes and 32 issues. Valid text is
  preserved exactly; BOMs are not silently stripped. Source locations use a
  prefix-sharing tree and scalar scanning uses sticky matching to avoid repeated
  copies of long unknown keys or unconsumed input.
- Added platform same-handle byte reads, root/native identity pins, guarded staging,
  atomic rename, verified temporary cleanup and directory sync. Project files accept
  owner-owned 0644; user files and recovery state remain private. Reads do not create
  missing configuration directories.
- Added the backend-only `McpConfigurationStore` for registered target IDs, revisions,
  save/move/backup/restore/recovery and close. It has no ApplicationClient route or
  active loader integration. No new module dependency edge is needed.
- Private journals preserve exact before/after bytes and staged identities. Moves
  publish destination before source removal; startup inspects without replay.
  Explicit recovery refuses newer edits, root replacement and corrupt evidence.
  Completing a post-rename uncertainty syncs without repeating the rename.
- Automatic retention keeps up to 20 backups per target within the shared 100 MiB
  backup/receipt/evidence ceiling. Only completed verified unpinned backups may be
  pruned. Pinned or unknown evidence is preserved; quota pressure blocks mutation.
- Added request fingerprints independent of property order and durable accepted
  request receipts. Receipts count toward the ceiling and are not backup-pruned.
  A private test-only ceiling can be lower, never higher, than 100 MiB.
- Added supporting filesystem tests for missing/malformed/unsafe files, exact writes,
  revisions and native precision, retention, failure boundaries, interrupted moves,
  cancellation, replay and explicit recovery. Selected the existing full browser
  first-use/acceptance/reload/Undo journey for independent regression coverage.
- Added [the MCP storage recovery runbook](../docs/runbooks/mcp-configuration.md).
  Dedicated integrations, migrations, GUI/browser operations, live loading,
  connector processes, authentication and approval persistence remain outside
  this phase. No capability catalog regeneration is needed for an unwired library.

Validation and cleanup evidence will be retained in
`test-results/qa/mcp-connectors-phase-2/`, using this worktree's dedicated Linux
amd64 container, label `9de795df015cc483`, and reserved ports `40190`/`40191`.

Verified checks:

- Final focused parser/platform/store/boundary run: 66 tests across four files passed.
- Final `npm run check` inside the dedicated container: 298 files and 2,913 tests
  passed. All four coverage gates passed: statements 71.87%, branches 65.08%,
  functions 65.84%, lines 74.27%. No coverage floors, unused-code exclusions,
  existing timeouts or retry policies were relaxed.
- Initial development checks caught an inspector return-type annotation, two
  unnecessary helper exports and one wrong expected error category. Corrected
  those findings and retained their logs. A full 2,907-test run passed before
  the final long-key and invalid-budget boundary tests were added; the final
  full check was rerun after those changes.
- Browser first-use/acceptance/integration/diff/attachment/reload/declined-and-confirmed
  Undo regression passed (one journey, 17.6 seconds; suite 21.5 seconds). This is
  independent full UI regression evidence, not a claim of a new MCP management UI.
- Final instruction/reference validation passed after the documentation update.
  The worktree helper removed owned containers and exported images; independent
  stopped/running container and image inventories were empty. Dependency/build/
  npm/browser/model caches, port reservations and QA evidence were retained.
  No native macOS service, credential store, real provider or live configuration
  was used, and no foreign resource was modified.

## Phase 3: Build guided server management

Add an MCP Servers page with user/project selection and effective-source labels.
Show name, transport, enabled state, authentication state and connection status.
Provide Add, Edit, Remove and Move actions with keyboard-accessible forms.

Use transport-specific fields and examples. Accept pasted definitions as drafts
for review. Pre-bundled definitions use the same flow and are opt-in. Merely
viewing a template, definition or form performs no network access or launch.

Moving previews the source, destination, affected projects, duplicate conflicts
and credential availability. Block unresolved collisions rather than overwriting
another entry. Project files contain definitions and credential references;
credentials remain in each user's local secure store and are not copied into Git.

**Completion:** browser journeys add, edit, remove and move definitions, including
cancelled actions, collisions, stale project ownership and unavailable credentials.

### Phase 3 implementation record

Status: complete. Implementation, required validation and owned-resource cleanup verified.

- Apps → MCP Servers supports user/open-project configuration, guided stdio/HTTP
  fields, optional pinned Playwright/Context7 templates and one pasted definition
  for review. Add is disabled by default; Edit preserves ID and enabled state.
- Five authenticated human operations wrap one lazy application-owned store.
  Stable canonical storage identity is separate from runtime/database fences.
  Moves retain references and evidence, with destination-first publication.
- Effective source/shadowing, malformed inheritance, unverified credentials,
  conflicts and recovery blocks are explicit. Definitions stay outside ordinary
  snapshots, diagnostics and agent awareness. No runtime activation/authentication.
- Updated architecture, module rules, MCP/recovery docs and capability catalog.
  Evidence is recorded in `test-results/qa/mcp-connectors-phase-3/`.
- Phase 3 is delivered as its own DCO-signed commit on `mcp-connectors`, updating
  existing draft PR #317. Phases 4–7 remain planned; active runtime loading,
  activation/testing, authentication, approval persistence, direct editing/reset
  and in-app recovery remain deferred.

Verified validation and cleanup:

- Focused contracts/service/form/gateway/knowledge/navigation/boundary run: 114
  tests across 11 files passed. Capability regeneration passed (34 tests).
- Final full check in the assigned Linux amd64 container:
  `npm run devcontainer -- exec env VITEST_MAX_WORKERS=1 npm run check` passed
  301 files / 2,929 tests in 514.03 seconds. All four coverage gates passed:
  statements 71.38%, branches 64.46%, functions 65.07%, lines 73.74%.
- The initial full run found six navigation expectations that omitted the new
  page; those exact expectations were updated. Two later two-worker runs hit
  the unchanged real-Git Relay review case's five-second timeout. The complete
  file passed under coverage alone (30 tests); the final single-worker full run
  passed it at 4.129 seconds. Parallelism was lowered within the existing budget;
  no timeouts, assertions, retries, coverage floors or exclusions were relaxed.
- Final MCP browser run: three real UI journeys passed in 28.0 seconds. Covers
  manual/template/pasted Add, stdio/HTTP Edit, keyboard Save/Escape, removal/move
  cancellation and confirmation, collisions, inheritance, unverified references,
  provider-process inventory, external revisions/root replacement, removed or
  malformed content on Reload, and pending recovery. Independent bytes/modes,
  backups/journals and unchanged legacy configuration were asserted.
- Separate first-use golden regression passed (15.5-second test / 17.3-second
  suite): provider setup, acceptance before worker creation, automatic edits,
  diff/attachment, reload and declined/confirmed Undo with filesystem/Git oracles.
- Initial browser failures exposed a missing mouse-accessible Add action and
  fixture navigation to a stopped backend origin. Corrected both, preserving
  logs/traces. The final feature stylesheet follows module ownership/import
  ordering, and final forms enforce the UTF-8 byte budget before submission.
- The worktree helper removed owned containers and exported images; independent
  stopped/running container, labelled-image and owned-image-name inventories
  are empty. Only tini/sleep remained before teardown. Retained documented
  dependency/build/npm/browser/model caches, BuildKit cache, ports and QA evidence.
  No live provider, real service, hook policy or foreign resource was changed.
- Supporting protocol/storage tests and full browser journeys are reported
  separately in `test-results/qa/mcp-connectors-phase-3/`. Native macOS storage,
  secure-store/OAuth, login-service and packaged/model checks were not performed:
  this phase adds no such production behavior, packaging or model changes.

## Phase 4: Add direct editing and factory reset

Reuse bundled Monaco for the selected configuration with JSON highlighting,
completion, formatting, validation markers and unsaved-change handling. The
editor opens only approved MCP configuration targets through narrow backend APIs.
Guided forms and raw editing share one draft and revision so they cannot overwrite
each other's changes silently.

Disable Save while invalid and enforce the same rule on direct backend requests.
Preserve drafts through ordinary page navigation and offer reload/compare when
the file changes externally. Keep credentials out of editor content; JSON stores
references rather than secret values.

Provide three distinct actions:

- **Discard changes:** restore the currently saved configuration to the draft.
- **Restore backup:** preview and restore a selected valid earlier configuration.
- **Reset to defaults:** confirm and clear user-added definitions in the selected
  scope, preserving unrelated application settings and built-in capabilities.

Reset previews effective inheritance: clearing a project override may reveal a
user definition. Offer an explicit reset of all applicable scopes when the intent
is to leave no configured user servers enabled for that project. Credential
deletion is a separate choice. Explain any connections that remain active until
explicitly disconnected.

**Completion:** tests cover invalid and conflicting saves, draft synchronization,
scope-specific reset, inherited definitions and preservation of unrelated data.

### Phase 4 implementation record

**Phase 4 is complete (2026-11-23).** Required validation and owned-resource
cleanup passed; activation and authentication remain later work.

- Added Servers/JSON views with local Monaco completion, a bundled JSON worker,
  fixed scanner markers and explicit formatting. No external schema fetch or CSP
  expansion. One captured renderer-memory session retains exact text, revision,
  cursor/scroll and incomplete forms across navigation. Guided saves remain immediate;
  dirty JSON requires Save/Discard/Cancel before guided edits or scope changes.
- Added seven fixed human operations for bounded base64 editor reads/saves, backup
  listing/preview/restore and reset preview/commit. Strict target/runtime/database
  fences, stable UUID replay and the application lifecycle queue remain in force.
  Safe malformed originals may be repaired or reset with exact private preimages;
  unsafe/oversized originals remain blocked. Invalid UTF-8 originals reject exact-text
  saves in the backend as well as the editor; confirmed reset/valid restoration
  remains available. Definitions/references stay out of
  ordinary snapshots, awareness, diagnostics and agent APIs.
- Backup confirmation binds the target revision and reviewed native backup identity
  plus content. Only valid unpinned backups are offered; absence is explicit removal.
  Discard reads without writing. Conflicts/uncertainty preserve drafts and offer a
  read-only Saved versus Draft comparison. Replaced owners require explicit reload.
- Reset journals include all selected states and unchanged inheritance guards.
  Combined reset publishes User before this project. Native rename/unlink checks
  cancellation immediately before publication; started steps finish verification
  and sync before retaining a recoverable outcome. Missing/empty targets remain
  unchanged without config creation/backups. Failures retain journals for backend
  Complete/Roll back; third states stop recovery and startup never replays.
- Capability descriptors/availability tests and the generated catalog now describe
  editing/restoration/reset. Architecture, module instructions, MCP documentation
  and the recovery runbook distinguish these operations from the deferred runtime.
- Activation/connections, approval persistence, secure-store/OAuth, transaction
  recovery GUI and later release validation remain phases 5–7. Dedicated integrations,
  Code60-owned registrations/client IDs/secrets, hosted auth, migrations and legacy
  SSE remain excluded. Pre-bundled definitions stay optional templates; tools only.

### Phase 4 validation and delivery

- Final containerized `npm run check` passed: **303 files / 2,956 tests**, 557.80
  seconds, with instruction validation, typecheck, Biome, Knip and all four coverage
  gates. One worker respected the known emulated real-Git timing constraint;
  no floors, exclusions, existing assertions or timeouts were relaxed.
- Focused contracts/service/form/draft/gateway/knowledge/boundary/ACP checks passed
  (121 tests across nine files); additional publication integration passed 66
  tests across three files, followed by seven platform cancellation tests. These
  overlapping supporting runs are recorded separately from browser evidence.
- Final real-browser run passed **nine MCP journeys** (six new and three existing,
  1.4 minutes): completion/local worker/CSP, exact saves and explicit formatting,
  invalid Save, guided/scope guards, navigation/cursor retention, cancelled close,
  conflicts/comparison/discard, reviewed/absent backups, malformed repair/reset,
  inheritance, combined reset, pending restart inspection and owner invalidation.
  Independent bytes, modes, inodes, backups/journals and unrelated settings/files
  were checked. Final editor/reset screenshots were visually inspected.
- Separate first-use golden regression passed (15.5-second test / 17.4-second
  suite): provider setup, acceptance before worker creation, automatic edits,
  diff/attachment, reload and declined/confirmed Undo with filesystem/Git oracles.
- Packaging and clean-prefix installed smoke passed: CLI, loopback backend, local
  JSON-worker asset serving and an offline 768-dimensional model query. The pinned
  assets were prepared/verified explicitly; no service was installed.
- Earlier failures and traces remain in `test-results/qa/mcp-connectors-phase-4/`.
  Covered repetition exposed a test client dropping its unread event stream;
  consuming notices as a real browser does fixed eight independent reproductions.
  Production authorization, retry policy and detach deadlines were unchanged.
- The worktree helper removed the owned code60/cache-init containers and exported
  images. Independent stopped/running container, labelled/named-image and network
  inventories are empty; only idle init/sleep remained before teardown. Retained
  documented dependency/build/npm/browser/model volumes, BuildKit cache, ports,
  package artifact and QA evidence. No foreign resources or real user services,
  providers, credentials or hook policies were changed.
- Native macOS storage/login-service, secure-store/OAuth and production connector
  execution are not certified by these Linux amd64 container checks. Transaction
  recovery GUI, activation/connections and authentication remain phases 5–7.

## Phase 5: Implement connection lifecycle and activation

Add Enable, Disable, Test connection, Reconnect and Disconnect controls. Separate
configured state from observed connection health. Health states include Not
tested, Connecting, Connected, Authentication required, Failed and Unsupported by
provider, with the observed session/provider and time where applicable.

Enabling permits future connections after required trust and authentication
checks; it is distinct from launching a connection test. Changes apply to new
sessions. Show affected existing sessions and require an explicit reconnect or
disconnect to interrupt their connections. Disabling prevents future connections
and clearly reports any existing access that remains active.

Connection tests may initialize and discover capabilities but do not invoke
business tools. Explain that testing stdio runs the configured executable. Bound
all operations with deadlines, concurrency limits, cancellation and output
budgets. Clean up owned processes and subscriptions; retain uncertain cleanup
ownership for verification. Never retry an uncertain tool call automatically.

Browser reload or close cancels page-owned tests and pending interactions without
terminating approved session work. Backend shutdown drains owned connections;
restart never restores execution authority or replays calls.

**Completion:** fixture-backed journeys verify activation, existing-session
behavior, provider errors, cancellation, browser detach and process cleanup.

## Phase 6: Implement secure authentication

Support API keys, header credentials and stdio environment secrets using macOS
Keychain or Linux Secret Service. Store only references and non-secret metadata
in configuration files. If secure storage is unavailable or locked, explain the
condition. Temporary backend memory requires explicit selection and lasts until
backend restart or sign-out; never silently fall back to plaintext or memory.

Implement generic backend-owned OAuth discovery, supported client registration,
authorization code flow with PKCE, state and issuer validation, protected loopback
callbacks, token refresh, scope review, reauthorization and sign-out. Accept
user-supplied registration details when a server requires pre-registration.
Provider requirements must be validated; PKCE does not imply every provider accepts
a client-ID-only exchange. No Code60-owned registrations are supplied in this work.

Bind credentials to server identity, endpoint, account and approved scope. Moving
a definition does not grant another user access to its credentials. Endpoint or
identity changes require authentication review. Constrain discovery requests and
redirects so untrusted metadata cannot steal credentials or access unintended
network targets.

Keep stored secrets out of ordinary snapshots, browser storage, diagnostics,
transcripts and exported reports. Secret entry is a narrow transient request;
secret resolution and token exchange remain backend-owned. Resolve stdio secrets
only into the intended process environment, never command arguments. No background
or non-interactive operation may wait indefinitely for sign-in.

**Completion:** fake OAuth and secure-store tests verify cancellation, callback
replay rejection, token refresh races, expiry, revoked access, locked stores and
secret isolation. Validate platform secure-store behavior in isolated environments.

## Phase 7: Complete troubleshooting, recovery and release validation

Each error explains what failed, what remains usable and the next available
action. Use fixed error codes and safe connection-stage metadata rather than raw
server output. Include an optional safe troubleshooting report.

| Failure | In-app guidance and recovery |
| --- | --- |
| Invalid configuration | Jump to the issue, edit it or restore a valid backup |
| Missing executable or invalid arguments | Review launch settings and prerequisites, then test again |
| Unsupported provider integration | Explain the limitation and supported alternatives |
| Expired credentials or insufficient scope | Sign in again or review requested access |
| Network, TLS, timeout or protocol failure | Identify the failed stage and offer an explicit bounded retry |
| External edit or failed write | Reload, compare and preserve the unsaved draft |
| Interrupted move or uncertain cleanup | Inspect retained evidence, then explicitly complete, roll back or verify cleanup |

Follow the [workflow QA skill](../.factory/skills/qa/SKILL.md). Add meaningful tests
within each phase, then validate complete journeys across the finished system with
headless Playwright, the built backend, isolated HOME/config/state and fake
MCP/OAuth servers. Assert intermediate UI states and independent file and process
outcomes. Include project trust changes, malformed external edits, disk/permission
failures, interrupted moves, reset, authentication cancellation and browser reload.
Unit/static checks do not establish browser or native-platform success.

Update [MCP configuration](../MCP.md), relevant user documentation, recovery
runbooks, security guidance and module instructions. Update
`src/contracts/knowledge.ts`, availability rules and tests as capabilities land,
then run `npm run generate:capabilities`. Report configuration validity,
authentication and observed connection health as distinct facts in self-knowledge.

Run the narrowest relevant checks first, then `npm run check` before every commit.
Run `npm run test:browser` and applicable packaging checks for the final change.
Do not lower coverage gates or broaden unused-code exclusions. Report blocked
native-platform validation and clean up session-owned test resources.

**Completion:** all seven phases satisfy their acceptance checks, complete browser
journeys pass, documentation reflects actual behavior, and any remaining platform
validation is explicitly recorded before release.

## Phase 5 implementation record (complete)

The dedicated version-one files now supply desktop connections through the same
application-owned configuration store. Legacy config.json.mcpServers loading is
removed without migration/fallback. User/open-project guided and JSON operations,
backups, guarded writes and explicit backend recovery remain intact.

Delivered artifacts include the optional core session-resource hook; application
connection coordination and private exact-revision/canonical-identity approval;
agents-owned pinned MCP SDK 1.32.2 stdio/Streamable HTTP transport; a gateway-owned
private capability broker; and the fixed production stdio adapter. New/load/resume,
handoff and continuity replacement obtain fresh per-session capabilities. Scheduler,
verification and isolated helpers have no hook. Canonical resolution is separate
from actual execution cwd. Both upstream transports use the same provider boundary.

Calls require owning active-turn authority and existing ACP permissions. Cancel,
Disconnect, replacement and shutdown revoke before cleanup; no business-call replay
or HTTP resumption/auth retry exists. Limits are four concurrent initializations,
30-second MCP setup/test budgets, 256 live upstreams, 512 tools and 8 MiB messages.
Successful connections outlive setup budgets. Stateful HTTP cleanup sends bounded
DELETE; uncertain cleanup retains ownership/capacity and reports unresolved state.

Human controls cover Enable/Disable, project review/Approve/Revoke, Test/Cancel and
reviewed Disconnect/Reconnect. Reconnect requires idle plus load/resume, previews
old and newly eligible connectors, binds the page/configuration/approval/generation
and never manufactures a prompt. Invalid files block new connections while existing
instances remain disconnectable. Browser detach cancels tests/decisions and retains
approved work. JSON drafts remain renderer-owned. References/OAuth still report
Authentication required; secure credentials and generic OAuth remain phase 6.

Validation is complete. The isolated Linux amd64 devcontainer passed one-worker
`npm run check`: 308 files / 2,932 tests in 666.12 seconds, including all four
unchanged coverage gates. Focused production protocol, authority, approval, limits,
resource/reconnect and durable enablement checks passed. Actual ACP/stdio fixtures
cover new/load/resume, permissions, calls/cancellation and revoked/cross-session
capabilities; modern HTTP JSON/event-stream responses and stateful cleanup are
covered separately. Gated setup/disconnect tests prove that neither an upstream nor
an adapter completing late can revive revoked authority.

All 11 real-browser MCP journeys passed (nine configuration/editor regressions and
two runtime journeys), with independent file/private-metadata/native-process checks.
The separate first-use → acceptance → automatic edits → reload → Undo journey passed.
Packaging, installed Linux smoke (including local JSON worker and offline model),
and native macOS packaged-adapter/lease/process-group checks passed. Earlier
schema/completion/coverage failures and contended five-second real-Git timeouts are
preserved. The unchanged Relay suite passed all 30 cases in the final full run
after competing jobs ended; no assertion, timeout or coverage floor was relaxed.

The two owned containers and exported image were removed; empty task-label
container/image inventories and native PID/listener/temporary-root absence were
independently verified. Other work's resources and the pre-existing default bridge
network were preserved. Dependency/build/npm/browser/model caches, BuildKit cache,
port reservations and evidence remain. Commands, failures and results are under
`test-results/qa/mcp-connectors-phase-5/`. Phase 5 is delivered as one DCO-signed
commit pushed to the existing draft PR #317.

The MCP Servers capability descriptor, availability assertions and generated catalog
are updated for the new human controls. Phase 6 authentication and phase 7 recovery
GUI/troubleshooting reports remain outstanding; all dedicated-integration, shared
registration/client ID/secret, hosted-authentication, migration and legacy-SSE
exclusions remain.


### Phase 6 implementation record (complete)

Phase 6 delivers the platform-only bounded native credential helper with exact
`@napi-rs/keyring` 2.1.2 and explicit Linux Secret Service selection; an
application-owned versioned vault and grant coordinator; guarded anonymous OAuth
metadata discovery, user registration/metadata-URL IDs or per-installation dynamic
registration; S256/state/exact-issuer/resource checks and five-minute page/revision-
bound callbacks; serialized refresh without authentication or business-call replay;
and human transient credential, explicit persistent/temporary, sign-in/cancel/
forget/sign-out controls. Application receives narrow injected ports and still
imports no agents implementation. Upstream credentials never enter ACP setup,
configuration drafts, ordinary snapshots or private plaintext operation metadata.

Credential identity binds installation, canonical source/server, security-relevant
definition, reference and account/grant. Label/enablement edits preserve that
identity; moves transfer neither credentials nor approval. Sign-out revokes
capabilities first and preserves deletion tombstones with independent remote
revocation outcomes. Explicit temporary entries last until backend restart or
sign-out; persistent failures never become temporary implicitly. Unclean epochs
require fresh entry/authorization. Private heads/receipts/scope/reference metadata
are cross-checked before native lookup. Concurrent cold secure reads converge on
one cached grant and refresh; the gated eight-reader fixture proves one exchange.
Phase 4 drafts remain intact; failed sign-in cancellation stays visible until
acknowledged, and late status replies cannot update a replacement owner.

Validation passed in the isolated Linux amd64 devcontainer: final one-worker
`npm run check` passed **315 files / 2,996 tests in 546.54 seconds**, including
instructions, typecheck, Biome, Knip and all four unchanged coverage gates.
Supporting integration covers strict requests, credential binding/version/replay,
locked/unavailable storage, temporary restart, tombstones and corrupt metadata,
OAuth discovery/registration/PKCE/state/issuer/resource/scopes, callback replay,
refresh cancellation/races/uncertain exchanges, real HTTP cancellation/no replay,
private DNS/socket/redirect policy, native helper pipes/process groups and actual
OAuth-backed ACP new/load/resume. Browser detach preserves authorized work; sign-out
revokes capabilities. Stateful HTTP streams survive setup completion and close on
cleanup. Provider setup has no upstream credentials/URLs and proxy call counts stay
zero.

All **11 existing MCP browser journeys** and **four authentication journeys**
passed, including manual/template/paste/configuration flows, malformed/recovery
states, enablement/approval/test/reconnect/disconnect, temporary consent, unavailable
persistent storage without fallback, sign-in/cancel/sign-out, dropped cancellation
acknowledgment, callback cleanup and retained JSON drafts. The separate first-use
→ acceptance → automatic edits → reload → Undo golden journey passed. Model
preparation, rebuilt npm package and installed Linux CLI/backend/local JSON-worker/
offline-model smoke passed.

Packaged native Linux x64 verified available/locked/unavailable Secret Service,
round-trip, owned deletion and cleanup on a private disposable bus. Packaged macOS
arm64 verified a unique synthetic Keychain entry, unavailable default-store
handling and independent deletion lookup; the packaged adapter also passed real
initialization/discovery/call, revocation, lease and process-group cleanup. No
shared Keychain was locked or unrelated credential enumerated. The initial macOS
isolated-HOME blocker and earlier failures remain recorded; the corrected native
probe passed rather than being replaced by a mock.

Owned containers 5cf2c4dd222d and beef2beb3231 and exported image 65f8cd9901ba were
removed after validation. Empty task container/image inventories, preserved other
containers, native prefix/PID/listener absence and scratch removal were independently
verified. Dependency/build/npm/browser/model volumes, BuildKit cache, port reservations
and evidence remain. Commands, failures, screenshots and typed native results are
under `test-results/qa/mcp-connectors-phase-6/`. No assertion, timeout, coverage floor
or broad Knip exclusion was relaxed. The two explicit QA-only binary allowances
cover gdbus and gnome-keyring-daemon. Architecture/module instructions, MCP/recovery
guidance, capability descriptors/availability tests and generated catalog are updated.

Phase 6 is delivered as one DCO-signed commit after phase 5's separate validated
commit, pushed to existing draft PR #317. Phase 7's transaction-recovery GUI and safe
troubleshooting report remain deferred. Dedicated integrations, shared Code60
registration/client IDs/secrets, hosted authentication, migrations and legacy SSE
remain excluded; pre-bundled definitions remain optional templates and runtime
support remains tools only.

## Phase 7 implementation record (complete)

Phase 7 adds human-only Configuration recovery, structured connection failure
stages/guidance, retained-handle cleanup verification and an optional local safe
troubleshooting report. Transaction reviews project private evidence into operation
order, scoped before/after existence/validity/counts and current known states.
Commits bind every live runtime/database address, exact file revision and a journal
revision covering native identity, nanosecond stamps and content. Same-byte journal
replacement, external edits, third states and replaced/closed owners require fresh
review or block recovery; no force or lock deletion is provided. Durable recovery
request IDs preserve recorded outcomes without repeating publication.

Recovery retains renderer JSON/form drafts and leaves compare/reload explicit.
It transfers no credentials or approvals and restores no execution authority.
Cleanup verification acts only on retained revoked handles for the captured scope,
coalesces residual flights and releases capacity once after verification. It never
reconnects or discovers/kills unrelated processes. Failures retain ownership.

Agents classify structured native/SDK codes without parsing or exposing raw server
messages. Fixed stage/code guidance describes next human actions and continued
availability of other tools. The strict optional report contains counts and states
only, including validity, approval, authentication and observed health separately.
It excludes names/IDs, paths, endpoints, definitions, references, secrets and raw
exceptions. Review/copy is explicit and local; no automatic upload occurs.

Architecture, module instructions, MCP/user/security/recovery documentation and
human-only capability descriptions are updated. Validation evidence and failures
are recorded under `test-results/qa/mcp-connectors-phase-7/`. Required protocol,
full-check, real-browser, applicable package/native validation and owned cleanup
are verified. Phase 7 completes the seven-phase implementation within the agreed
scope; delivery remains on the existing draft PR #317, without merging main.


### Phase 7 validation and delivery

The final one-worker `npm run check` passed **318 files / 3,025 tests in
572.54 seconds**, including instructions, typecheck, Biome, Knip and all unchanged
coverage gates: statements 71.08%, branches 64.06%, functions 64.90%, lines 73.47%.
The final full Linux browser run passed **all 39 journeys (6.2 minutes)**,
including all prior MCP management/editing/runtime/authentication journeys and
8 recovery/troubleshooting journeys. The separate first-use → acceptance →
automatic edits → reload → Undo golden journey passed (16.9 seconds).

Independent browser oracles verify destination-first Complete/Roll back,
third-state refusal, exact malformed rollback after a combined reset, native file
modes/private preimages, retained drafts, safe report/clipboard contents and
permission failures without publication. A real HTTP fixture retained uncertain
cleanup until explicit verification: one initialization, one discovery, zero
business calls and three explicitly caused DELETE attempts, with no reconnect.
A malformed saved file still reports the connected instance captured by an active
session. Supporting integration separately covers journal/native identity review,
reopened-owner fences, durable replay, guarded writes/quotas, safe native network
codes and actual ACP new/load/resume/permissions/cancellation/revocation.

The authentication audit also corrected stale observed authentication after
mid-turn credential/401/403 failures. Three regression cases verify required/failed
facts, useful guidance and no replay (zero business calls before a failed credential
gate, exactly one for a server refusal). The actual OAuth-backed ACP/protocol
supporting suite passed 49 tests. These are supporting integration results, not a
substitute for the full browser journeys.

The rebuilt npm tarball contains 1,139 files / 169,588,494 bytes; SHA256 is
`b57c7326072c14f17978b9acda4bd34ec5087df85775f2a6454c798ac333ecbf`.
Installed Linux CLI/backend/local JSON-worker/offline-model smoke passed. Packaged
Linux x64 Secret Service checks passed available/locked/unavailable states,
round-trip/deletion and private-daemon cleanup. Packaged macOS arm64 checks passed
a unique synthetic Keychain round-trip/deletion and unavailable-default handling;
independent security lookup returned 44 after owned deletion. Both native packaged
adapters passed initialization/discovery/call, revocation, lease and process-group
cleanup. No unrelated credentials were enumerated and no shared Keychain was locked.
Browser journeys ran on Linux; macOS evidence covers the MCP native helper and
adapter. No native login service was installed or validated; that remains a separate
authorized release task rather than an MCP implementation claim.

Final owned container `fabdd05a783f` / cache initializer and image `89b40c9ea96d`
were removed. Task-label container/image inventories are empty; the other worktree's
containers are preserved. Independent checks confirm native prefixes/PIDs/groups,
private Linux daemon and macOS listener are gone. Dependency/build/npm/browser/model
volumes, BuildKit, port reservations, QA evidence and the preserved previous package
remain. Initial failures, the mixed-cache validation run and status-label regression
are retained under `test-results/qa/mcp-connectors-phase-7/`; only final frozen-source
results establish completion. No assertions, timeouts, coverage floors or Knip
exclusions were relaxed. Capability descriptors/availability tests and the generated
catalog describe the delivered human-only recovery and troubleshooting operations.

Phase 7 delivery was one DCO-signed commit on `mcp-connectors`, pushed to existing
**draft PR #317**. At that delivery checkpoint the PR remained draft, with main
integration outstanding and no merge/release-readiness claim. Dedicated integrations,
Code60-owned/shared registrations/client IDs/secrets, hosted authentication,
migrations and legacy SSE remain excluded. Runtime support remains tools only;
pre-bundled Playwright/Context7 definitions remain optional disabled templates.

### Main integration follow-up — 2026-11-24

At the user's request, integrate `origin/main` at
`fb74080e7d2d9eb216fc1cec23c3f43548fa6024` and prepare PR #317 for review.
Preserve phases 1–7 alongside the newer setup, update, provider installation/login,
Transmission and LAN workflows. MCP screens use the shared HTTP-safe ID/clipboard
helpers. The installer distribution selects an explicit Node-only platform index;
its closure verifier continues to reject third-party/application dependencies.
Native fixtures use canonical roots and platform-aware editor shortcuts. The fake
ACP provider rejects requests after adapter exit instead of waiting for its timer.

Native macOS arm64 / Node 24 validation: full one-worker `npm run check` PASS,
350 files / 3,433 tests, all four unchanged coverage gates. Full browser rerun PASS,
53 journeys with the Linux-only unavailable-Secret-Service scenario skipped;
separate first-use/acceptance/automatic edits/reload/Undo PASS. Native package,
installed CLI/backend/assets/local JSON worker/offline model, and packaged MCP
adapter initialization/discovery/call/revocation PASS. Independently verified the
owned native prefix, PID and listener were removed. Fixture contexts, gateways and
processes closed. Retain caches, previous/new tarballs and failed evidence under
`test-results/qa/mcp-connectors-main-merge/`.

Docker validation remains BLOCKED by the unavailable/hung daemon. No containers or
images were created, restarted or removed for this integration; only the owned
hung read-only Docker CLI was terminated. The documented native workflow supplied
the validation above, without changing shared Docker settings. No test assertion,
timeout, coverage floor or broad Knip exclusion was relaxed. The capability catalog
was regenerated with both branches' existing product operations. Delivery is a
DCO-signed merge commit, followed by the requested push and ready-for-review PR
transition. This does not merge the PR into main or prepare a release; all agreed
MCP scope exclusions remain unchanged.
