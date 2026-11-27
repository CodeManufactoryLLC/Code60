# Automation

Backend-owned scheduler runtime. Depend only on core, contracts and platform,
through their public indexes. Never import application or gateway or expose a TCP listener.

- Serialize mutations and persist occurrence claims before any action launch.
- Never replay uncertain prompt work, retry skipped/failed occurrences or accumulate a backlog.
- Enforce per-action concurrency lanes and per-resource mutual exclusion (`repo:<dev>:<ino>`), holding slots until terminal execution state.
- Built-in `prompt` actions use mandatory worktrees, explicit saved deny-by-default policy, one headless
  turn, optional read-only `code60-code` codebase search tools bound to the pinned repository (with
  structured read-only permission approval), no external MCP servers, no implicit memory and no
  automatic worktree cleanup by the prompt executor itself. Gateway-hosted Core Heartbeat runs
  separately in its own bounded state store, inspects scheduler health/drift, may trigger verified
  `resolveBlock` after orphan confirmation, and applies distinct low-disk hysteresis without
  consuming the 5,000-entry user execution cap or bypassing manual `pausedAll`.
- Gateway-injected action handlers (such as `workflow`) register through `startSchedulerRuntime` without importing `application` here; unregistered handlers fail closed (`handler_unavailable`).
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
