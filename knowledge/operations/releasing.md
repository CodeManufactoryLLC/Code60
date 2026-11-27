---
id: KB-OPS-013
title: Releasing Code60
domain: operations
kind: runbook
status: active
summary: Release preparation checklist, tag-and-dispatch validation workflow, native and Linux acceptance gates, and Docker Hub publishing.
updated: 2026-11-27
code_refs:
  - .github/workflows/release.yml
  - .github/workflows/native-tests.yml
  - .github/workflows/publish-docker.yml
  - scripts/verify-artifact-handoff.mjs
related:
  - KB-OPS-007
  - KB-OPS-008
  - KB-OPS-009
  - KB-OPS-010
  - KB-OPS-011
  - KB-OPS-012
tags:
  - release
  - distribution
  - ci
  - docker
---

# Releasing Code60

Code60 ships a Node 24 npm tarball alongside private platform payloads (`darwin-arm64`, `linux-x64`), a builtins-only bootstrap, and an optional `linux/amd64` Docker image. Managed installations support explicit terminal update and recovery; no native installer, bundled Node runtime, or background updater is shipped. Publishing remains an explicit release action; see [update behavior](distribution/updates.md).

## Prepare a release

1. Create a release-preparation branch from `main`.
2. Run `npm version <major|minor|patch> --no-git-tag-version` (or prerelease bump) and commit `package.json` and `package-lock.json` together.
3. Audit the [FAQ](../reference/faq/INDEX.md) against all user-visible changes since the previous release (supported platforms, built-in providers, CLI commands, limits, disk-space measurements, and beta notes) using the `refreshingly-simple-english` skill, and update `Applies to:` and `Last update:` metadata to match `package.json`.
4. Run `npm run check`, `npm run prepare:models`, `npm run test:browser`, `npm run package:app`, and `npm run test:packaged`. Run `npm run test:packaged:clean` on a host with a Linux Docker engine.
5. Validate the installed tarball and Node sidecars on macOS Apple Silicon and Linux `x64`. Test login-service behavior only in isolated, authorized environments; container checks do not prove native macOS compatibility.
6. Merge the release PR only after CI passes. The protected `main` branch must never be bypassed.

## Tag and dispatch release validation

Tag the merged release commit on `main` with its exact package version (`vX.Y.Z` or `vX.Y.Z-beta.N`) and push the tag only as an explicitly authorized release action. Manually dispatch `.github/workflows/release.yml` from `main` with that tag:

- **`preflight`:** Verifies tag and manifest agreement on `main` (`scripts/release/preflight.mjs`).
- **`mac`:** Runs `.github/workflows/native-tests.yml` on `macos-15` (`arm64`) with full checks, browser tests, tarball smoke, `fish` shell integration, payload smoke, setup, update, and uninstall acceptance.
- **`package`:** Runs `npm run check`, browser tests, npm tarball packaging, `test:packaged`, offline model checks, and `test:packaged:clean`, then verifies the manifest and uploads `code60-npm-package`.
- **`payload`:** Builds `linux-x64` inside the pinned Debian `amd64` dev container (`COMPOSE_BAKE=false`), runs strict Linux process-identity tests (`CODE60_REQUIRE_NATIVE_PROCESS_INSPECTION=1`), `test:payload`, `test:update`, `test:setup`, `test:installation -- --require-fish`, and clean-install `--payload`, `--managed`, `--setup`, and `--update` journeys.
- **`uninstall`:** Downloads `code60-linux-payload`, verifies artifact handoff (`npm run verify:artifact`), and runs concurrent uninstall acceptance (`npm run test:packaged:concurrent -- --uninstall`).
- **`bootstrap`:** Depends on `preflight`, `mac`, `package`, `payload`, and `uninstall`; verifies clean matching payloads (`scripts/release/verify-payloads.mjs`), builds `code60-bootstrap`, and runs `npm run test:bootstrap`.
- **`docker`:** Depends on `preflight` and `payload`; verifies artifact handoff and runs `npm run test:docker` without registry credentials.

Review all captured evidence before publishing release assets. Never publish to npm or mutate GitHub Releases during ordinary development.

## Update, uninstall, and payload gates

- **Updates:** Managed installations use `code60 update`, `code60 update status`, and `code60 update recover` (see [updates](distribution/updates.md)). Legacy npm tarball upgrades stop the backend, install the replacement tarball, repair service registration, start the backend, and re-pair without downgrading data or erasing locks.
- **Uninstall:** Managed `code60 uninstall` removes owned application resources while preserving user data and configuration (see [uninstall](distribution/uninstall.md)). Release acceptance requires the full installed golden journey, guarded process exit, standalone recovery launcher verification, and retained-data reinstall—component or smoke-only results are insufficient.
- **Payloads, installation, and setup:** Pair only clean, matching `darwin-arm64` and `linux-x64` descriptors from the same commit; see [artifacts](distribution/artifacts.md), [installation internals](distribution/installation.md), and [setup](distribution/setup.md). Real `launchd`/`systemd` login lifecycle certification remains a separate isolated release gate.

## Native and Linux workflow bounds

Workflows run natively inside Code60 Gateway using verified ACP providers and local `node:sqlite`; payloads must not contain any bundled external engine under `dist/engines/`.

- **Apple Silicon (`native-tests.yml`):** Baseline job (`45m` timeout) builds and validates `darwin-arm64`, then passes `code60-darwin-payload` to dependent `workflows` (`update`, `35m` timeout) and `uninstall` (`35m` timeout) jobs. Each consumer runs `npm run verify:artifact` against its clean checkout before installation and uploads handoff and acceptance evidence. No real login service or live provider is used.
- **Linux concurrent uninstall (`release.yml`):** Runs in its own `30m` job after `payload`, verifying the downloaded artifact against the checkout before executing two concurrent journeys within the existing 20-minute runner, 9-minute maintenance, and 90-second cleanup bounds.

## Docker Hub publishing

Pushing a `v*` release tag merged into `main` automatically triggers `.github/workflows/publish-docker.yml` to build, test, and publish the verified `linux/amd64` image to Docker Hub (`mjholliday/code60`) with SBOM and provenance attestations, gated by the `dockerhub_release` environment (which allows both `main` and `v*` tags). Manual dispatch from `main` (`push=false` for dry run, `push=true` to push) remains available as a fallback. See [Docker Hub distribution](distribution/docker.md).
