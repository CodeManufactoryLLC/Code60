# Releasing Code60

Code60 retains its Node 24 npm tarball and builds private platform payloads plus
a small bootstrap. Managed candidates support explicit terminal update/recovery;
no native installer, bundled Node or background updater is shipped. Publishing
remains an explicit release action. See [update behavior](docs/distribution/updates.md).

## Prepare a release

1. Create a release-preparation branch from current main.
2. Run `npm version <major|minor|patch> --no-git-tag-version`. Commit package.json and package-lock.json together. This browser/runtime migration is a breaking supported-interface change; its first release requires a major bump.
3. Run `npm run check`, `npm run prepare:models`, `npm run test:browser`, `npm run package:app` and `npm run test:packaged`. Run `npm run test:packaged:clean` on a host with a Linux Docker engine; this also gates CI using the package job's exact artifact.
4. Validate the installed tarball and Node sidecars on macOS Apple Silicon and Linux x64. Test login-service behavior only in isolated, authorized environments. Container checks do not prove native macOS compatibility.
5. Merge the release PR only after CI passed. Protected main/dev branches must never be bypassed.

## Tag and publish

Tag the merged release commit on main with its exact package version. Push the tag only as an explicitly authorized release action. The manually dispatched release workflow verifies tag/manifest agreement and builds the npm tarball. Review native validation evidence before publishing its release assets. Do not publish to the npm registry as part of ordinary implementation.

## Updating an installation

Stop the backend, install the replacement tarball, repair its service registration, start the backend and pair the browser again. Preserve the old package for rollback. Never downgrade application data or erase locks/history to make an older package start.

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

## Bundled workflow validation

macOS packaging must use the committed Transmission dependency lock and its exact
staging.18/staging.20 artifacts. Review recorded engine integrities, native Codex
hash/version, Node and dependency inventory alongside the payload descriptor.
Keep native helpers from incompatible Transmission checkouts out of this build.
Linux payload validation must reject unsupported engine components.

After native packaging, run `npm run test:transmission`. The manual Apple Silicon
workflow retains its traces, screenshots, original-key/run recovery and process
cleanup evidence with the ordinary browser, setup and package checks. It uses
real pinned engines/ACP/Codex and a fake external model endpoint, with runtime
npm/npx/compiler traps. The isolated model fixture disables unrelated remote
plugin discovery; product runtime defaults are unchanged. Retain published engine
bindings and old executable caches
across app replacement; never delete workflow state to force a new runtime.
The native update journey requires the freshly built macOS payload and retains
the approved engine/worker processes through an actual managed update before
completing the original workflow and comparing its source Git state.
This validation installs no real login service and uses no live provider.
