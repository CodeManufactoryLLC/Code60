# Releasing Code60

Code60 is distributed as a Node 24 npm tarball. Node and npm are prerequisites; no native installer, bundled runtime or automatic updater is shipped. Publishing remains an explicit release action.

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
assets. The bootstrap's public setup and persistent installation are not yet
implemented. Version bumps remain explicit release-preparation work.
