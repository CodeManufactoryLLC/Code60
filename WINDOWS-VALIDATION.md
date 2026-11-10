# Windows implementation validation

Initial validation on 2026-11-06. Version: `0.2.0-beta.4`, before the implementation
commit and integration with the latest main branch. The artifact and measurements
below describe that initial validation, not the subsequent integration.

This is development evidence, **not release validation**.
The host is Windows build 26300 **ARM64**, with Node 24.22.2 ARM64.
The x64 application and installer run under Windows emulation on this host.
No live providers were launched, installed or authenticated.

## Checks

| Check | Result |
| --- | --- |
| `npm run check` | Passed: typecheck, lint, helper compile, 540 tests passed, 14 skipped, 53 files |
| CLI `--help` and `--version` | Passed, exit 0; version remains `0.2.0-beta.4` |
| ARM64 and x64 native helper compilation | Passed with MSVC warnings treated as errors |
| Final source desktop suite | Passed: 17/17 tests, 2.0 minutes |
| Final x64 NSIS package | Passed, unsigned per-user development artifact |
| Final install/upgrade/uninstall checks | Passed: 5/5 tests before upgrade and 5/5 after, retained-data checks and final cleanup succeeded |
| Authenticode and timestamp verification | Installer, application and helper confirmed `NotSigned`; release signature/timestamp acceptance was not run |
| Native Windows 11 x64 hardware | Not run; not part of release validation |
| Linux/macOS execution | Not run on this host |

The 14 skips are the POSIX shell-environment cases (12), the POSIX SIGTERM CLI
test (1), and the FIFO preview case (1). Windows owner-crash and descendant
cleanup have separate passing tests; these do not substitute for console Ctrl+C.
Biome 2.6.4 ran using its x64 binary because its ARM64 binary crashes on this host.

## Integration validation

After integration with the latest main branch, the full check passed with
542 tests passed and 14 skipped. All 17 source desktop tests passed, followed by
three additional passes each of the workspace and independent-chat scenarios.
These checks retain the host and acceptance limitations above.

The integration exposed a race between the visible final status and its record
write. Immediate recovery now waits for that run's cleanup and final persistence,
without waiting for other idle runs in the batch. A gated-write regression test
failed before the fix and passed afterward. The workspace smoke test also waits
for agent readiness before expecting its worktree in a one-time scan.

The development artifact and timing observations below predate this integration.
They do not describe a newly built or signed release.

The first PR CI run passed both Linux Node versions, Linux desktop tests and
Linux installer checks. Native Windows Server x64 exposed creation paths that
relied on the token's default owner, which can be an administrator group.
Private creation now specifies the current user explicitly. Record/event and
preference contents pass over stdin to the helper, which retains checked path
handles through creation and writing; ACL checks are not relaxed.
The ownership test also checks the resulting owner independently with Windows
security APIs. The sharing-lock fixture uses an explicit release file rather
than PowerShell console input. A helper timeout at the replacement deadline
preserves an already observed sharing error, but never masks access denial.

## Initial development checks

Real Windows checks cover transient and persistent file locks, read-only
destinations, private ACLs, junction ancestors, competing SQLite writers,
batch argument round trips, npm/npx entrypoints, owner loss and descendant
cleanup. Development lifecycle tests execute the dev entry point with OS/process
dependencies replaced, including restart failure, shutdown during launch, watcher
failure and preservation of the POSIX app grace period.

An initial installer run passed both five-test application passes but failed
during deletion of its locked temporary uninstaller. A subsequent run exposed
the same cleanup race in a discovery fixture. Cleanup now uses bounded retries
only for generated test directories. Product atomic replacement still retries
only native sharing violations, never arbitrary permission errors.
The final sequential run passed all checks after those fixes.

The native helper is packaged as a filtered directory resource. This matters:
electron-builder's single-file resource copy bypasses its signing transformer.
Release verification independently requires valid, timestamped signatures for
the installer, application, native helper and uninstaller.

## Final development artifact

- File: `release/build/Code60-0.2.0-beta.4-win-x64.exe`
- Size: 149,059,531 bytes.
- SHA-256: `7ff0b040712e760b6d1f85e7dd4e7a4f8a9ecb9f2cb10b010da490f28c7eb8f4`
- Application and native helper PE machine: `0x8664` (x64). NSIS uses an x86
  bootstrap (`0x014c`) containing the x64 payload.
- The packaging log confirms the helper reaches the signing transformer.
  Signing is explicitly skipped without configured credentials.

Do not distribute this unsigned development artifact as a signed release.
No native-x64 signed release verification record was produced.

## Fresh-process timing observations

Three separate ARM64 Node processes exercised the compiled default Windows
process owner. Each launched a three-level, 13-process tree, waited until every
process reported readiness, stopped the owned job, verified the job was gone,
and verified every recorded process had exited.

| Measurement | Observed range |
| --- | --- |
| Initial owned-process launch | 44.2–50.5 ms |
| All 13 processes ready | 496.5–533.7 ms |
| Owned-job stop | 73.0–81.7 ms |
| Maximum locked SQLite write in each fresh process | 33.3–34.5 ms |

Each process also tested eight real exclusive SQLite locks, followed by
successful writes after release. All 24 failed writes stayed below the 150 ms
responsiveness check. These are bounded-fixture observations, not native x64
performance claims or a guarantee for arbitrarily large process trees.

## Remaining release validation

Release validation uses the Windows Server 2025 x64 CI runner. Manual Windows 11
hardware acceptance is not planned, so interactive console Ctrl+C, caption
buttons, Snap and DPI behavior remain uncertified.

- Configure signing outside this task and verify certificate identity,
  SHA-256/RFC3161 timestamps, installation, upgrade, uninstall and retained data.
- Run the unchanged Linux/macOS gates on their actual hosts.
- Live-provider testing needs separate authorization.

No version bump, release publication or signing-secret configuration was made.
Machine long-path policy and global Git settings were not changed. Repository
line-ending rules keep Windows checkouts compatible with Biome without changing
the user's Git configuration.
