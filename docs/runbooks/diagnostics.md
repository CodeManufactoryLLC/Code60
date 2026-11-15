# Diagnostic storage unavailable

## Symptoms

Apps → Data Viewer → Logs shows unavailable/read errors, dropped records or
persistence failures. Diagnostics are optional; their absence is not proof of
agent failure or success. Viewing pause does not pause capture.

## Read-only diagnosis

Record version/platform and the fixed error category. Check free space on the
state volume and whether the affected app uses the intended HOME/XDG settings.
Storage is `$XDG_STATE_HOME/code60/logs`, default `~/.local/state/code60/logs`.
Inspect only metadata (directory type, owner/private permissions, known app
instances). Do not dump log/transcript contents or change permissions blindly.
Private POSIX modes/Windows ACLs and live/unverifiable writers are safety gates.

## Supported recovery, only after consent

- For an expired/evicted cursor, use Refresh to read the latest page; for a
  transient read failure use Retry logs. This does not repair unsafe storage.
- Resolve [disk pressure](low-disk.md) first. If safe, close only known owned
  duplicate app instances normally, then reopen the intended app. Do not delete
  locks; the store performs its own bounded dead-owner handling.
- If ownership/permissions or directory identity changed, stop and ask the
  administrator to establish the intended private storage. There is no supported
  blanket chmod, recursive deletion or automatic adoption procedure here.
- Clear logs is a separately confirmed destructive action for **diagnostic
  segments only**, not the default recovery step. Explain loss and get approval
  before its native confirmation. It never clears Events/transcripts, databases,
  run records or Relay history.

## Verify

Refresh Logs and inspect a newly generated, user-authorized synthetic operation.
Check unavailable/drop/persistence status explicitly. Retention is seven days /
20 MiB for diagnostic JSONL only; it does not constrain transcript storage.
No historical rows does not necessarily mean capture remains broken.

## Stop and escalate

Escalate continuing storage/ACL/identity or lock-owner errors. Keep original
evidence and share only authorized, redacted diagnostic metadata privately.
Do not restart a successful agent task merely to manufacture a diagnostic row.
