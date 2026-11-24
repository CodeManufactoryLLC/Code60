# Explicit updates and recovery

The private distribution candidate supports `code60 update` for an existing
healthy managed installation on macOS arm64 or Linux x64 with Node
`>=24.22.0 <25`. Packages remain unpublished until release preparation. Setup
continues to reuse the matching release and refuses an implicit version change.

## Update

Run `code60 update` in a terminal. It resolves the stable bootstrap from the
public npm registry, verifies its SHA-512 integrity, reads its exact platform
descriptors and verifies the selected application payload. Downloaded bootstrap
code is never executed. The registry protocol uses npm's
[version metadata and dist fields](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md).
There is no public alternate-registry or download URL option.

The old backend remains usable while the replacement is prepared. The terminal
summarizes interactive and scheduled activity and asks before interruption.
Without a TTY, use Code60's trailing `--yes` to authorize backend changes:

```sh
code60 update --yes
```

Decline leaves the old activation and backend running. A matching stable release
is a no-op; an older stable release never causes a downgrade. A different digest
for the installed version is a conflict. Failed registry or payload verification
does not stop the backend.

After consent, update drains owned work, stops the native backend and independently
waits for its PID to exit. It publishes one immutable activation, repairs the
registration through that generation's verified launcher and waits for matching
authenticated readiness. Reconnect with `code60 open`. User databases, preferences,
histories and worktrees remain outside replacement. Healthy pinned workflow
engine files and Node bindings are retained, including approved independent work.
No database downgrade or uncertain execution replay is performed.

## Inspect and recover

```sh
code60 update status
code60 update recover
```

Status reads the current installed version, activation and private progress
without checking the registry, locking, repairing or starting a backend.
Recovery requires separate terminal consent (`--yes` without a TTY). It repairs
the current activation's registration and checks readiness. It downloads no new
release and never changes the current generation to an older version. Before
publication, recovery keeps the original generation; after publication, it keeps
the new one. Prior releases and their immutable receipts remain available for
inspection. Automatic rollback is unsafe once a newer backend has opened data.

Unfinished progress prevents a second update. Installation and setup locks are
exclusive and never reclaimed automatically. Preserve an uncertain lock, receipt,
changed service definition or progress record and inspect its owner before any
manual recovery. Do not erase history, remove a lock or kill an unverified PID to
force another attempt. Failed cleanup is an error even when activation succeeded;
active files are retained. See [installation recovery](installation.md#failure-recovery).

## Browser and authority

Apps → Update Manager shows the running installed version and these terminal
commands. It makes no registry requests, downloads or service changes. Agents
receive explanatory capability metadata, not replacement authority. Updating
does not edit shell profiles or change provider verification.

## Validation boundaries

After building the current target payload, run `npm run test:update` (or supply
its descriptor with `npm run test:update -- /absolute/path/platform.json`). It
uses a fresh isolated managed installation and real installed backends, replacing
only native supervisor and artifact transport boundaries. A scratch copy supplies
a controlled newer version; its descriptors are test fixtures, not release or
unexecuted-platform evidence. The original payload stays unchanged. Evidence under
`test-results/update` records custom-database preservation, retained activations,
engine binding bytes, native offline models, no-op PID continuity and owned cleanup.

Focused checks cover registry and payload attacks, ownership, immutable
generations, consent, quiescence, interruption and explicit recovery. Packaged
acceptance must additionally exercise the full golden journey against the updated
release and independently compare database/preferences, Git/index/HEAD/worktrees,
engine bindings and process outcomes. Keep npm tarball, artifact-only, managed,
setup, shell, offline-model and native workflow regressions independent.
Fake supervisor boundaries do not certify actual launchd/systemd login or reboot
behavior; that remains Phase 9 validation in an authorized disposable environment.
