# Scheduler installation and recovery

## Symptoms

Scheduled Jobs reports unavailable, the service does not restart after an update,
future runs are paused, or unfinished work blocks launches. Desktop quit and
Stop all do not stop service-owned automations.

## Read-only diagnosis

Open Apps → System Manager; service status updates automatically while visible.
You can also open Manage → Heartbeat or run `code60 heartbeat status --json` to
inspect the latest scheduled maintenance sweep, drift warnings, and any
autonomous reconciliation actions.
Checks normally run two seconds after the preceding read and back off to at most
sixty seconds when unavailable. The footer's Pause polling also pauses these checks;
Resume polling or use the optional Refresh Scheduling Service icon to check again.
Inspect installation,
connectivity, pause state, active execution and block independently. Open
Scheduled Jobs to review saved schedules and execution history. An unreachable
service is not proof that it has stopped; preserve that failure.

Check that the installed runtime exists and that the user is logged in and awake.
The per-user manager is launchd on macOS or systemd without linger on Linux.
Inspect it read-only if necessary. Never start a competing standalone scheduler.

## Supported recovery, only after consent

1. For an installed Scheduling Service, use System Manager → Stop to pause future
   work, cancel active work and stop the service, only after explaining the
   interruption. There is no separate pause-and-cancel button. Wait for cleanup
   to settle and review Scheduled Jobs history. To cancel just one job (including
   on a standalone scheduler), use the job header's Stop control (the pulsing pause
   icon). Its separate disclosure chevron opens details; recurrence pause is independent.
2. Check Scheduling Service status in System Manager: Not installed offers Install,
   Stopped offers Start, and Running offers Stop. Jobs paused still means the
   service is running. Checking or Status unavailable is not proof of installation
   or stoppage; allow automatic checks to retry or use Refresh Scheduling Service.
   Use Service options → Repair for a stale runtime,
   accepting the native Scheduling Service confirmation only with explicit approval.
   Repair can refuse blocked ownership or cleanup; do not bypass the refusal.
3. For an unfinished-agent block, establish that recorded owned processes are gone,
   then use Recheck. Live or unverifiable ownership must remain blocked.
4. Fix underlying storage before stopping and starting the service through Service
   options to clear a persistence-failure latch. If cleanup refuses, escalate.
5. Review history and repository/provider identities before resuming schedules.
   Resume enables future occurrences only; never use Run now to replay uncertain work.

## Verify

After an app installation, launch the installed Code60 once. Pending update
recovery upgrades the existing registration, checks the scheduler's `appVersion`
against the running main app and restores its previous global pause state.
Packaged startup also reconciles an active older scheduler after manual
installation; it does not activate a previously stopped or uninstalled service.
Automatic recovery requires the socket responder PID to match the native manager’s service PID. Standalone or unverified processes are left untouched, as are newer or unknown versions. Concurrent recovery has one exclusive owner. AppImage registration requires the executable and every canonical parent to be owned by the user or root and not writable by group/others; move an unsafe AppImage to a protected location before retrying. A failed launchd stop requires a successful domain inventory showing that the job is absent before registration replacement.

A version mismatch, recovery block or failed restart keeps the pending restart
metadata and displays an error. Preserve that evidence and use the consented
System Manager repair path; never erase the marker to report success.

Observe updated System Manager status and refresh Scheduled Jobs if needed.
Confirm connectivity, expected pause state,
no block, future run times, and no duplicate/uncertain executions. Preserve worktrees
and history. Installation checks do not prove a real provider run succeeded.

## Stop and escalate

Stop on malformed or unsafe storage, changed repository/provider identity,
unavailable service managers, unverifiable ownership or failed cleanup. Preserve
state and evidence. Never delete locks, edit claims, erase records, replay interrupted
work or repeat install loops. See [low disk](low-disk.md) for storage pressure.
