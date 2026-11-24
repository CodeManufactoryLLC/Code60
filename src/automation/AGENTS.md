# Automation

Backend-owned scheduler runtime. Depend only on core, contracts and platform,
through their public indexes. Never import application or gateway or expose a TCP listener.

- Serialize mutations and persist occurrence claims before any agent launch.
- Never replay uncertain work, retry failed runs or accumulate a backlog.
- Use mandatory worktrees, explicit saved deny-by-default policy, one headless
  turn, no MCP, no implicit memory and no automatic worktree cleanup.
- Pin repository and provider identities. Treat missing/unsafe state as recovery,
  never permission to erase history or displace a live/unverifiable writer.
- Bound storage reads, protocol frames, clients and notices. Keep diagnostics
  fixed and free of paths, prompts, tokens and provider output.
- Service installation requires explicit consent. Browser closure and interactive Stop all must not
  terminate scheduler-owned work; backend shutdown must stop it. Tests use fake agents and injected clocks.
- Scheduler registration status is read-only: validate installed flags and native
  definition presence; installed:false markers never imply installation. Return
  typed native runtime state and optional live status. Unverifiable registration
  fails visibly without repairing/deleting metadata or starting a service.
- An uninstall idle reservation shares the scheduler's claim queue. Refuse active,
  unfinished or uncertain ownership without cancelling execution. Fence ticks and
  mutations until release or shutdown; keep saved schedules and pause state intact.
  Releasing an older reservation must never release a later one.
