---
id: KB-OPS-010
title: Explicit Updates and Recovery
domain: operations
kind: runbook
status: active
summary: Run guarded terminal updates, inspect update state, recover interrupted activations, and respect browser read-only authority.
updated: 2026-11-27
code_refs:
  - src/management/update.ts
  - src/management/update-state.ts
  - src/platform/update-registry.ts
  - src/renderer/updates.tsx
related:
  - KB-OPS-008
  - KB-OPS-009
  - KB-OPS-011
tags:
  - distribution
  - updates
  - recovery
  - cli
---

# Explicit Updates and Recovery

Managed installations on macOS `arm64` and Linux `x64` with Node `>=24.22.0 <25` update explicitly via `code60 update`. Packages remain unpublished until release preparation; `code60 setup` continues to reuse the matching release and refuses implicit version changes.

## Update

Run `code60 update` in a terminal. It resolves the stable bootstrap from the public npm registry using npm's [version metadata and dist fields](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md), verifies SHA-512 integrity, reads the embedded platform descriptors, and verifies the selected application payload. Downloaded bootstrap code is never executed, and there is no public alternate-registry or download URL option.

The running backend stays usable while the replacement is prepared. Before interrupting work, the CLI summarizes active interactive and scheduled work and asks for consent. Without a TTY, authorize backend changes explicitly with Code60's trailing `--yes`:

```sh
code60 update --yes
```

Declining leaves the current activation and backend running. A matching stable release is a no-op, an older stable release never triggers a downgrade, and a mismatched digest for the installed version fails as a conflict. Failed registry or payload verification never stops the running backend.

After consent, update drains owned work, stops the native backend, and independently waits for its PID to exit. It publishes one immutable activation, repairs service registration through that generation's verified launcher, and waits for authenticated readiness. Reconnect with `code60 open`. User databases, preferences, histories, and Git worktrees remain outside replacement; no database downgrade or uncertain work replay is performed.

## Inspect and recover

```sh
code60 update status
code60 update recover
```

`code60 update status` reads the installed version, activation, and private progress journal without contacting the registry, acquiring locks, repairing registrations, or starting a backend.

`code60 update recover` requires separate terminal consent (`--yes` without a TTY). It repairs the current activation's service registration and checks readiness without downloading a new release or reverting to an older version. Before publication, recovery keeps the original generation; after publication, it keeps the new generation, while prior releases and immutable receipts remain available for inspection. Automatic rollback is unsafe once a newer backend has opened user data. If an outside change restores the old pointer after recorded publication, recovery refuses service changes and preserves the conflicting pointer and journal for inspection.

Unfinished progress blocks a second update. Installation and setup locks are exclusive and never reclaimed automatically. Preserve uncertain locks, receipts, changed service definitions, or progress journals and inspect ownership before manual intervention; never erase history, remove locks, or kill an unverified PID. Failed cleanup returns an error even when activation succeeded, while retaining active files. See [installation recovery](installation.md#failure-recovery).

## Browser and authority

**Apps → Updates** (also available via **Settings → Updates**) displays the running version and these terminal commands. It makes no registry requests, downloads, or service changes. Agents receive read-only capability metadata, not replacement authority. Updating never edits shell profiles or changes provider verification.

## Validation boundaries

After building a target payload, run `npm run test:update` (or pass `-- /absolute/path/platform.json`). It uses a fresh isolated managed installation and real backends, replacing only native supervisor and artifact transport boundaries, with a scratch copy supplying a controlled newer version fixture (not release or cross-platform evidence). Evidence under `test-results/update` verifies custom-database preservation, retained activations, offline models, no-op PID continuity, and owned cleanup. In a fresh dev container, install matching Chromium explicitly with `npx --no-install playwright install chromium`.

On the Docker host, also run:

```sh
npm run test:packaged:clean -- --update release/payloads/linux-x64.json
```

This adds separate minimal customer/driver boundaries, forced offline networking, read-only release/activation mounts after handoff, the full golden journey against the updated release, and independent database, preference, Git, and process comparisons. Keep tarball, artifact-only, managed, setup, shell, and offline-model regressions independent. Fake supervisor boundaries do not certify real `launchd`/`systemd` login or reboot lifecycle behavior, which remains a separate native release gate in an authorized disposable environment.
