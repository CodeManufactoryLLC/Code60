# Management

Own the narrow local open/service/pairing CLI. Depend on gateway, platform, core and contracts through indexes. Never expose agent execution commands. Non-TTY mutations require explicit --yes; do not prompt indefinitely. Never place pairing codes or secrets in subprocess arguments or diagnostics.

Internal distribution orchestration stays separate from CLI parsing. Bootstrap
installer exports and launcher support must depend only on Node-built-in platform
APIs, never gateway/application initialization. Keep setup unavailable until Phase 5.
Own installation receipts and shell previews; never expose these APIs to browsers.
Reuse matching releases and require explicit repair of owned bindings; no legacy
migration or implicit version update. Shell previews contain only additions and
fingerprints, not original profile contents. Profile writes require interactive
approval and fresh identity checks. See [installation internals](../../docs/distribution/installation.md).
