# Desktop

- Chat review persistence belongs in the focused review store beside the private workspace,
  never SQLite or run records. Capture Git outside the control queue through bounded reads.
  Validate revisions and anchors in the main process. Pending review feedback uses conversation
  delivery, pauses with Chat, and requires explicit retry after restart or failure. Reconnecting
  a saved review does not restore worker-control authority.

`src/desktop` is the Electron main process: the window, native dialogs, IPC handlers, and the `DesktopController` that owns one workspace and multiple independent run batches. Read [ARCHITECTURE.md](../../ARCHITECTURE.md) before changing it.

- Depend only on `core`, `bridge`, and the Node-only `platform` leaf. Only this module imports `electron`.
- Keep the renderer sandboxed: context isolation on, Node.js integration off, navigation and new windows blocked.
- Keep `preload.cts` self-contained and expose only fixed methods. Never expose `ipcRenderer` or raw channels.
- Check the sender of every IPC request and parse its arguments with `bridge` before acting. Act only on runs recorded in the open workspace.
- Serialize user actions and completion history refreshes in the controller. Allow overlapping batches, each with its own selected parallel limit, orchestrator, and subscriptions. Route actions and approvals to the owning batch, and retain earlier transcripts when adding sessions.
- Refuse folder and database switches until every batch has ended. Stop all and every shutdown path, including forced shutdown, must stop every batch.
- Return only newly created session IDs from start. Require Git readiness on every project launch and continuation, with required isolation during core preparation. Never continue legacy non-isolated workers. Keep Chat and read-only history usable before Git setup.
- Ask with a native dialog before destructive actions and before quitting with active runs. Reject unisolated project workers; guided Git setup uses its own explicit initial-commit confirmation.
- On quit, signals, and renderer crashes, shut down every run through `core` and wait for it before exiting. Never remove worktrees automatically.
- Keep the project database (`projects.ts`) to repository paths, open times, saved run configurations (name, batch settings, use count, last use), and validated prompt template edits. Never store user task prompts or transcripts in it, never modify a database that is not a Code60 database, and never recreate a missing one silently. Load `node:sqlite` lazily; Node.js 22.12 has it only behind a flag.
- Route every repeated external read (run history, config, run configurations, worktrees) through the `Poller` in `poller.ts`. Keep reads single-flight, discard results after a workspace or database switch, keep worktree scans outside the exclusive queue, and stop the poller on shutdown. Never poll agent events or watch files. Persist only user overrides under `polling` in desktop.json.
- Do not use top-level `await` in `main.ts`; Electron automation needs the module to finish loading.

- On successful database open or startup reconnection, ensure `.code60_workspace` exists beside the SQLite file, with mode `0700` for a newly created directory. Preserve existing directory contents. Validate the database before creating the directory and surface filesystem conflicts through the database connection error path.

- Own the agent setup transaction in the main process. Require versioned verified setup for every installation; legacy providers do not unlock entry. Atomically persist primary, enabled providers and command identity hashes only on Finish. Keep ACP probes single-flight, cancellable, bounded to 15 seconds and rooted in private temporary directories independent of any database. Send no prompts and create no runs/transcripts/worktrees. Stop the process before directory removal. Ignore stale results on cancellation, config changes, renderer loss/reload and shutdown. Refresh executable discovery on retries; npx alone is not provider detection. Never install provider CLIs or store credentials.

- Own multiple independent orchestration Chat sessions, each rooted in a generated private subfolder of `.code60_workspace` beside the database. Start an initial chat automatically only once verified setup/provider/database are available; New chat adds a session without stopping existing ones. Reuse all chats and selection across renderer reloads and project switches, and replace all on provider/command/database changes. Retry replaces only its target chat. Use core for run records, streaming, once-only allow-all permissions, cancellation and process cleanup. Chat actions are the explicit exception to the open-project run rule: accept only IDs of existing orchestration runs, and never accept a workspace path. Keep each chat's event stream separate from project events; stop every chat on Stop all and every shutdown path.

- Expose worker dispatch and control only through the chat's authenticated MCP gateway. Validate arguments, require the current project/chat scope for mutations, and act only on workers created by that chat in the open project. Never pass the gateway to workers. Keep ownership and request-ID deduplication in memory, enforce `maxParallel` including idle workers, and preserve normal worktree and leftover-process safeguards.
- Deliver bounded worker turn-end/failure updates only between orchestration turns, with automatic prompt origin. Stop and Stop all pause automatic updates; user send or Resume updates unpauses them. Revoke the gateway on chat replacement and clear update timers on shutdown.

- Include current-project worker IDs owned by each chat generation in every chat snapshot. Renderer aggregate activity must not derive ownership from the global list or process existence. Preserve Windows process/job support and sandbox boundaries.

- Search overview helpers are the dedicated UI-requested exception to chat-gateway worker dispatch: validate current-project saved evidence, gather bounded project documentation/code through the Files reader when enabled, and use the configured provider in a generated temporary directory, with no gateway, run records, worktrees or chat entries. Deny permissions; bound input, output and total runtime. Serialize replacement, stop on scope/provider changes, renderer reload, Stop all and shutdown, and remove the temporary directory only after process cleanup. Return the exact evidence used for numbered citations; never accept arbitrary file paths through the summary endpoint.

- Enforce enabled membership and unchanged verified command identities in snapshots, desktop launch/recovery, saved configurations and MCP worker tools. Headless CLI behavior stays unchanged. Settings add transactions preserve primary and live chats; primary changes require active work to finish or stop. Keep existing settings until commit.

- Diff preparation is serialized with lifecycle mutations; expensive reads run through DiffReads outside the action queue, with at most two in flight. Cancel reads on context replacement, renderer reload and shutdown, and settle a run's reads before discard. Queued preparation cancellation must not deadlock the control queue.
- ConversationCoordinator owns in-memory conversation authority, dispatch deduplication and between-turn delivery. Keep process creation/shutdown and IPC in DesktopController; preserve scope checks and pause semantics through coordinator calls.

- GitSetup owns project/session/file identities and single-flight cancellation. Run setup outside the action queue after checking stopped workers/leftovers; preserve partial state and probe HEAD after uncertain commits. Never replay dispatch. Cancel on context replacement, renderer reload and shutdown. Desktop history includes legacy directory records and routes writes to their original store.
