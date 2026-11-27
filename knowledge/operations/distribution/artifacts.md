---
id: KB-OPS-007
title: Distribution Artifacts and Bootstrap Packaging
domain: operations
kind: reference
status: active
summary: Build, verify, and accept unpublished platform payloads and the builtins-only npm bootstrap.
updated: 2026-11-27
code_refs:
  - scripts/package-payload.mjs
  - scripts/package-bootstrap.mjs
  - src/platform/payload-acquire.mjs
  - src/platform/payload-archive.mjs
related:
  - KB-OPS-008
  - KB-OPS-009
tags:
  - distribution
  - packaging
  - bootstrap
  - artifacts
---

# Distribution Artifacts and Bootstrap Packaging

These commands build unpublished release candidates used by the [managed installer](installation.md) and [setup flow](setup.md). The source package and generated bootstrap remain private; never publish or tag as part of contributor acceptance.

Workflows run natively inside Code60 Gateway using verified ACP providers and local `node:sqlite`; payloads ship no external workflow engine bundle or provider binary.

## Build candidates

Use Node `>=24.22.0 <25`, npm, and Git. Prepare dependencies with `ONNXRUNTIME_NODE_INSTALL=skip npm ci` and pinned models with `npm run prepare:models`. Build macOS `arm64` payloads on Apple Silicon, and Linux `x64` payloads in the pinned Debian `amd64` development container:

```sh
npm run devcontainer -- up
npm run devcontainer -- exec npm ci
npm run devcontainer -- exec npm run prepare:models
npm run devcontainer -- exec npm run package:payload
npm run devcontainer -- exec npm run test:payload
npm run test:packaged:clean -- --payload release/payloads/linux-x64.json
npm run devcontainer -- down
```

On native macOS, run `npm run package:payload` followed by `npm run test:payload`. Native smoke uses isolated state and a foreground backend without installing or inspecting the user's login service. Required CPU/image libraries are verified with an image decode and an offline 768-dimensional embedding. Linux requires `glibc` and `libgomp1`; Alpine/musl and Linux `arm64` are unsupported.

The builder installs a fresh locked production tree with scripts disabled, without copying host dependencies. Build-time npm access is permitted; extraction and runtime acceptance perform no npm resolution, lifecycle scripts, or compilation. Payloads include compiled assets, models, production notices, provenance, and a full directory inventory (including empty platform placeholders) so uninstall distinguishes owned empty directories from outside additions. Older descriptors without that optional field remain verifiable; unproven directories are preserved during removal. Foreign ONNX platform binaries and cache directories are excluded.

Each target produces `release/payloads/<os>-<arch>.json` and a versioned `.tar.gz`. Collect both targets' descriptors and archives into one directory, then assemble and test the bootstrap:

```sh
npm run package:bootstrap -- release/payloads
npm run test:bootstrap
```

Both descriptors must agree on version, commit, and dirty provenance; archive sizes and SHA-256 digests are verified before packing. Output goes under `release/bootstrap`, separately from the legacy npm tarball under `release/build`. The bootstrap remains dependency-free and under 1 MiB, with no production URL override, install hooks, or publishing action. Its staging library selects only an embedded platform descriptor; see [setup behavior](setup.md) for CLI consent semantics.

## Integrity and extraction

Descriptors pin canonical GitHub Release URLs, byte counts, and SHA-256 digests. The bootstrap's embedded descriptor is the integrity anchor, not a mutable release listing. Production transport follows at most five HTTPS redirects to GitHub's approved asset hosts, with no URL environment variable or CLI override (local artifact serving is injected only through test ports).

Downloads are bounded to 5 minutes and 2 GiB. Extraction supports USTAR/per-entry PAX archives, validates the full inventory before writing, and enforces limits of 8 GiB expanded data, 200,000 entries, and 4,096-byte paths. It rejects unsafe paths, escaping or cyclic links, entries under links, hard links, special files, privileged modes, duplicates, and malformed or truncated archives. Internal symlinks are created after regular files. Provenance, inventory hashes, lockfile identity, and required assets are verified before returning owned staging without mutating any active installation.

## Acceptance, ownership, and cleanup

The legacy `npm run test:packaged:clean` command remains independent. Its `--payload` mode reuses customer/driver isolation, the full first-use golden journey, `Host`/`Origin` checks, pairing controls, model probes, fault detection, and process cleanup. Extraction runs with external networking disabled, using a fixture server in the extracting container's loopback namespace. Fake provider scripts are added only to test installations after verification.

Follow shared-host isolation rules (one worktree per task; never inspect or touch another task's containers, processes, or state). Retain per-run evidence and ownership labels (`test-results/payload` for native smoke, `test-results/clean-install` for Docker). Remove only owned staging, containers, exported images, and temporary volumes, including after failure; keep BuildKit/dependency caches and never prune globally or delete locks/history. Failed staging cleanup reports its owned path and fails acceptance.

PR CI selects Linux payload and native Apple Silicon checks via `scripts/ci-impact.mjs`. CI scopes `COMPOSE_BAKE=false` to its disposable Linux payload job so Compose 2.x uses its classic builder with the Dev Container CLI's temporary Dockerfile without altering host Docker settings. The PR payload job checks out the exact PR head commit to match the manual native workflow's source identity; manual release generation verifies both targets against the clean selected commit and uploads workflow artifacts only.
