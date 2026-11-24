# Gateway

Own one application host and scheduler. Depend on application, automation, bridge, contracts, core, platform and agents through indexes. Keep authenticated loopback HTTP and the explicit private-LAN Web Server Beta ingress described in ARCHITECTURE.md; never expose generic commands or paths. Private management authentication is separate from browser sessions. Revoke page interactions on detach and never replay uncertain effects. Preserve cleanup ownership on failure.

MCP connector phase 1 defines contracts and protocol fixtures only. The target
composition injects agents-owned transports into application through a narrow
port; gateway owns any private loopback listener. Phases 3–4 add fixed human
configuration management/editing/restore/reset routes; production connector runtime remains deferred. Never expose adapter capabilities or
upstream credentials to browser pages.

Pairing codes are optional and off by default. Direct entry still requires a
same-origin JSON handshake and per-tab tokens; never remove auth checks from
application operations or events. Only private local management can change pairing
policy. Changes revoke page sessions/decisions, not approved work.

Explicit ports are a Node-only development option requiring development assets.
Production keeps allocated loopback ports; forwarded development access must use
the exact gateway origin. Never loosen Host/Origin validation for container access.


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


## MCP recovery and troubleshooting (phase 7)

Phase 7 supersedes prior deferred-recovery wording. Human-only recovery lists and
reviews registered targets, exact configuration revisions and a private journal
identity/content revision. Confirm Complete/Roll back through application lifecycle
serialization; every affected project must have its captured live runtime/epoch.
Unknown/corrupt evidence, replaced roots and third states remain blocked. No force,
lock deletion, automatic replay or path input exists. Keep drafts during recovery;
compare or explicitly reload afterward. Credentials, approvals and session authority
are not restored by configuration recovery.

Only fixed allowlisted failure codes/stages and guidance reach status/report views;
never echo server exceptions/output. Optional troubleshooting reports contain counts
and states only, never names/IDs, definitions, paths, endpoints, references or secrets.
Cleanup verification retries retained revoked handles for the captured scope only,
coalesces concurrent attempts and retains ownership on failure. It never reconnects,
launches a process, retries a business call or discovers/kills processes by name.

Web Server Beta has separate origin/activation-bound mandatory pairing. Only the controlling localhost page manages LAN or issues codes; LAN cannot reach private management. Preserve local pairing policy, fixed host/origin checks and the shared single-controller model. Serve bundled manifested assets on LAN; never proxy Vite there. Revoke LAN views without stopping approved work.

The private prepare-database management operation accepts no payload or browser
Origin and requires the management token. Call ApplicationHost serialization;
never initialize databases in ordinary startup or expose this route through the
browser bridge. Management status reports bounded database/engine availability
without provider probes, pairing codes or repair. Preserve XDG_DATA_HOME in the
registered runtime so setup and the backend use the same data location.

Update interruption inspection is a payload-free authenticated management read.
Report only bounded interactive/scheduled availability; do not mint pairing codes,
stop work, launch engines or grant a browser replacement authority. Terminal
updates must verify quiescence and native/backend process exit before activation.

The service-definition serializer is part of registration ownership version 1.
Changing its byte format requires an explicit versioned ownership/migration path
and old/new-definition tests. Preserve outside edits; do not bypass ownership
checks to accommodate a new formatter.

Provider installation/authentication operations accept strict catalog/session/attempt
identities and bounded code/confirmation inputs only. Derive the controlling-page owner
server-side. Do not retain provider progress responses in request-receipt caches; never
expose provider server APIs, install descriptors, commands, paths or environment overrides.

Preserve an explicitly configured absolute CODEX_HOME path for workflow login and
execution. Never persist CODEX_CONFIG payloads or provider credential environment
variables in the service definition. Existing engines retain their startup
environment; backend repair must not silently replace or cancel them.

Host path refresh and provider transport callbacks are trusted Node composition
ports, never browser/CLI/environment overrides. Isolated provider tests must own
their PATH and environment; production path recovery can discover installed host
tools even when HOME is temporary. Keep real detection and ACP verification in
those journeys while restricting their external tools to the fixture.
