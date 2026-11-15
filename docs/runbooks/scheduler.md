# Scheduler installation and recovery

## Symptoms

Automations reports unavailable, a service does not start after an update, future
runs are paused, or an unfinished agent blocks further launches. Desktop quit
and **Stop all do not stop service-owned automations**.

## Read-only diagnosis

Run with the affected user's normal HOME/XDG settings:

```sh
code60 scheduler status --json
code60 automation list --json
code60 automation history --json
```

Inspect native availability, service connectivity, pausedAll, activeExecutionId
and block separately. Registration metadata alone is not proof of a healthy
running service. If IPC is unavailable, the latter two commands may fail; retain
that failure rather than resetting storage to make them pass.

Confirm the installed runtime still exists and that the user is logged in and
the machine awake. The service is per-user launchd, Task Scheduler or systemd
without linger. Inspect the OS service manager read-only; do not create a second
standalone scheduler to compete with an existing/unverifiable writer.

## Supported recovery, only after consent

1. If the service is reachable, request permission to pause future work. To also
   cancel an active execution, separately explain that interruption:
   `code60 automation pause-all --cancel-active --json`.
   Wait until history/status show cleanup settled. Pause alone does not cancel.
2. For a missing registration, explain background execution and use
   `code60 scheduler install --yes --json` only with explicit approval.
   For an existing stale runtime registration, use
   `code60 scheduler repair --yes --json` after approval. Repair suspends active
   work first and can refuse if ownership/cleanup is blocked. It is not a
   metadata/history repair or a way around that refusal.
3. For a leftover-agent block, establish that the recorded owned processes are
   gone. With permission, `code60 automation resolve-block --json` asks the
   service to recheck. It refuses live/unverifiable leftovers. Never kill an
   unrelated PID or remove a lock to make this check succeed.
4. A persistence-failure latch requires fixing the underlying storage and a
   service restart. Request permission before `code60 scheduler stop --json`
   and `code60 scheduler start --json`; stop can refuse blocked cleanup. If it
   refuses, escalate rather than bypassing ownership checks.
5. After reviewing history and saved repository/provider identities, request
   permission before `code60 automation resume-all --json`. This enables future
   occurrences; it must not replay missed/uncertain work. Do not use Run now as
   an automatic recovery step.

## Verify

Repeat status, list and history. Check connectivity, no block, expected pause
state and future next-run times. Confirm no duplicate/uncertain execution appeared
and that worktrees/history remain intact. Installation/recovery checks do not
prove a real provider run succeeded.

## Stop and escalate

Stop on malformed/private-storage errors, changed repository/provider identity,
an unavailable native manager, live/unverifiable ownership or failed cleanup.
Preserve state, worktrees and history. Do not delete locks, edit occurrence
claims, erase run records, replay interrupted work or run install loops.
See [low disk](low-disk.md) for storage pressure.
