# Git

- Structured review snapshots use a private index and bounded blob reads. Desktop task
  snapshots may retain internal commits only under `refs/code60/tasks/`; preserve HEAD,
  branches, staging and raw CLI diff behavior. Distinguish binary, oversized, symlink and
  submodule content.

`src/git` wraps the `git` executable for worktrees, diffs, and status. Read [ARCHITECTURE.md](../../ARCHITECTURE.md) before changing it.

- Do not import `core` or `agents`.
- Run `git` with argument arrays, an explicit working directory, and a timeout. Never build shell strings.
- Touch only worktrees and `code60/<run-id>` branches that the tool created.
- Never merge, push, rebase, or prune. Use normal Git operations for guided initial commits,
  preserving hooks, signing and unrelated staged entries. Internal desktop task commits are
  limited to snapshot refs.
- Return structured results and errors. Do not print.

- Pass optional diff cancellation through every temporary-index Git command. Wait for subprocess completion before removing its temporary index, and never alter the real index. Preserve default command timeouts for callers without cancellation.

- Setup mutations use owned process trees so cancelling a commit stops its hooks/signers too. Never remove repository locks or roll back partial initialization/staging automatically. The default CLI subprocess behavior is unchanged.
