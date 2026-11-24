# Platform

Node-only leaf module for native process ownership, executable resolution, path
identity and private storage. Import no application modules or Electron. Export
through `index.ts`. Bridge, renderer and contracts must never import this module.

- Never use blanket `shell: true` or unverified PID kills.
- Reject unsupported hosts before process launch; macOS and Linux are the only supported operating systems.
- Enforce finite startup/cleanup deadlines.
- Preserve POSIX process groups and grace periods.
- Retry failed cleanup verification without resending termination signals to
  a potentially stale process-group identifier.
- Fail closed when native identity, privacy or file containment cannot be verified.
- Guarded configuration files use bounded same-handle byte reads and full-precision
  native identities. Reject linked/foreign/writable-by-others managed paths; retain
  fixed roots across awaits. Stage exclusively, sync, recheck, rename and sync the
  directory. Recovery may sync an already-published file without repeating rename.
  Never discard a replaced temporary or claim compare-and-swap against external
  editors. Checkpoint injection is a test I/O port, not diagnostic capture.
  Check cancellation immediately before rename/unlink; once publication starts,
  finish verification/sync so application can retain a safely recordable outcome.
- Native service inspection uses bounded fixed launchd/systemd commands and reports
  running/stopped/unavailable separately. Never treat supervisor failure as stopped,
  follow service-definition symlinks or mutate registration during status reads.
- Use the diagnostic utility for best-effort credential redaction before clipping errors and bounded stderr. It is not a transcript scrubber or a PII anonymizer.

## MCP production connections (phase 5)

Phase 5 supersedes the earlier deferred-runtime guidance. Dedicated mcp.json files
are authoritative; config.json.mcpServers has no reader or migration. Application
reuses its existing store and owns resolution, private exact-revision approvals and
session/turn authority. Core's optional resource hook creates fresh per-session
resources on new/load/resume/handoff/continuity replacement; helpers and scheduler
remain excluded. Gateway owns the private capability broker and injects the agents
transport port. The pinned MCP SDK belongs only to agents. Platform owns process
groups. Providers receive fixed stdio adapter descriptors and ephemeral capabilities,
never upstream definitions or credentials. No application-to-agents dependency.

Tools only; keep ACP permissions independent of turn authority. Revoke before
cleanup; never replay uncertain calls or resume HTTP transport automatically. Tests
only initialize/discover, with page ownership and stdio launch confirmation. Enable
and approval changes affect future connections; Disconnect/Reconnect are explicit.
Reconnect requires idle and provider load/resume support, previews every affected
connector, and sends no prompt. Keep JSON drafts and existing recovery evidence.
Credential references/OAuth require authentication until phase 6. Publish safe status
and payload-free notices only. Dedicated integrations and recovery GUI stay excluded.
