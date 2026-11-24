# Management

Own the narrow local setup/status/update/open/service/pairing CLI. Depend on gateway, platform, core and contracts through indexes. Never expose agent execution commands. Non-TTY service/pairing changes require explicit --yes; files-only setup remains non-interactive; do not prompt indefinitely. Never place pairing codes or secrets in subprocess arguments or diagnostics.

Internal distribution orchestration stays separate from CLI parsing. Bootstrap
installer exports and launcher support must depend only on Node-built-in platform
APIs, never gateway/application initialization. Keep acquisition and launcher delegation Node-only. Installed setup owns gateway-dependent orchestration.
Own installation receipts and shell previews; never expose these APIs to browsers.
Reuse matching releases and require explicit repair of owned bindings; no legacy
migration or implicit version update. Shell previews contain only additions and
fingerprints, not original profile contents. Profile writes require interactive
approval and fresh identity checks. See [installation internals](../../docs/distribution/installation.md).

Setup and status are public candidate commands. Keep service consent default-no and
separate from profile approval; --yes never authorizes profile edits. Files-only
setup exits successfully but explicitly reports incomplete setup. Hold only the
owned non-reclaiming setup lock; do not nest the installation lock. Preserve partial
registration/data on failure and never turn setup into update or implicit repair.
Status never initializes, repairs, pairs or starts anything. Database preparation
is a fixed private gateway operation with no path payload.

macOS payload installation preserves declared Transmission bundles in independent
engine storage before activation. Repeated setup validates original bindings;
it never silently changes a version's Node or dependencies. Installation failure
must retain published engine bindings and existing workflow state/caches.

`code60 workflows login` is a fixed terminal-only delegation to cached Codex
authentication. Parse before effects, use recorded Node, strip Node/npm injection,
bound and await owned child cleanup, and preserve exit/signal results. Never
install, start an engine, expose command/credential overrides, log authentication
output or update application provider verification. Keep it out of the bootstrap
closure; only the installed CLI owns this interaction.
Use the verified cached native Codex even when CODEX_PATH configures a different
application provider executable.

Explicit updates must verify a candidate before stopping the backend, retain the
prior activation and record durable progress at activation boundaries. Setup
remains limited to the matching release. Never execute acquired bootstrap code,
implicitly replace healthy engine bindings, downgrade a database or resume
uncertain execution during recovery. Browser update views have read authority only.
Reject an old current pointer that contradicts recorded publication before
consent or service effects; preserve both the pointer and journal for inspection.

Installed update ports select the packaged `dist/bootstrap` Node-only support
closure, never the application platform directory. Preserve strict launcher
receipt path/hash validation; do not admit bootstrap variants or credential
runtime dependencies to work around a packaging failure.
