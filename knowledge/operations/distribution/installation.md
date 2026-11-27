---
id: KB-OPS-008
title: Managed Installation Internals
domain: operations
kind: reference
status: active
summary: Managed installation layout, atomic activation, shell profile consent, and failure or uninstall recovery internals.
updated: 2026-11-27
code_refs:
  - src/management/installation.ts
  - src/management/install-state.ts
  - src/management/installed-launcher.ts
  - src/management/shell-integration.ts
related:
  - KB-OPS-007
  - KB-OPS-009
  - KB-OPS-010
  - KB-OPS-011
tags:
  - distribution
  - installation
  - launcher
  - shell
---

# Managed Installation Internals

This layout is the sole supported managed installation format; there is no legacy migration or compatibility layer. The filesystem APIs remain internal and are composed by [setup](setup.md), [updates](updates.md), and [uninstall](uninstall.md). Installation primitives themselves do not initialize databases, verify providers, register services, or update/remove releases.

## Layout and activation

The default root is `~/.local/share/code60` (or `$XDG_DATA_HOME/code60` when `XDG_DATA_HOME` is an absolute path). It holds a private installation receipt, `.install-lock`, `.staging`, digest-keyed `releases`, immutable `activations`, and the relative `current` symlink. The durable command is `~/.local/bin/code60`, an exclusively created symlink to the owned current launcher.

Management receives verified artifact acquisition as an injected port. Staging stays on the destination filesystem, and receipt/launcher writes flush before an atomic `current`-pointer rename. Each activation generation embeds its own absolute Node and helper paths so concurrent commands execute coherently even while `current` advances. No helper depends on npm's cache; the packaged adapter exempts only its own invoking bootstrap binary from transient `PATH` conflicts so `npx` does not collide with itself.

An existing healthy matching release is reused without download, and explicit repair may replace an owned launcher or runtime binding. A different version or digest is rejected by `setup` rather than implicitly updated; only `code60 update` may transition generations through its consent and quiescence gate. Unknown receipts, unowned files, unsafe links, privileged destinations, and command conflicts fail explicitly.

Installation locks fail promptly when busy or uncertain and are never reclaimed automatically, even if the recorded PID appears gone. Only the verified owner releases its token. Before publication, cleanup removes only the attempt's inactive resources; after publication or uncertain publication, the possibly active release is preserved and failure is reported.

The launcher verifies private receipts, owned support files, payload identity, the installed CLI entrypoint, and the recorded canonical Node runtime before loading application code. It strips `NODE_OPTIONS`/`NODE_PATH` and never searches `PATH` for a replacement Node; missing or incompatible runtimes require explicit reconciliation rather than implicit repair.

## Shell preview and consent

The shell planner returns target paths, fingerprints, and only the exact proposed addition—never existing profile contents. Profile writes require an interactive terminal and explicit approval; non-interactive or declined runs print manual instructions without editing files. Each preview covers at most two files up to 1 MiB each and rechecks identity and content before atomic replacement, preserving permissions, newline style, and unrelated bytes. An installation-specific marked block and private shell receipt track ownership; modified or unknown blocks receive manual guidance.

Shell removal returns only the exact owned addition to delete. New receipts store that addition so unrelated later edits survive byte for byte; older receipts without an addition fingerprint require an unchanged whole-file hash. Removal requires separate interactive approval (service consent never authorizes profile edits), preserves post-preview edits, and reports partial completion without reverting unrelated changes.

Supported shells: Bash (first existing login profile and `.bashrc`), zsh (`.zprofile` and `.zshrc` under absolute `ZDOTDIR` or `HOME`), and fish (`$XDG_CONFIG_HOME/fish/config.fish` or default, process-global `PATH` only—never universal variables). Discovery never executes user profiles. Unsupported shells, startup redirection, symlinked/read-only/unsafe profiles, and stale previews receive manual guidance. The installed binary remains callable by absolute path; a new terminal is normally needed because a child cannot modify its parent shell's `PATH`.

## Build and acceptance

`npm run build:distribution` compiles and checks the Node-only management/platform closure packaged into the bootstrap alongside the artifact verifier and embedded descriptors (zero runtime dependencies, under 1 MiB compressed).

Run `npm run test:installation` for process-level shell and launcher fixtures (`-- --require-fish` requires Bash, zsh, and fish). Unavailable shells are reported as `BLOCKED`, never silently passed; supply `fish` in the Linux dev container or disposable native runner rather than modifying the developer's host. On the Docker host, run managed clean-install acceptance against a built Linux payload:

```sh
npm run test:packaged:clean -- --managed release/payloads/linux-x64.json
```

Managed acceptance installs outside the checkout, removes the temporary bootstrap cache, invokes both the absolute launcher and bare `code60` command, and runs the full golden journey and offline model probes with provider fixtures kept outside the immutable release. Retain `test-results/installation`, bootstrap, payload, and clean-install evidence and verify owned resource cleanup.

## Failure recovery

Use `code60 update status` to inspect a recorded update and `code60 update recover` to repair the current generation with explicit consent. Recovery retains both release generations and never downgrades databases or replays work.

Preserve failed-run evidence and uncertain locks. Inspect the installation receipt, activation pointer, and owner token before taking action; never erase a lock, delete history, prune releases, or kill an unverified PID to force progress. There is no automatic stale-lock reclamation command. Failed shell edits print manual continuation instructions and report any blocks already applied.

## Uninstall recovery internals

`code60 uninstall` publishes private recovery support under `removals/<attempt>` before deleting any application files; see [uninstall and recovery](uninstall.md). Its printed absolute recovery launcher uses the recorded Node binary and remains usable after the installed entrypoint or bootstrap cache is gone. The original `current` pointer stays intact until owned application files are removed.

Recovery verifies immutable inventory/support hashes and durable `removal.json` progress under the same non-reclaiming operation lock, rechecking the original service directory and registration identity without selecting a different state directory from a changed environment or stopping an uncertain process. Changed files and replaced links remain untouched; cleanup failures are reported even after application deletion finishes. Databases, configuration, run records, and Git worktrees are retained. Reinstall refuses unfinished cleanup, then validates completed removal and retained ownership; a completed old recovery launcher refuses any later activation.
