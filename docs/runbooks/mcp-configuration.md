# MCP configuration storage recovery

The backend library is wrapped by Apps → MCP Servers guided/JSON editing,
backup restoration and confirmed reset. Apps → MCP Servers → Configuration recovery
provides reviewed Complete/Roll back. There is no CLI recovery command. Dedicated
configuration files are described in [MCP configuration](../../MCP.md).

## Symptoms

The library reports invalid input, conflict, unsafe storage, quota exhaustion,
cancellation or recovery-required status. Reads may show malformed text or pending
transaction IDs. A missing file represents empty defaults; a malformed or oversized
file is not permission to replace it with defaults automatically.

## Read-only diagnosis

- Identify the backend-owned target and source project, not the sidebar selection
  or a generated worker worktree. Check ownership, canonical root identity, revision
  and pending recovery metadata using the store's read/list operations.
- Treat syntax/schema issues separately from filesystem safety. Project files may
  be 0644 but cannot be writable by others; user files and private evidence must be
  private. Do not follow links or silently chmod an unsafe existing file.
- Inspect only fixed error codes and safe field locations in shared diagnostics.
  Configuration text, backups and journals may contain user-entered sensitive data;
  keep them private and do not paste raw exceptions, unknown keys or payloads.
- Check free space on both configuration and state volumes using the
  [low disk runbook](low-disk.md). The store's 100 MiB ceiling includes receipts,
  backups and journal evidence; free disk space alone does not resolve quota limits.

## Supported recovery

Open the affected configuration in Apps → MCP Servers, then choose **Configuration
recovery**. Reopen any closed affected project; replacement owners need a fresh
review. Choose **Review transaction**. The review shows the recorded operation,
publication order, every scope, current known state and before/after existence,
validity and definition counts. It does not reveal private configuration bodies.

Choose **Complete transaction** or **Roll back transaction**, inspect the effects
and confirm, or Cancel without changing either file. A User change also affects
other projects inheriting User definitions; closed repositories are not scanned.
Every captured runtime/database owner, exact file revision and journal identity/
contents is rechecked. A changed review must be reviewed again, never forced.
Dirty JSON and guided drafts remain in memory: compare or explicitly reload after
recovery. Browser reload/close can discard them. **Check same recovery request**
inspects an uncertain accepted request using its original durable ID; it is not a
new recovery decision. **Refresh recovery evidence** obtains a new review.

- Re-read a conflicting file and retain the unsaved draft. A save must carry its
  observed revision; same-byte inode replacement still invalidates an older save.
- Repair malformed text by validating the replacement first. The original bytes
  are retained privately. Ordinary Restore accepts only a valid backup and a fresh
  expected revision; it does not silently restore a known malformed configuration.
- For a pending transaction, obtain fresh revisions for every affected target.
  Choose Complete or Roll back explicitly. Complete writes only missing postimages;
  rollback restores exact preimages, including a recorded malformed original.
- A move publishes destination first. A partially moved definition may exist in
  both files; do not remove either entry manually to make the warning disappear.
- If rename succeeded but directory sync failed, the file may already contain the
  requested edit. Complete verifies and syncs it without repeating the rename.
- Cancellation after preparation can leave a pending record. Startup and close
  never complete that record automatically. Retry an accepted request with its same
  ID only to inspect its recorded outcome; a new recovery choice uses a new ID.

## Stop and escalate

Stop when either target differs from all known before/after identities and bytes,
the canonical project was replaced, writer ownership is unverifiable, or evidence
is corrupt. Preserve the newer edits and all evidence. Do not delete foreign locks,
journals, receipts, unknown artifacts or pinned backups as a repair.

Only completed verified backups participate in automatic retention (latest 20 per
configuration within the total ceiling). Pinned evidence is never evicted to make
a write succeed. If no safe headroom remains, keep the draft and seek an explicit
storage decision; do not erase recovery evidence or replay an uncertain operation.

## Verify

Re-read all affected files, compare their exact bytes/modes and fresh revisions,
confirm pending metadata cleared, and verify owned staging files were removed.
Configuration validity does not establish project approval, authentication or
connection health. Moving or restoring configuration transfers no credentials or
approvals.


## Guided management status

Phases 3–4 expose guided saves/removals/moves, exact-text repair, reviewed backup
restore and confirmed reset in Apps → MCP Servers.
Invalid files and pending recovery display safe issues and block affected writes.
Configuration recovery exposes explicit reviewed Complete/Roll back. Backup preview/restore
accepts only valid unpinned records and binds reviewed file identity/content. An
absent-file backup explicitly removes the dedicated configuration file. Preserve all
private evidence and use the reviewed recovery procedure above with verified
ownership. Never clear a writer lock as a repair. After an external edit, reload
the configuration explicitly; failed drafts do not grant authority to a reopened
project or replacement root. Connection health and authentication are independent observations. Runtime controls and secure authentication are human-only; unresolved references/OAuth require authentication.


## Interrupted reset

Reset journals use the same explicit recovery procedure as moves. Combined reset
publishes User first, then the selected project. Unchanged/missing targets and
User inheritance guards are recorded without writes or backups; changes to these
guards also block recovery. Inspect every recorded target before either Complete
or Roll back. A third state, replaced root or unverifiable identity stops recovery.
Rollback can restore the exact malformed original recorded in the journal, while
ordinary backup restoration refuses malformed/pinned evidence. Startup never replays.

Do not discard the browser draft after a conflict or recovery-required result.
Compare saved versus draft, retain evidence and resolve the underlying ownership
or transaction condition. Reset does not disconnect running work or remove credentials.

## Connection failures

A failed server leaves the agent and other tools usable. Check the captured target,
revision, enabled state and project approval independently of health. A changed
project file/native identity needs renewed approval for new connections. Invalid,
unsafe or recovery-blocked files do not fall back to shadowed User definitions.
Test only initializes/discovers and confirms stdio execution; cancel closes its
owned process group. Browser detach cancels tests, while approved session work
continues. Reconnect only when idle with provider load/resume support, reviewing
all affected connectors. Otherwise start a new session. Never retry an uncertain
tool call automatically, clear writer locks, or treat tool annotations as approval.
Disconnect revokes selected instances without changing configured enablement.
Unverified cleanup remains unresolved; preserve ownership and process evidence.
Use **Verify cleanup**, then confirm to retry only retained revoked cleanup handles
for the selected configuration. It does not start connectors, replay calls, search
for process names or stop unrelated processes. If verification still fails, retain
the backend/evidence and resolve the underlying OS/network condition. Remote HTTP
cleanup may remain unverifiable independently of local transport closure.


## Credential and authorization failures

Use the affected definition's Authentication controls. Keep configuration validity,
approval, storage availability, authentication and health separate. Do not put a
secret in JSON, a command argument, an environment literal, a journal or a report.
Persistent entry requires unlocked macOS Keychain or Linux Secret Service. A locked
or unavailable store never switches to keyutils or temporary memory. Unlock/fix the
OS store separately, or explicitly choose a new temporary operation. Temporary
credentials last until backend restart or sign-out; they are never recovered from
records.

A security-relevant edit or move requires review in the new namespace. Label and
enabled changes do not change credential identity. Failed writes and deletion
retain non-secret pending/tombstone metadata; uncertain operations must not select
an old version. Sign-out revokes connections first even if persistent deletion
fails. After unlocking, use Sign out again with a new request to retry owned-entry
cleanup; retain a deletion-uncertain result until verified. No lock-deletion repair
exists, and private ownership/evidence must not be erased. Remote revocation can be
uncertain independently; review the provider's own account/grants if needed.

OAuth requires advertised issuer selection and scope/resource/registration review.
Supply compatible registration information when dynamic registration or metadata
client IDs are unavailable. Rejected issuer/state/resource/PKCE responses never
exchange or restore authority. A five-minute attempt expires on cancellation,
page detach, owner replacement or shutdown. Start a new reviewed authorization;
never replay an old callback/code, resume an uncertain refresh, expand scopes or
retry a business tool request automatically. Reconnect creates fresh session
capabilities only when idle and supported. Configuration recovery never restores credential or session authority.


## Safe troubleshooting report and connection stages

Choose **Review troubleshooting report** to inspect a local optional report, then
**Copy safe report** only if you want to share it. Nothing is uploaded. It contains
counts, configuration validity, approval, authentication and observed health as
separate facts, plus fixed failure codes/stages and unresolved-cleanup counts.
No labels, identifiers, paths, endpoints, definitions, credential references,
secret values or raw server errors/output are included. Private journals/backups
are not safe reports and must not be attached as diagnostics.

- MCP_LAUNCH/MCP_ARGUMENTS: review command, prerequisites, argument rows and execution
  permissions; explicitly Test connection again after correcting the cause.
- MCP_PROVIDER: reconnect needs idle ACP load/resume support. Start a new session
  or choose a supported provider. No prompt is manufactured to reconnect.
- MCP_AUTHENTICATION/MCP_SCOPE: enter credentials or Sign in again after reviewing
  requested access. Do not expand scopes or replay a failed business call silently.
- MCP_NETWORK/MCP_TLS/MCP_TIMEOUT/MCP_PROTOCOL: inspect the reported initialization,
  discovery or call stage. Correct endpoint/network/certificate/protocol support,
  then use the bounded discovery-only Test connection. Never disable TLS validation.
- MCP_LIMIT/MCP_CLEANUP: reduce configured work/disconnect unused instances or
  explicitly verify retained cleanup. Limits do not evict healthy connections.
- MCP_RECOVERY_BLOCKED/MCP_RECOVERY_CONFLICT: preserve drafts and evidence. Reopen
  captured owners and review again; newer edits, replaced roots or corrupt records
  require manual investigation without deleting locks, journals or pinned preimages.

All failed connectors leave other available tools and the agent session usable.
A successful configuration recovery/test does not prove authentication, permission
to call tools, or that an earlier uncertain tool call did not execute.
