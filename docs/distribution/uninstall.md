# Uninstall and recovery

The private distribution candidate implements state-preserving uninstall.
Packages remain unpublished; native login-service certification is a separate
release gate.

## Remove the managed application

Run `code60 uninstall` in a local terminal. It inspects owned installation and
backend state, refuses active or uncertain work, then asks before stopping/removing
the backend and application files. Without a terminal, provide Code60's trailing
`--yes` explicitly. There is no purge option.

Shell-profile removal has a separate exact preview and interactive approval.
`--yes` never approves profile edits. Changed or ambiguous blocks remain for manual
inspection; a partially completed profile edit is reported without undoing other
changes. The command cannot change its parent terminal's PATH.

Only receipted releases, activation support and the owned launcher are removed.
Databases, configuration, run records, engine caches/evidence and Git worktrees
remain. Unrelated global/npm commands and replaced launchers stay untouched.
`code60 service uninstall` continues to remove only the backend registration.

## Interrupted removal

Before deleting application files, the command prints a shell-quoted absolute
recovery command. Keep it: the standalone launcher under `removals/<attempt>`
works even after the installed entrypoint or npm/bootstrap cache is gone. Run the
printed command exactly as shown; it includes `uninstall --yes` and resumes only
the recorded remainder.
It uses the original installation/service scope even from another directory or
with changed HOME/XDG values.

Changed files, registration, current pointers or uncertain locks stop cleanup.
Preserve them and inspect the reported scope; never erase locks or kill an
unverified PID to force progress. A cleanup failure is still a failure after
application deletion, and keeps completed receipts and recovery support.

## Reinstall

Finish an interrupted removal before reinstalling. Normal setup validates retained
ownership and database selection, then reuses healthy retained data. It never
replays uncertain work or replaces a damaged/custom database automatically. An old
recovery attempt refuses a later installation. Real launchd/systemd login lifecycle
certification remains a separate native release gate.

## Acceptance evidence

The clean-install `--uninstall` mode drives a full installed first-use journey
before removal, then checks original process exit, exact owned file removal,
retained SQLite/configuration/Git contents, repeated recovery and same-artifact
reinstall. Application files remain read-only during the browser journey; a
separately inspected maintenance customer owns the writable removal operation.
`npm run test:uninstall` supplies native installed/launcher/browser coverage through
the isolated supervisor fixture. `npm run test:installation` additionally exercises
real shell startup before and after separately consented profile removal.
These tests do not establish native login/reboot lifecycle behavior.
Installed CLI commands share the caller's finite journey deadline: twenty minutes
for native acceptance and nine minutes for Linux maintenance. Full receipt scans
retain every ownership check; there is no shorter nested command deadline.
`uninstall-commands.jsonl` retains synthetic command timings and failure diagnostics.
Linux concurrent acceptance runs two complete installed journeys and independently
verifies the survivor's exact backend identity and usable assets after the first
run removes its resources. Both runs must finish their shutdown, negative fault
checks and run-owned cleanup. Cleanup is verified on each Docker engine used;
success elsewhere cannot resolve an unavailable engine's resource inventory.
Fresh browser tabs reopen the retained project through its existing history after
reinstall; they do not inherit a previous tab's presentation state. Acceptance checks provider
request counts to detect repeated work without logging prompt contents.
