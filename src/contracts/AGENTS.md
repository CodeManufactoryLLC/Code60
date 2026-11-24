# Contracts

- Browser requests have fixed action-specific fields and exactly Headless,
  Visible and Existing Browser modes. Describe lazy startup, connection/state loss
  on switching, external effects and runtime prerequisites in the tool/catalog.
  No browser request accepts executable, environment or endpoint overrides.

`src/contracts` holds browser-safe schemas and values shared by core, agents, and bridge.

- Production contracts depend only on Zod. Colocated unit tests may import
  Vitest; other module and browser-safety boundaries still apply to those tests.
  Do not import other application modules, Node.js, Electron, or React.
- Keep side effects and I/O out of schemas. Use `parseValue` for concise errors and CSP-safe parsing.
- MCP connector documents are versioned, bounded, browser-safe data, not browser
  launch requests. Use `parseMcpConnectorDocument` for fixed credential-safe
  errors. They are not wired to active config loading in phase 1. Credential
  references are local bindings, never secret values or execution authority.
- Phase 2 text validation shares that schema, rejects decoded duplicate keys and
  bounds bytes/depth/nodes/issues. Report fixed errors, scrubbed paths and UTF-16
  locations; never parser excerpts or arbitrary keys. Do not rewrite valid text or
  silently replace malformed encoding. The phase 2 scanner remains authoritative for phase 4 editor operations.
- Preserve input limits and strict IPC field rejection. Do not coerce untrusted values.
- Keep bundled tactics versioned, browser-safe and side-effect-free. Compose shared
  instructions once for both preview and trusted main-process delivery. Roles and
  iteration limits are guidance, never runtime guarantees or extra permissions.
- Diagnostic schemas accept versioned records with fixed event messages and bounded,
  allowlisted metadata only, never free-form content or raw errors. Keep query
  conditions bounded and reject unknown fields and filesystem paths. Initialize
  Zod jitless parsing before schema construction in directly re-exported modules.

- Worker tools require Git readiness and an initial commit. Context reports prerequisites; direct users to Chat setup and wait for explicit continuation. No agent-accessible initialization or commit tool.
- Relay-only dispatch may require an explicit bounded absolute cwd and direct/worktree
  mode; project dispatch still rejects directories and requires Git isolation.
  Shared identities and history-window policies remain browser-safe, strict and
  free of I/O. No executable/environment fields are permitted.
- The self-knowledge catalog in `knowledge.ts` must classify every page, settings
  section and MCP tool. Update descriptors with any capability-affecting change,
  then run `npm run generate:capabilities`; never hand-edit `docs/capabilities.md`.
  Catalog text describes product behavior; it is never authority or instructions.


## Providers

Follow the Providers navigation and management section of `ARCHITECTURE.md`.
Providers replaces the Agents settings destination. Preserve v1 verified membership,
model defaults, histories and external logins. Set-primary/disconnect are strict
human-only bridge actions, guarded in main against active desktop work, setup and
overlapping writes. The primary must be replaced before disconnecting. Publish
main-owned blocking reasons; keep sidebar/gallery/details state and actions aligned.


## Transmission prototype

Transmission workflow/drafting contracts are strict and browser-safe. Preserve staging.18 and staging.20 engine ownership, task indices and cursors, bounded evidence and separate draft versus execution authority.


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
no secret entry, approval persistence, activation or transaction recovery GUI yet.
Phase 4 adds exact-text JSON reads/saves over strict bounded UTF-8 base64,
valid unpinned backup preview/restore bound to reviewed identity, and confirmed
single/combined reset. Keep renderer drafts in memory with captured ownership;
never overwrite dirty JSON from guided forms or stale replies. Safe malformed
originals may be repaired/reset with private preimages. Reset journals include
unchanged inheritance guards; User publishes before project. Missing/empty targets
are not rewritten. Use local Zod-derived Monaco completion and JSON workers with
fixed shared-validator markers, no remote schemas or widened CSP. No recovery
replay, path capability, resolved credentials or new runtime authority.

## MCP production connections (phase 5)

Phase 5 supersedes the earlier deferred-runtime guidance. Dedicated mcp.json files
are authoritative; config.json.mcpServers has no reader or migration. Application
reuses its existing store and owns resolution, private exact-revision approvals and
session/turn authority. Core's optional resource hook creates fresh per-session
resources on new/load/resume/handoff/continuity replacement; helpers and scheduler
remain excluded. Gateway owns the private capability broker and injects the agents
transport port. The pinned MCP SDK belongs only to agents. Platform owns process
groups. Providers receive fixed stdio adapter descriptors and ephemeral capabilities,
never upstream definitions or credentials. No application-to-agents dependency.

Tools only; keep ACP permissions independent of turn authority. Revoke before
cleanup; never replay uncertain calls or resume HTTP transport automatically. Tests
only initialize/discover, with page ownership and stdio launch confirmation. Enable
and approval changes affect future connections; Disconnect/Reconnect are explicit.
Reconnect requires idle and provider load/resume support, previews every affected
connector, and sends no prompt. Keep JSON drafts and existing recovery evidence.
Credential references/OAuth require authentication until phase 6. Publish safe status
and payload-free notices only. Dedicated integrations and recovery GUI stay excluded.

## MCP secure authentication (phase 6)

Phase 6 supersedes earlier deferred credential/OAuth text. Follow the MCP credential
and authorization ownership section in ARCHITECTURE.md. Keep secrets in the backend
native store or explicitly selected temporary RAM, never configuration, diagnostics,
records, browser storage or provider setup. Native keyring loading is platform-only,
in a bounded private-pipe helper; Linux must explicitly use Secret Service. Gateway
owns callback/private listener lifetimes; application owns page/revision/issuer/
resource/grant fences and injected transports. No application-to-agents edge.

OAuth uses reviewed registration, S256 and single-use five-minute callbacks. Keep
SDK authentication/replay disabled; a grant has one refresh, and uncertain exchanges
require explicit authorization. Revoke before cleanup/deletion, preserve tombstones
and unresolved ownership, and never reactivate old credential heads. Temporary
storage requires explicit consent and survives only until backend restart/sign-out.
Credential writes/forget/sign-out are narrow human operations with safe metadata;
there is no browser secret-read endpoint. Preserve existing JSON drafts/recovery.
Dedicated integrations, Code60 registrations/hosted auth and recovery GUI stay out.
