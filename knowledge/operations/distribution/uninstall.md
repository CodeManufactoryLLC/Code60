---
id: KB-OPS-011
title: Uninstall and Recovery
domain: operations
kind: runbook
status: active
summary: Remove managed Code60 installations safely while preserving user data, recover interrupted removals, and reinstall cleanly.
updated: 2026-11-27
code_refs:
  - src/management/uninstall.ts
  - src/management/uninstall-plan.ts
  - src/management/removal-state.ts
related:
  - KB-OPS-008
  - KB-OPS-009
  - KB-OPS-010
tags:
  - distribution
  - uninstall
  - recovery
  - cli
---

# Uninstall and Recovery

Managed installations support state-preserving uninstall via `code60 uninstall`. Packages remain unpublished; native login-service certification is a separate release gate.

## Remove the managed application

Run `code60 uninstall` in a local terminal. It inspects owned installation and backend state, refuses removal if active or uncertain work is detected, and asks before stopping and removing the backend and application files. Without a terminal, pass Code60's trailing `--yes` explicitly. There is no purge option.

Shell-profile removal uses a separate exact preview and interactive approval; `--yes` never approves profile edits. Changed or ambiguous blocks remain untouched for manual inspection, and partial completion is reported without reverting unrelated edits. Uninstall cannot modify its parent terminal's `PATH`.

Only receipted releases, activation support, and the owned launcher are deleted. Databases, configuration, run records, and Git worktrees remain intact, as do unrelated global/npm commands and replaced launchers. `code60 service uninstall` continues to remove only the backend service registration.

## Interrupted removal

Before deleting any application files, `code60 uninstall` prints a shell-quoted absolute recovery command. Keep it: the standalone launcher under `removals/<attempt>` works even after the installed entrypoint or npm/bootstrap cache is deleted. Run the printed command verbatim; it includes `uninstall --yes`, resumes only the recorded remainder, and uses the original installation/service scope even from another directory or with changed `HOME`/`XDG_*` values.

Changed files, registrations, `current` pointers, or uncertain locks halt cleanup. Preserve them and inspect the reported scope—never erase locks or kill an unverified PID to force progress. Cleanup failures remain errors even after application deletion finishes, preserving completed receipts and recovery support.

## Reinstall

Complete any interrupted removal before reinstalling. Standard `code60 setup` validates retained ownership and database selection, then reuses healthy retained data without replaying uncertain work or replacing damaged/custom databases automatically. A completed recovery launcher refuses any later installation. Real `launchd`/`systemd` login lifecycle certification remains a separate native release gate.

## Acceptance evidence

The clean-install `--uninstall` mode runs a full installed first-use journey, then verifies guarded process exit, exact owned file deletion, retained SQLite/configuration/Git contents, repeated recovery, and same-artifact reinstall. Application trees stay read-only during the browser journey; a separately inspected maintenance container owns writable removal. `npm run test:uninstall` covers native installed/launcher/browser behavior through the isolated supervisor fixture, and `npm run test:installation` exercises real Bash/zsh/fish startup before and after separately consented profile removal.

Linux process and file-holder verification uses kernel `procfs` for executable, `argv`, UID, start identity, and open-handle checks—restricted permissions or unverifiable emulator mappings remain explicit refusals, never an `argv`-only fallback. Native Linux containers run process tests in strict mode before payload acceptance; host unit tests explicitly report blocked file-holder coverage when Linux denies same-user descriptor inspection.

Installed CLI commands share the caller's finite journey deadline (20 minutes native, 9 minutes Linux maintenance) without shorter nested deadlines so full receipt scans retain every ownership check; `uninstall-commands.jsonl` records synthetic timings and failure diagnostics. Linux concurrent acceptance runs two complete journeys in parallel, verifying the survivor's backend identity and assets after the first run removes its resources, and checks cleanup on each Docker engine used. After reinstall, fresh browser tabs reopen retained projects via existing history, and provider request counts confirm no repeated work without logging prompt contents.
