# Scheduler installation and recovery

## Symptoms

Scheduled Jobs reports unavailable, the service does not restart after an update,
future runs are paused, or unfinished work blocks launches. Closing the browser or choosing Stop all in Chat leaves scheduled work running.

## Read-only diagnosis

Open Apps → System Manager to inspect Code60 Gateway status. It updates automatically while visible.
Checks normally run two seconds after the preceding read and back off to at most
sixty seconds when unavailable. The footer's Pause polling also pauses these checks;
Resume polling or choose **Refresh Code60 Gateway** from the System Manager actions menu.
Inspect installation,
connectivity, pause state, active execution and block independently. Open
Scheduled Jobs to review saved schedules and execution history. An unreachable
service is not proof that it has stopped; preserve that failure.

Check that the installed runtime exists and that the user is logged in and awake.
The per-user manager is launchd on macOS or systemd without linger on Linux.
Inspect it read-only if necessary. Never start a competing standalone scheduler.

## Supported recovery, only after consent

1. To stop one job, use its Stop control in Scheduled Jobs. To stop all interactive and scheduled work, use **Stop Code60 Gateway** in the Workspace menu or run `code60 service stop` locally. Wait for cleanup and review the execution history.
2. Inspect `code60 service status`. With explicit consent, use `code60 service install` for a fresh enrollment, `code60 service start` for a stopped Gateway, or `code60 service repair` for a stale runtime. **Jobs paused** describes the scheduler inside a running Gateway. Preserve uncertain ownership and failed cleanup for inspection.
3. For an unfinished-agent block, establish that recorded owned processes are gone,
   then use Recheck. Live or unverifiable ownership must remain blocked.
4. Fix underlying storage before using the local CLI to stop and restart the Gateway to clear a persistence-failure latch. If cleanup refuses, escalate.
5. Review history and repository/provider identities before resuming schedules.
   Resume enables future occurrences only; never use Run now to replay uncertain work.

## Verify

After installation or repair, run `code60 status` and check `gateway.installed` and `gateway.available`. For installations under the old service name, follow the [one-time cutover](../../README.md#one-time-cutover-from-backend-service). Keep the registration and scheduler handoff evidence if process ownership or restart cannot be verified.

Observe updated System Manager status and refresh Scheduled Jobs if needed.
Confirm connectivity, expected pause state,
no block, future run times, and no duplicate/uncertain executions. Preserve worktrees
and history. Installation checks do not prove a real provider run succeeded.

## Stop and escalate

Stop on malformed or unsafe storage, changed repository/provider identity,
unavailable service managers, unverifiable ownership or failed cleanup. Preserve
state and evidence. Never delete locks, edit claims, erase records, replay interrupted
work or repeat install loops. See [low disk](low-disk.md) for storage pressure.
