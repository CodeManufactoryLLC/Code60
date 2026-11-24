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
- Native Transmission process adoption is macOS Apple Silicon only, matching
  engine availability. Verify the canonical Node text mapping, exact argv, UID and
  stable start identity with fixed system inspection commands. Return hashes,
  never raw argv. Portable PID-existence/exit checks do not establish ownership;
  callers must first prove it through their service, gateway or owned-child boundary.
- Reject unsupported hosts before process launch; macOS and Linux are the only supported operating systems.
- Enforce finite startup/cleanup deadlines.
- Preserve POSIX process groups and grace periods.
- Retry failed cleanup verification without resending termination signals to
  a potentially stale process-group identifier.
- Fail closed when native identity, privacy or file containment cannot be verified.
- Native service inspection uses bounded fixed launchd/systemd commands and reports
  running/stopped/unavailable separately. Never treat supervisor failure as stopped,
  follow service-definition symlinks or mutate registration during status reads.
- Use the diagnostic utility for best-effort credential redaction before clipping errors and bounded stderr. It is not a transcript scrubber or a PII anonymizer.

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

- Transmission bundle storage is a Node-only filesystem boundary. Validate exact
  supported artifact identities and the complete regular-file inventory before
  publication or launch. Version bindings and canonical Node are immutable; keep
  published engines separate from application activation and workflow state.
  Never acquire dependencies, compile helpers, reclaim uncertain locks or start
  engines during inspection. Remove only verified staging owned by the attempt.
