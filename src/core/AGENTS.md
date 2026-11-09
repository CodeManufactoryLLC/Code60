# Core

`src/core` owns runs: the scheduler, permission policy, run records, and leftover detection. Read [ARCHITECTURE.md](../../ARCHITECTURE.md) before changing it.

- Receive `agents`, `git`, the filesystem, the clock, and process checks as injected interfaces, so tests run without real agents or repositories.
- Keep core usable without the desktop app.
- In headless mode, never wait for input. Treat `ask` as deny unless a flag allows the kind.
- Never pick an ACP "always" permission option.
- Headless runs are exactly one turn. Only the desktop app (`interactive` mode) sends follow-up prompts, and only after the previous turn ended.
- Never decide from an agent's message text whether it asked a question or is done.
- Never commit to project branches, merge, push, or remove a worktree without an explicit user
  command. Desktop task snapshots may use internal refs. Applying and undoing task files
  require human action, guarded file writes and a private recovery journal.
- Mark a run `interrupted` only when its owning process is gone. Never guess a different outcome.
- Write `run.json` atomically and append to `events.jsonl`. Create both with mode `0600`.
- Stay within the non-goals in ARCHITECTURE.md. Retries, durable queues, budgets, and automatic recovery are out of scope.

- Preserve prompt dispatch timestamps and record actual turn completion before persistence/cleanup. Optional turnEnd outcome/completedAt and terminal status turn/completedAt metadata distinguish timeout, cancellation and transport failure without changing CLI outcomes. Keep older events readable; never infer successful completion after a crash.

- The search summary helper runs one evidence-only ACP turn through injected agents, with denied permission requests, bounded text and timeout, and unconditional process/listener/timer cleanup. It never creates run records or worktrees.

- Run preparation/recovery may accept an already resolved configuration from desktop so it can enforce enabled-provider policy. Without that explicit argument, retain the existing headless config loading and defaults; core must not depend on desktop preferences or setup state.

- Diff preparation owns run validation and interrupted-run reconciliation; diff execution accepts a prepared worktree/base and optional abort signal without mutating run records. Keep `diffRun` as the CLI-compatible composition.

- The internal requireIsolation preparation option rejects direct-folder fallback before records or agents are created. CLI defaults stay unchanged. Optional desktop history composition retains both stores without migration or schema changes.
