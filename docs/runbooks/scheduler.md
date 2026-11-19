# Scheduler installation and recovery

## Symptoms

Scheduled Jobs reports unavailable, the service does not restart after an update,
future runs are paused, or unfinished work blocks launches. Desktop quit and
Stop all do not stop service-owned automations.

## Read-only diagnosis

Open Apps → System Manager and refresh service status. Inspect installation,
connectivity, pause state, active execution and block independently. Open
Scheduled Jobs to review saved schedules and execution history. An unreachable
service is not proof that it has stopped; preserve that failure.

Check that the installed runtime exists and that the user is logged in and awake.
The per-user manager is launchd on macOS or systemd without linger on Linux.
Inspect it read-only if necessary. Never start a competing standalone scheduler.

## Supported recovery, only after consent

1. In System Manager, pause future work and cancel active work only after explaining
   the interruption. Wait for cleanup to settle and review Scheduled Jobs history.
2. Use Install for a missing registration or Repair for a stale runtime, accepting
   the native background-execution confirmation only with explicit approval.
   Repair can refuse blocked ownership or cleanup; do not bypass the refusal.
3. For an unfinished-agent block, establish that recorded owned processes are gone,
   then use Recheck. Live or unverifiable ownership must remain blocked.
4. Fix underlying storage before stopping and starting the service through Service
   options to clear a persistence-failure latch. If cleanup refuses, escalate.
5. Review history and repository/provider identities before resuming schedules.
   Resume enables future occurrences only; never use Run now to replay uncertain work.

## Verify

Refresh System Manager and Scheduled Jobs. Confirm connectivity, expected pause state,
no block, future run times, and no duplicate/uncertain executions. Preserve worktrees
and history. Installation checks do not prove a real provider run succeeded.

## Stop and escalate

Stop on malformed or unsafe storage, changed repository/provider identity,
unavailable service managers, unverifiable ownership or failed cleanup. Preserve
state and evidence. Never delete locks, edit claims, erase records, replay interrupted
work or repeat install loops. See [low disk](low-disk.md) for storage pressure.
