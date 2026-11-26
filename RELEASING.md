# Releasing Code60

Code60 retains its Node 24 npm tarball and builds private platform payloads plus
a small bootstrap. Managed candidates support explicit terminal update/recovery;
no native installer, bundled Node or background updater is shipped. Publishing
remains an explicit release action. See [update behavior](docs/distribution/updates.md).

## Prepare a release

1. Create a release-preparation branch from current main.
2. Run `npm version <major|minor|patch> --no-git-tag-version`. Commit package.json and package-lock.json together. This browser/runtime migration is a breaking supported-interface change; its first release requires a major bump.
3. Audit [FAQ.md](FAQ.md) and [TERMINOLOGY.md](TERMINOLOGY.md) against all user-visible changes since the previous release (including supported platforms, built-in providers, CLI commands, limits, disk-space measurements, and beta/prototype notes) using the `refreshingly-simple-english` skill, and update their `Applies to:` version and `Last update:` date to match `package.json`.
4. Run `npm run check`, `npm run prepare:models`, `npm run test:browser`, `npm run package:app` and `npm run test:packaged`. Run `npm run test:packaged:clean` on a host with a Linux Docker engine; this also gates CI using the package job's exact artifact.
5. Validate the installed tarball and Node sidecars on macOS Apple Silicon and Linux x64. Test login-service behavior only in isolated, authorized environments. Container checks do not prove native macOS compatibility.
6. Merge the release PR only after CI passed. Protected main/dev branches must never be bypassed.

## Tag and publish

Tag the merged release commit on main with its exact package version. Push the tag only as an explicitly authorized release action. The manually dispatched release workflow verifies tag/manifest agreement and builds the npm tarball. The tagged candidate must pass the full Linux and native Apple Silicon matrix regardless of its PR routing. Linux verifies the exact npm tarball with a clean install and real offline embeddings, then exercises raw payload, managed install, setup, update and concurrent uninstall, including interrupted update and recovery. The bootstrap job depends on all four validations. Review the captured evidence before publishing release assets. Do not publish to the npm registry as part of ordinary implementation.

## Updating an installation

Managed installations use `code60 update`, with `code60 update status` and
`code60 update recover` for inspection and explicit recovery. Follow the
[update behavior](docs/distribution/updates.md).

For a legacy npm tarball, stop the backend, install the replacement tarball,
repair its service registration, start the backend and pair the browser again.
Preserve the old package for inspection. Never downgrade application data or
erase locks/history to make an older package start.

Managed `code60 uninstall` removes owned application resources while retaining
data, configuration and engine evidence; see [uninstall recovery](docs/distribution/uninstall.md).
Release acceptance must cover the installed golden journey, actual guarded process
exit, interrupted cleanup through the standalone launcher and retained-data
reinstallation. Component/native-engine smoke results cannot satisfy those gates.

## Platform payload and bootstrap candidates

The [artifact workflow](docs/distribution/artifacts.md) adds private platform
payloads and a builtins-only bootstrap alongside the legacy tarball. Build and
validate both Linux x64 and native macOS arm64 outputs at the exact selected
commit. The manual release workflow collects both targets, rejects dirty or
mismatched provenance, verifies archive hashes and assembles the bootstrap.
It retains workflow artifacts only; it does not publish npm packages or release
assets. The private candidate supports persistent installation and setup as
described below. Version bumps remain explicit release-preparation work.

Phase 4 additionally requires the managed installed-package journey and real shell
acceptance described in [installation internals](docs/distribution/installation.md).
The bootstrap build now compiles a narrow Node-only installer/launcher closure;
its build job installs development dependencies, while the artifact itself retains
zero runtime dependencies. Installation library APIs remain internal; publication
stays an explicit later release action.

## Setup candidate acceptance

The private bootstrap supports `setup [--yes] [--no-open]`; it remains unpublished.
Follow [setup semantics](docs/distribution/setup.md). Test `npm run test:setup` on
both supported targets and the Linux clean-install `--setup` mode in addition to
artifact-only, managed and legacy npm checks. Pair only real descriptors from the
same commit and verify bootstrap size/integrity. Keep release visibility private;
this phase neither uploads release assets nor publishes npm packages. Real native
login lifecycle validation remains a later, separately isolated release gate.

## Native workflow validation

Workflows run natively inside Code60 Gateway using Code60's verified ACP providers
and local `node:sqlite`; payloads must not contain any bundled external engine
directory under `dist/engines/`.
The [native workflow](.github/workflows/native-tests.yml) builds and tests one
payload, then hands it to separate jobs for managed update, retained/restart
regressions and each complete application update journey. Each consumer verifies
the exact artifact against its source checkout before execution. At most two
workflow jobs run concurrently, each with one browser worker and separate evidence.
All jobs are required; their original journey and suite deadlines remain in place.
Native update file preparation uses a separately bounded fixture before visible
onboarding and approval begin. It records candidate/install timings and forwards
cancellation without starting a backend or engine. The update journey retains its
six-minute limit and the whole suite retains its ten-minute limit.
Uninstall and idle-engine removal run in a separate dependent Apple Silicon job,
using that same tested payload. `npm run verify:artifact` checks its clean commit,
version, platform, byte count and SHA-256 against the consumer's source checkout
before installation. Every native job must pass. The baseline job retains its
45-minute limit; consumer jobs have separate 35-minute limits and always upload
their handoff and acceptance evidence.
This validation installs no real login service and uses no live provider.

Linux concurrent uninstall acceptance runs in its own 30-minute job after baseline
payload acceptance. It verifies the downloaded producer artifact against the exact
checkout before running both complete journeys. `CI passed` and manual bootstrap
assembly require this job as well as the baseline. The existing 20-minute runner,
nine-minute maintenance and 90-second cleanup bounds remain unchanged.
