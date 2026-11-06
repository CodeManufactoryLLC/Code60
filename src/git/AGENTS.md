# Git

`src/git` wraps the `git` executable for worktrees, diffs, and status. Read [ARCHITECTURE.md](../../ARCHITECTURE.md) before changing it.

- Do not import `core` or `agents`.
- Run `git` with argument arrays, an explicit working directory, and a timeout. Never build shell strings.
- Touch only worktrees and `code60/<run-id>` branches that the tool created.
- Never commit, merge, push, rebase, or prune.
- Return structured results and errors. Do not print.
