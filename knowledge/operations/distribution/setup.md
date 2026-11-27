---
id: KB-OPS-009
title: Setup and First Use
domain: operations
kind: runbook
status: active
summary: Managed setup consent, default database initialization, read-only status checks, failure handling, and validation boundaries.
updated: 2026-11-27
code_refs:
  - src/management/setup.ts
  - src/application/setup-database.ts
  - src/gateway/server.ts
related:
  - KB-OPS-007
  - KB-OPS-008
  - KB-OPS-010
tags:
  - distribution
  - setup
  - database
  - cli
---

# Setup and First Use

The private distribution candidate implements `code60 setup`. Public npm publication and release asset hosting are separate release actions; the intended public entry point is shown below for reference only:

```sh
npx --yes code60@latest setup
```

## Consent and continuation

`setup` checks Node `>=24.22.0 <25`, npm, Git, supported platform, and safe destinations. It installs verified application files and a durable `~/.local/bin/code60` symlink, then delegates to that launcher. Shell integration has its own exact preview and interactive approval; Code60's `--yes` never approves shell-profile edits.

Background service enrollment is opt-in and defaults to **No**. Without a TTY, pass Code60's trailing `--yes` to authorize it (npm's leading `--yes` only accepts npm's own package prompt). Declining enrollment exits `0` with an explicit **incomplete** result, installed launcher fallback, and the exact continuation command, without creating a database or opening a browser. Linux completion requires a working user `systemd` session; no `sudo` or system-wide service is installed.

```sh
~/.local/bin/code60 setup --yes --no-open
~/.local/bin/code60 status
~/.local/bin/code60 open
```

`--no-open` skips the browser opener, not readiness or database preparation. Setup prints the exact token-free loopback URL; opener failure leaves a usable URL and returns success. Existing pairing policy is preserved, and any printed single-use pairing code is never passed as a subprocess argument. A new terminal may be needed after profile edits because setup cannot modify its parent shell's `PATH`; non-interactive runs print manual `PATH` instructions only.

## Database and repeated setup

The default database path is `$XDG_DATA_HOME/code60/databases/default.sqlite` (falling back to `~/.local/share/code60/databases/default.sqlite`), with a private sibling `.code60_workspace`. Releases, activation generations, and databases live in separate trees, and the registered service preserves `XDG_DATA_HOME`.

Gateway startup and explicit setup prepare the default database when no selection exists yet. Strict preference checks distinguish no selection from damaged metadata: valid custom selections are kept, while missing, unsafe, corrupt, empty unrelated, or newer-schema files are never silently replaced or bypassed. An existing default is validated before adoption after an interruption, new defaults are staged privately without overwriting, and preparation is serialized via a private management route that accepts no caller-supplied path or browser `Origin`.

Repeated `setup` reuses healthy matching files and database selection. It does not implicitly update releases, repair uncertain registrations, verify providers, connect agents, or resume work. Provider verification and project selection still happen visibly in the browser, and manual database creation/selection remains available independently.

## Status and failures

`code60 status` outputs JSON reporting installation/runtime, service/backend, database, and `engines` metadata (`bundled: false`, as workflows run natively inside Code60 Gateway via verified ACP providers and local `node:sqlite`). Unavailable or offline components are reported explicitly. Status is strictly read-only: it never creates storage, installs or repairs services, or issues pairing codes.

Failed readiness, registration, or database preparation exits nonzero while preserving valid installed files and committed state. Inspect `code60 status` and `code60 service status` and follow the printed recovery commands. Never delete uncertain setup/installation locks, replace a database, stop an unrelated process, or blindly repeat an uncertain registration. Setup locks have unique ownership and are never reclaimed automatically. Interrupted setup preserves signal exit codes after owned cleanup without rolling back an already enrolled service.

## Validation boundaries

`npm run test:setup` exercises the installed CLI, private database preparation, files-only/repeat/restart/pairing flows, and offline models against a bounded fake backend supervisor. `npm run test:packaged:clean -- --setup release/payloads/linux-x64.json` adds the full installed browser golden journey and independent Git/process assertions, keeping release/helper trees read-only while metadata and databases are writable.

Manual-database, npm tarball, artifact-only, and managed journeys remain independent. Fake supervisor fixtures do not prove real login/reboot lifecycle behavior; native `launchd`/`systemd` certification is a separate release gate. Never install a real service, `fish`, or shell-profile edits on a developer's host to pass these checks.
