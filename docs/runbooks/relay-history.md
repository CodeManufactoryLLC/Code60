# Damaged Relay history

## Symptoms

Relay cannot connect/reconnect because private storage fails validation, or the
live conversation warns that history saving failed. A recorded history gap is
different from malformed frames or changed journal identity.

## Read-only diagnosis

Record version, platform and fixed error category. Check
[disk pressure](low-disk.md) and the optional [Logs viewer](diagnostics.md).
The private store is `$XDG_STATE_HOME/code60/relay`, default
`~/.local/state/code60/relay`; state metadata is outside its `workspace/`.
Inspect storage metadata and known app/process ownership only. Do not print
prompts, transcripts, tokens or journal contents into diagnostics.

## Supported recovery, only after consent

1. Preserve original state, workspace, journals and saved reviews. Do not delete,
   truncate, replace, migrate or edit them. A fresh database does not repair
   application-owned Relay state.
2. If the issue is transient storage failure, restore storage safely first.
   Request permission for a supported reconnect/Retry when offered. Connection
   revalidates storage before creating a new writer; Retry can clear a transient
   write-failure latch only after validation succeeds.
3. A history gap alone permits a fresh connection once the journal validates.
   It does not reconstruct missing messages or authorize replay. Damaged frames,
   missing workspace data, unsafe objects or changed journal identity still
   block. There is no general history-repair CLI in this version.
4. If a clean app restart is appropriate, explain interruption and stop
   desktop-owned work normally first. Background scheduler work is separate.
   Restart restores evidence, not provider context, pending plans, live workers
   or feedback authority. Ask the user what new work, if any, to authorize.

## Verify

Confirm connection state and history-saving status separately. With explicit
permission, use a synthetic new message to verify saving; do not replay the
uncertain request. Check that saved reviews remain readable and that no old
worker was redispatched. An existing history gap may remain recorded after
successful recovery; do not call missing history recovered.

## Stop and escalate

Stop after validation still refuses, or when writer identity is live/unknown.
Preserve evidence for private support. Never remove locks, erase the journal,
replace state with an empty file or repeatedly retry corrupted history.
