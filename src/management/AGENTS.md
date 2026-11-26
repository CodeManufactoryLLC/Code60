# Management

Own the narrow local setup/status/update/uninstall/open/service/pairing CLI. Depend on gateway, platform, core and contracts through indexes. Never expose agent execution commands. Non-TTY service/pairing changes require explicit --yes; files-only setup remains non-interactive; do not prompt indefinitely. Never place pairing codes or secrets in subprocess arguments or diagnostics.

Internal distribution orchestration stays separate from CLI parsing. Bootstrap
installer exports and launcher support must depend only on Node-built-in platform
APIs, never gateway/application initialization. Keep acquisition and launcher delegation Node-only. Installed setup owns gateway-dependent orchestration.
Own installation receipts and shell previews; never expose these APIs to browsers.
Reuse matching releases and require explicit repair of owned bindings; no legacy
migration or implicit version update. Shell previews contain only additions and
fingerprints, not original profile contents. Profile writes require interactive
approval and fresh identity checks. See [installation internals](../../docs/distribution/installation.md).
Shell removal has a separate preview and approval. Match the exact recorded
addition, preserve unrelated bytes and leave changed or ambiguous blocks for
manual inspection. Record partial completion without reverting user changes.

Setup and status are public candidate commands. Keep service consent default-no and
separate from profile approval; --yes never authorizes profile edits. Files-only
setup exits successfully but explicitly reports incomplete setup. Hold only the
owned non-reclaiming setup lock; do not nest the installation lock. Preserve partial
registration/data on failure and never turn setup into update or implicit repair.
Status never initializes, repairs, pairs or starts anything. Database preparation
is a fixed private gateway operation with no path payload.

Explicit updates must verify a candidate before stopping the backend, retain the
prior activation and record durable progress at activation boundaries. Setup
remains limited to the matching release. Never execute acquired bootstrap code,
downgrade a database or resume uncertain execution during recovery. Browser update views have read authority only.
Reject an old current pointer that contradicts recorded publication before
consent or service effects; preserve both the pointer and journal for inspection.

Internal uninstall recovery lives under removals/<attempt>, outside releases and
activations, with a pinned-Node launcher, immutable hashed receipt/support and CAS
progress. Recovery must work after entrypoint/cache deletion without readActivation.
Validate the original installation/root/current identities, complete remaining
inventory and original service scope before deletion. Hold compatible service
ownership throughout cleanup; never derive its scope from new caller XDG values.
Preserve changed support, foreign files/launchers and all data/engine/worktree state.
Release failures remain failures after completed deletion; do not roll it back.
Reinstall refuses unfinished removal and recognizes a later healthy activation;
an old recovery attempt can never delete that new installation.
Use explicit verified payload directory metadata for shipped empty directories;
undeclared additions never become owned through their name or location alone.
Installed uninstall parsing/orchestration stays outside the Node-only bootstrap
index. Parse before effects and read removal progress before requiring an intact
activation. The default CLI must match the current release before a new attempt;
old launchers cannot uninstall a later activation. Refuse active/uncertain work,
then require service/application consent and separate profile approval. Publish
and print durable recovery before deletion. Release the outer setup lock before
calling cleanup, which owns its own setup/install/runtime/service locks.

Installed update and uninstall ports select the packaged `dist/bootstrap` Node-only support
closure, never the application platform directory. Preserve strict launcher
receipt path/hash validation; do not admit bootstrap variants or credential
runtime dependencies to work around a packaging failure.
