# Git

- Structured review snapshots may write temporary trees/blobs with a private index, never
  commits or refs. Read blobs by validated object IDs with per-file and aggregate bounds;
  distinguish binary, oversized, symlink and submodule content. Preserve raw CLI diff behavior.

`src/git` wraps the `git` executable for worktrees, diffs, and status. Read [ARCHITECTURE.md](../../ARCHITECTURE.md) before changing it.

- Do not import `core` or `agents`.
- Run `git` with argument arrays, an explicit working directory, and a timeout. Never build shell strings.
- Touch only worktrees and `code60/<run-id>` branches that the tool created.
- Never merge, push, rebase, or prune. The explicit human-confirmed guided initial commit is the only application-created commit allowed; use normal Git operations, preserving hooks, signing and unrelated staged entries.
- Return structured results and errors. Do not print.

- Pass optional diff cancellation through every temporary-index Git command. Wait for subprocess completion before removing its temporary index, and never alter the real index. Preserve default command timeouts for callers without cancellation.

- Setup mutations use owned process trees so cancelling a commit stops its hooks/signers too. Never remove repository locks or roll back partial initialization/staging automatically. The default CLI subprocess behavior is unchanged.
