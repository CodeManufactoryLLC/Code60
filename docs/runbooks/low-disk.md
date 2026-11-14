# Low disk space

## Symptoms

Automation history reports `low_disk`, new dispatch pauses, persistence fails,
or desktop history/diagnostics cannot save. Repository worktree launches reject
less than 2 GiB available, but that threshold is not a capacity guarantee.

## Read-only diagnosis

Check free space on the repository, HOME/XDG state and temporary/build volumes
using the OS storage viewer (or `df -h` on macOS/Linux). These may be different
volumes. Inspect scheduler status/history using the
[scheduler runbook](scheduler.md). Note whether failure is disk, permissions,
unsafe identity or process ownership; free space does not repair all four.

## Supported recovery, only after consent

- Stop starting new agents, image builds, model downloads and packaging.
- Ask permission to pause future scheduled work. Desktop Stop all/quit does not
  stop service-owned execution. Cancel active work only after explaining it.
- Remove only identified disposable output owned by this task and no longer
  needed. Get explicit authorization before removing any other user's data.
  Preserve evidence required to diagnose failed/uncertain runs.
- Do not delete `node_modules`, package/BuildKit caches, other worktrees,
  databases, transcripts, Relay history or locks as a quick repair. Never use
  global Docker prune. The desktop container runner removes only its own
  container and exported image; retain its host artifacts.
- After restoring ample headroom on every affected volume, handle any
  persistence latch through supported restart/recheck procedures, then obtain
  approval before resuming future schedules.

## Verify

Recheck free space on each volume, scheduler pause/block/history and desktop
history-saving status. Confirm existing checkout/index and worker evidence are
unchanged. A successful read is not proof that saving recovered; verify a
user-authorized synthetic operation before declaring write health restored.
Do not replay a failed/uncertain task to test storage.

## Stop and escalate

If space cannot be recovered from owned disposable output, use another machine
or ask the user to choose what to move/delete. Stop on identity/ownership errors
or continuing persistence failures. Never trade user data for a passing check.
