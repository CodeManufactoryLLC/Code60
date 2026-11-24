# Gateway

Own one application host and scheduler. Depend on application, automation, bridge, contracts, core and platform through indexes. Keep authenticated loopback HTTP and the explicit private-LAN Web Server Beta ingress described in ARCHITECTURE.md; never expose generic commands or paths. Private management authentication is separate from browser sessions. Revoke page interactions on detach and never replay uncertain effects. Preserve cleanup ownership on failure.

Pairing codes are optional and off by default. Direct entry still requires a
same-origin JSON handshake and per-tab tokens; never remove auth checks from
application operations or events. Only private local management can change pairing
policy. Changes revoke page sessions/decisions, not approved work.

Explicit ports are a Node-only development option requiring development assets.
Production keeps allocated loopback ports; forwarded development access must use
the exact gateway origin. Never loosen Host/Origin validation for container access.

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
The private uninstall summary likewise accepts no body or browser Origin. Saved
workflow counts are read-only evidence, not proof that engine processes are gone;
removal must separately verify process ownership and refuse uncertain work.

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
