# Distribution artifacts

These commands build unpublished release candidates, including the pinned macOS
workflow components. Installation and setup use these artifacts through the
[managed installer](installation.md) and [setup flow](setup.md). The source package
and generated bootstrap remain private. Never publish or tag as part of
contributor acceptance.

## Build candidates

Use Node >=24.22.0 <25, npm and Git. Prepare dependencies with `ONNXRUNTIME_NODE_INSTALL=skip npm ci` and pinned
models with `npm run prepare:models`. Build macOS arm64 payloads on Apple Silicon.
Build Linux x64 payloads in the pinned Debian amd64 development container:

```sh
npm run devcontainer -- up
npm run devcontainer -- exec npm ci
npm run devcontainer -- exec npm run prepare:models
npm run devcontainer -- exec npm run package:payload
npm run devcontainer -- exec npm run test:payload
npm run test:packaged:clean -- --payload release/payloads/linux-x64.json
npm run devcontainer -- down
```

For native macOS, run `npm run package:payload` followed by `npm run test:payload`
on the host. Native smoke uses isolated state and a foreground Gateway; it does
not install or inspect the user's login service. The required CPU/image libraries
are tested with an image decode and a real offline 768-dimensional embedding.
Linux requires glibc and libgomp1; Alpine/musl and Linux arm64 are unsupported.
These checks do not establish broader OS/library minimums or native service support.

The builder installs a fresh locked production tree with scripts disabled, without
copying host dependencies. Build-time npm access is permitted; extraction and
runtime acceptance perform no npm resolution, lifecycle scripts or compilation.
Payloads include compiled assets, models, production notices and provenance.
Foreign ONNX platform binaries and cache directories are explicitly excluded.

Each target produces `release/payloads/<os>-<arch>.json` and a versioned tar.gz.
Collect both targets' descriptors and archives into one directory, then run:

```sh
npm run package:bootstrap -- release/payloads
npm run test:bootstrap
```

The bootstrap test exercises its actual packed CLI and embedded-descriptor staging,
then runs the native CPU/model probe against the resulting payload.

Both descriptors must agree on version, commit and dirty provenance; their archive
sizes and hashes are verified before packing. The bootstrap goes under
`release/bootstrap`, separately from the unchanged legacy npm tarball under
`release/build`. Phase 5 adds setup to the private bootstrap's help/version
interface. Its staging library selects only an embedded platform descriptor;
installation and consent semantics are documented in [setup behavior](setup.md).

## Integrity and extraction

Descriptors pin canonical GitHub Release URLs, byte counts and SHA-256 values.
The exact bootstrap's embedded descriptor is the integrity anchor, not a mutable
release listing. Production transport follows at most five HTTPS redirects to
GitHub's approved asset hosts. There is no URL environment variable or CLI override;
local artifact serving is injected only through test ports.

Downloads are bounded to five minutes and 2 GiB. Extraction supports the generated
USTAR/per-entry PAX format, validates the complete inventory before writing, and
limits expanded data to 8 GiB, entries to 200,000 and paths to 4,096 bytes. It rejects
unsafe paths, escaping/cyclic links, entries under links, hard links, special files,
privileged modes, duplicates and malformed/truncated archives. Internal symbolic
links are created after regular contents. Payload provenance, inventory hashes,
lockfile identity and required assets are checked before returning owned staging.
No release activation or existing installation mutation occurs.

## Acceptance, ownership and recovery

The legacy `npm run test:packaged:clean` command remains unchanged. Its explicit
payload mode reuses the customer/driver isolation, full first-use golden journey,
Host/Origin checks, pairing controls, model probes, fault detection and process
cleanup. Payload extraction itself also runs with external networking disabled;
the fixture server exists only in the extracting container's loopback namespace.
Fake provider scripts are added only to test installations after verification and
resolve the payload's installed production SDK.

Follow the [shared-host rules](../../AGENTS.md#concurrent-work-on-a-shared-host).
Keep each run's evidence and ownership labels. Remove only owned staging,
containers, exported images and temporary state volumes, including after failure;
retain BuildKit/dependency caches and evidence. Never prune globally or delete
locks/history to recover an installation. Failed staging cleanup reports its owned
path and fails acceptance rather than claiming success.

Native smoke evidence is under `test-results/payload`; Docker evidence is under
`test-results/clean-install`. Record unavailable native validation separately.
Ordinary PR CI remains Linux-only and requires payload acceptance in `CI passed`.
The manual native workflow accepts an exact PR commit and retains the macOS payload;
manual release generation verifies both targets against its clean selected commit
before assembling the bootstrap. It uploads workflow artifacts only, with no npm
publication or GitHub Release asset mutation.

CI scopes `COMPOSE_BAKE=false` to its disposable Linux payload job so the runner's
Compose 2.x uses its classic builder with the Dev Container CLI's temporary
Dockerfile. This does not change the host Docker configuration or disable
filesystem entitlement checks. See [Compose builder selection](https://docs.docker.com/compose/how-tos/dependent-images/).

The PR payload job checks out the explicit PR head commit, matching the native
workflow's selected source identity. Ordinary unit/browser/package jobs still
validate GitHub's integrated PR merge snapshot. This keeps paired descriptors
consistent without weakening those existing regression checks.

Phase 5 adds the private candidate setup command; see [setup behavior](setup.md).
The bootstrap remains dependency-free and below 1 MiB, with no production URL
override, install hooks or publishing action.

## Pinned workflow components

macOS packaging additionally stages the two supported Transmission artifacts from
`distribution/transmission/package-lock.json` into a fresh tree with scripts
disabled. It verifies the prebuilt Apple Silicon Codex runtime before archiving,
records exact package integrities, dependency inventory, native hashes, Node and
lockfile identity, and includes dependency notices. These pinned releases have no
native helper sources requiring compilation. Do not substitute helpers or APIs
from the newer Transmission repository. Linux x64 payloads stage the pinned Transmission 0.1.1 tarball from `distribution/transmission-linux` with the Linux Codex executable. The lock records the candidate integrity. The bundle records the dependency inventory and native binary digest.

Exclude dependency `.npmignore` and `.gitignore` metadata before recording the
engine inventory, since npm strips or renames it when repacking. The installed
npm-package smoke verifies both preserved engine bindings without launching them.

Runtime acquisition is forbidden: installation and explicit workflow start may
preserve verified local bundled files in independent engine storage, without npm,
compilation or a public transport override. Immutable version bindings keep
staging.18 and staging.20 routing separate from application activation. Preserve
published bundles and old executable caches if setup fails or an app is replaced.
