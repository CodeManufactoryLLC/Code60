# Recovery runbooks

Preserve evidence and identify ownership before changing anything. Use Automations for schedules and execution history, and Apps → System Manager for service status and recovery. Use the affected user account and normal HOME/XDG settings. Do not build during disk pressure just to diagnose an installation.

- [Scheduler installation and recovery](scheduler.md)
- [Low disk space](low-disk.md)
- [Diagnostic storage unavailable](diagnostics.md)
- [Damaged Relay history](relay-history.md)

Recovery is not permission to delete history, locks, databases or worktrees.
Stop and escalate when ownership, storage identity or safety cannot be verified.
Use private support for sensitive evidence. Share version, platform, fixed error
category and redacted reproduction steps first, never raw prompts, credentials
or transcripts. Capture only the minimum diagnostics the user authorizes.
