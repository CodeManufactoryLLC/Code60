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
- Native service inspection uses bounded fixed launchd/systemd commands and reports
  running/stopped/unavailable separately. Never treat supervisor failure as stopped,
  follow service-definition symlinks or mutate registration during status reads.
- Use the diagnostic utility for best-effort credential redaction before clipping errors and bounded stderr. It is not a transcript scrubber or a PII anonymizer.
