# Management

Own the narrow local setup/status/open/service/pairing CLI. Depend on gateway, platform, core and contracts through indexes. Never expose agent execution commands. Non-TTY service/pairing changes require explicit --yes; files-only setup remains non-interactive; do not prompt indefinitely. Never place pairing codes or secrets in subprocess arguments or diagnostics.

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
