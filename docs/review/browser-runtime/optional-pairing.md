# Optional browser pairing

Browsers now connect without a code by default. `code60 pairing on|off|status`
controls the optional requirement through local private management; setting changes
ask for consent and require `--yes` without a TTY. It works with a running backend
or offline before service installation. Explicit choices are saved in private
`gateway/settings.json`, preserving configured workspace roots.

Direct entry still issues a per-tab session through a same-origin JSON POST. Host,
Origin, version and field validation remain enforced, and every application/event
request still requires a valid session and controlling page identity. Only one
browser controls execution. The code requirement does not change permissions for
agent tools, workspace chooser roots, service enrollment or remote access.

Changing modes revokes existing browser sessions and pending page decisions;
already approved conversation/worker/scheduler work continues. The browser either
reconnects directly or displays the code form. An unchanged policy saves an explicit
preference without disconnecting its browser. Shutdown waits for any pending policy
write. Delayed request bodies and queued operations recheck authorization before
execution so a revoked session cannot finish a late operation.

Validation uses isolated state and fake ACP providers. The browser journey creates
a database without a code, refreshes without a code, keeps an agent turn waiting at
a controlled external checkpoint through on/off changes, then releases it and
verifies completion with no duplicate provider launch. It also checks explicit
second-window takeover and policy persistence after backend restart. Backend tests
cover hostile Origin/Host, missing credentials, malformed requests, one-use codes,
old-token revocation, delayed request bodies, private offline writes and live writer
contention. The installed tarball smoke covers offline CLI policy changes and
code-free session establishment, alongside assets and offline model inference.

The existing lazy-Open cancellation test now waits for its expected initial Relay
provider to become idle before exercising Stop all. This removes a race in the test
starting state; no application behavior was changed for that correction.

The running development app and earlier inspection database are retained. Browser
validation uses its own `test-results/pairing-e2e` output directory, preserving
`test-results/dev` and the previous database smoke artifact. No native service,
live test provider, Git hook or external release was installed or published.

Commands and local results are recorded under ignored
`test-results/qa/optional-pairing/`. See [the architecture](../../../ARCHITECTURE.md)
and [usage](../../../README.md) for current behavior.
