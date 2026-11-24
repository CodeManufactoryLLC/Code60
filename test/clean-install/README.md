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

## Platform payload mode

After building a Linux candidate in the pinned amd64 container, run
`npm run test:packaged:clean -- --payload release/payloads/linux-x64.json` on the
host. See the [artifact workflow](../../docs/distribution/artifacts.md).
This mode verifies descriptor/platform/hash/inventory before using the same
installed golden journey and fault/process probes. Extraction uses the local
artifact server with external networking disabled and performs no npm install,
lifecycle scripts or compilation. The original npm tarball mode remains independent.

## Setup mode

Run `npm run test:packaged:clean -- --setup release/payloads/linux-x64.json` after
building the Linux candidate. The test-only single-platform bootstrap uses the
actual CLI entry and installer adapter; production packaging still requires both
real descriptors. A files-only stage preserves its isolated HOME/config/state;
explicit approval then runs real backend setup through the dedicated bounded
supervisor, with no actual systemd registration. The launcher runs after cache
removal, then the shared golden journey verifies the provider through UI and uses
the setup-created database. Release/activation volume subpaths are read-only;
management metadata and database storage remain writable. No checkout or host
credentials enter the customer. Original tarball, payload and managed modes retain
their independent manual-database journeys and fault/leak/cleanup probes.

## Update mode

Run `npm run test:packaged:clean -- --update release/payloads/linux-x64.json` after
building the current Linux payload. The Node-only customer prepares a managed
installation and a controlled newer version fixture entirely with `--network none`.
Only the test artifact transport and native supervisor are injected. It exercises
integrity failure, declined consent, SIGINT before publication, explicit recovery,
concurrent update rejection, successful activation and read-only/no-op behavior.

The preparer stops its real backend before handoff. The host validates the new
layout and removes the temporary installer/bootstrap support before starting a
fresh customer. Releases and activations are mounted read-only; preserved custom
database, preferences and management metadata remain writable. A separate driver
shares the customer's loopback namespace and completes the shared golden journey.
The customer contains no Playwright/Chromium or development dependencies. Existing
asset/model faults, leaked-child detection and independent labelled cleanup still
apply. Version fixtures are not release artifacts or native login-service evidence.
