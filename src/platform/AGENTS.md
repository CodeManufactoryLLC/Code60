# Platform

Node-only leaf module for native process ownership, executable resolution, path
identity and private storage. Import no application modules or Electron. Export
through `index.ts`. Bridge, renderer and contracts must never import this module.

- Payload archive, descriptor and acquisition implementations are shared source
  ES modules, consumed by both the installed runtime and independent host tools.
  Keep them Node-only, include them in both builds and validate them with the same
  archive attack tests. Registry bootstrap metadata is data, never executable
  update logic. Production registry/release origins have no public override.
  When payload metadata declares directories, verify the complete unique list
  against actual extracted directory entries. Preserve acceptance of older
  descriptors without that field; never infer ownership of additional empty dirs.

- Never use blanket `shell: true` or unverified PID kills.
- Native Transmission process adoption follows supported engine targets: macOS
  Apple Silicon and Linux x64. Verify the canonical Node text mapping, exact argv, UID and
  stable start identity. macOS uses fixed system inspection commands; Linux uses
  bounded kernel procfs reads, exact NUL-separated argv, executable device/inode
  and boot/start ticks. All four UID fields must match for attributed processes
  and descendants. Unrelated mixed-UID services do not become family members;
  file-holder enumeration covers the caller's effective UID and refuses mixed
  credentials within that scope. Permission or identity uncertainty refuses removal;
  do not fall back to argv alone under emulation. Return hashes,
  never raw argv. Portable PID-existence/exit checks do not establish ownership;
  callers must first prove it through their service, gateway or owned-child boundary.
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

## MCP secure authentication (phase 6)

Phase 6 supersedes earlier deferred credential/OAuth text. Follow the MCP credential
and authorization ownership section in ARCHITECTURE.md. Keep secrets in the backend
native store or explicitly selected temporary RAM, never configuration, diagnostics,
records, browser storage or provider setup. Native keyring loading is platform-only,
in a bounded private-pipe helper; Linux must explicitly use Secret Service. Gateway
owns callback/private listener lifetimes; application owns page/revision/issuer/
resource/grant fences and injected transports. No application-to-agents edge.

OAuth uses reviewed registration, S256 and single-use five-minute callbacks. Keep
SDK authentication/replay disabled; a grant has one refresh, and uncertain exchanges
require explicit authorization. Revoke before cleanup/deletion, preserve tombstones
and unresolved ownership, and never reactivate old credential heads. Temporary
storage requires explicit consent and survives only until backend restart/sign-out.
Credential writes/forget/sign-out are narrow human operations with safe metadata;
there is no browser secret-read endpoint. Preserve existing JSON drafts/recovery.
Dedicated integrations, Code60 registrations/hosted auth and recovery GUI stay out.


Phase 7 preserves structured native startup codes in the backend error cause so
agents can classify failures without parsing paths/messages. Never serialize that
cause to browser status/reports. Application cleanup verification retries only
retained revoked handles; native process-group ownership rules remain unchanged.

Network policy failures carry only allowlisted native error codes for phase 7
network/TLS/deadline guidance; discard raw causes and payloads. Protocol consumers
must not infer authority or retry from these codes. Keep DNS/socket/redirect and
HTTPS policy unchanged.

- Installation ownership uses its dedicated non-reclaiming lock. Do not reuse
  lockPrivateState's stale-owner cleanup for distribution. Preserve uncertain
  locks and possibly published activations. Validate private receipts, directory
  containment and file identities; never repair by chmod/chown or sudo.
  Removal may coordinate with backend service operations only through the
  compatible private-state lock with reclaimStale:false. Never use its default
  stale-writer reclamation as distribution ownership. Release checks pin both
  the lock directory and unique owner-file identities; preserve changed locks.
  Removal callers must establish receipt ownership before capturing an inventory.
  Compare the complete remainder before deletion, then recheck each entry and its
  parent identities. Missing entries may represent prior cleanup; new or changed
  contents never become owned just because they are in a managed directory.
  Removal service proofs retain the original runtime, private registration file
  identity and observed PID set. Under the compatible operation lock, recheck
  installed:false, native absence and process exit before file cleanup. Proofs
  authorize no termination, registration repair or new environment-selected scope.
  Cleanup must also hold the original gateway runtime writer with reclaimStale:false,
  preventing a direct foreground backend from starting during deletion. Preserve
  any existing/uncertain writer; never treat service absence alone as runtime ownership.
  File publication keeps its ordinary 1 MiB bound. Large private removal receipts
  must request the explicit bounded limit (at most 64 MiB), including CAS reads
  and the final identity snapshot; reject oversized content before publication.

- Transmission bundle storage is a Node-only filesystem boundary. Validate exact
  supported artifact identities and the complete regular-file inventory before
  publication or launch. Version bindings and canonical Node are immutable; keep
  published engines separate from application activation and workflow state.
  Never acquire dependencies, compile helpers, reclaim uncertain locks or start
  engines during inspection. Remove only verified staging owned by the attempt.

- `index.bootstrap.ts` is the Node-only distribution variant of the public index.
  Keep its installation/removal-recovery closure free of credential schemas, native keyring
  loading and application initialization. The distribution compiler selects it
  via module suffixes and publishes it as index.js; retain closure verification.
