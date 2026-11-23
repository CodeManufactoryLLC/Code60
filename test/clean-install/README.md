# Clean installation acceptance

Run this harness on the host with Node 24 and an already running Linux Docker
engine. It explicitly targets Linux x64, including emulation on Apple Silicon.
It does not validate native macOS, login services or Transmission.

```sh
npm run prepare:models
npm run package:app
npm run test:packaged:clean
```

The final command also accepts one archive path after `--`. It defaults to this
version's archive in `release/build` and does not rebuild it. Build prerequisites
use the checkout's normal dependencies; the harness runner itself uses Node built-ins.
Do not run it inside the development container: that container has no Docker socket.
Follow the [shared-host rules](../../AGENTS.md#concurrent-work-on-a-shared-host).

## What is tested

The customer image contains Node 24, Git and required runtime libraries, without
Chromium or development tools. A non-root installation consumes a read-only
tarball through a local HTTP artifact fixture. Production dependencies are resolved
from public npm during this step; a new npm configuration/cache is used. A corrupt
artifact must be rejected. The resolved production dependency tree is retained.

Acceptance then uses a new customer container with external networking disabled,
a fresh HOME/config/state and the installed prefix mounted read-only. Only test
fixtures, its synthetic state and evidence are mounted. No source checkout,
host dependencies, credentials, profiles or Docker socket enter the customer.

A separate driver image installs the lockfile's exact Playwright version and
matching Chromium. It shares the customer's isolated loopback network namespace,
preserving the real gateway origin without publishing ports. The driver has no
mount of the installed application or its dependencies. It runs the same golden
scenario as the checkout browser suite: provider verification, database creation,
accepted task, automatic edits, diff, attachment, refresh and Undo, with independent
filesystem/Git/index assertions. The fake provider resolves its SDK from installed
production dependencies; no verified setup or database is preseeded.

Separate probes cover the installed CLI, browser assets, strict Host/Origin checks
and real offline embeddings. Negative probes must detect missing renderer/model
assets, a mismatched architecture and an intentionally leaked child. Test-only
supervisor/opener stubs reject unexpected mutations; no service is installed.

## Ownership, evidence and failures

Every invocation has a unique run ID, Docker resource names and
`com.code60.acceptance.run` label. Concurrent invocations have independent state,
installation volumes and evidence. The runner never changes Docker's context,
starts Docker Desktop, publishes ports or prunes shared resources.

The whole run is bounded to 20 minutes, followed by at most 90 seconds of cleanup.
SIGINT/SIGTERM attempt owned cleanup before returning 130/143. Other failures,
including failed cleanup verification, return nonzero. Inspect the printed evidence
directory before rerunning; do not weaken tests or remove unrelated resources.

Evidence is kept under `test-results/clean-install/<run-id>`: artifact SHA-256,
dependency versions, phase summary, private command logs, runtime identities,
successful golden screenshots/traces and process/cleanup results. Connection
management tokens and raw private connection files are not exported. Logs/traces
contain only synthetic application data; browser tokens expire when the test
backend stops.

Containers, exported images and temporary installation/state/mask volumes are
removed on success, failure and cancellation. BuildKit caches and host evidence
remain. If cleanup reports a failure, inspect only that run label and resolve its
owned resources before claiming cleanup succeeded. Existing development-container
caches and other agents' resources are untouched.

CI downloads the exact tarball tested by the existing package job. The additional
acceptance job is required by `CI passed`; existing browser/package/model checks
remain independent. CI explicitly prepares Docker on its disposable runner before
calling the harness; the host command never starts or restarts an engine. The driver
uses an owned writable HOME rather than relying on the image's default user ID.
Future setup, update, shell integration and native-service
scenarios are not counted as passing tests in this baseline.
