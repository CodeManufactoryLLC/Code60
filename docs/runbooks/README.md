# Recovery runbooks

Preserve evidence and identify ownership before changing anything. Commands here
use the installed `code60` CLI, with the same user and HOME/XDG configuration as
the affected app/service. In an already built source checkout, substitute
`node dist/cli/main.js` for `code60`. Do not build during disk pressure just to
diagnose a production installation.

- [Scheduler installation and recovery](scheduler.md)
- [Low disk space](low-disk.md)
- [Diagnostic storage unavailable](diagnostics.md)
- [Damaged Relay history](relay-history.md)

Recovery is not permission to delete history, locks, databases or worktrees.
Stop and escalate when ownership, storage identity or safety cannot be verified.
Use private support for sensitive evidence. Share version, platform, fixed error
category and redacted reproduction steps first, never raw prompts, credentials
or transcripts. Capture only the minimum diagnostics the user authorizes.
