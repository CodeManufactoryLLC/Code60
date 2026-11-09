# Windows

Code60 targets Windows 11 x64, both the Electron desktop and the headless CLI.
Windows ARM64 and older Windows versions are not supported release targets.
ARM64 development and x64 emulation do not replace native x64 acceptance.

## Desktop

Use the signed `Code60-<version>-win-x64.exe` release installer. Installation is
per-user, without elevation or PATH changes. Electron and its Node runtime are
bundled. Git and the chosen provider's CLI remain separate prerequisites.
Install and authenticate providers yourself; Code60 never does this for you.
Updating or uninstalling Code60 keeps configuration, desktop preferences,
user-selected SQLite databases, records and worktrees. Use Settings → Updates
to check, download, and explicitly install and restart. The app verifies the
download and installer signature and stops every agent before installing.
Updates remain per-user without elevation; ordinary quitting does not install.

Desktop startup reads inherited PATH, user/machine registry PATH and these
installation locations, without running PowerShell, cmd profiles or login scripts:

- `~\.local\bin`, `~\bin`
- `%LOCALAPPDATA%\Microsoft\WinGet\Links`
- `%LOCALAPPDATA%\Programs\Git\cmd` and `Programs\nodejs`
- `%ProgramFiles%\Git\cmd` and `nodejs`
- `%APPDATA%\npm`

Discovery is bounded to three seconds. Restart the app after PATH changes.
Standard npm/npx shims use their JavaScript entrypoint and an adjacent or
PATH-resolved Node executable. The bundled desktop runtime does not supply npm.
An absolute executable command in the existing config file overrides discovery.
Other batch launchers reject shell metacharacters, embedded quotes and trailing
backslashes in arguments; use an executable or standard npm/npx instead.
Prompts travel over ACP stdin, never through command-line arguments.

User MCP servers use the same read-only configuration file. See
[MCP configuration](MCP.md) for stdio, HTTP and SSE examples, provider capability
requirements, session lifecycle and credential cautions. Use installed executable
commands and escape Windows path backslashes in JSON.

## Headless CLI and development

Install Node.js 22.12 or later, Git for Windows, Microsoft C++ Build Tools with
the x64 toolchain, and the Windows 11 SDK. Do not enable machine-wide long paths
or change global Git settings just to build Code60.

```powershell
npm ci
npm run build
node dist/cli/main.js --help
node dist/cli/main.js --version
npm run check
npm run test:desktop
npm run package:win
```

The existing `npm run install:global` workflow installs the CLI separately.
The desktop installer never installs that command. CLI stdout, JSON, flags and
exit codes are unchanged. Ctrl+C cancels active runs; forced process termination
cannot produce a final JSON response, but closing the owner terminates its jobs.

HOME remains authoritative when set; otherwise USERPROFILE/native home is used.
Existing XDG overrides and defaults remain:

- Config: `$XDG_CONFIG_HOME/code60/config.json`, or `~/.config/code60/config.json`.
- State/preferences: `$XDG_STATE_HOME/code60`, or `~/.local/state/code60`.
- Repository records: `<git-common-dir>/code60/runs`.
- Chat workspace: `.code60_workspace` beside the selected database.

Use local absolute drive paths. Spaces and Unicode work; browser-relative file
paths use `/`. UNC/device paths, drive-relative paths, alternate streams and
paths of 248 characters or more are not supported for native storage/browsing.
Choose a shorter local location rather than changing registry long-path policy.
Previews reject symlinks, junctions and all other reparse points.

New private directories/files use owner/SYSTEM ACLs. Existing user parent ACLs
are never rewritten. An unsafe existing Code60-private ACL produces an error;
back up data and correct that specific directory's permissions explicitly.
Sharing violations receive bounded retries for atomic replacement, never a
delete-then-write fallback. Other permission and disk errors fail immediately.
SQLite writer contention fails promptly instead of blocking the window for
seconds; retry after the other writer finishes.

## Processes, recovery and verification

Every agent role runs in an owned Windows Job Object before executing any code.
Root exit, owner loss or control-channel loss ends the job and its descendants.
ACP still chooses only once-only permission answers. Cancellation still sends
ACP cancel and waits up to ten seconds before terminating the owned job.

Run records can contain optional creation-time, SID and job identity metadata.
Old records remain readable. A PID or matching command line never authorizes
termination. Unknown, inaccessible or mismatched identity blocks unsafe
continuation/discard. Recovery is always explicit; startup does not resume work.
Code60 does not delete worktrees on shutdown.

Automated tests use fake ACP providers only. Native Windows 11 x64 acceptance
must cover source CLI and desktop, installed/reinstalled/uninstalled packages,
Ctrl+C, task/owner crashes, descendant cleanup, once-only permissions,
cancellation, recovery, locked files/databases, caption buttons, Snap,
keyboard shortcuts and retained user data. Signed release verification also
requires real configured signing credentials and timestamp/certificate checks.
Live-provider testing requires separate authorization and is not implied by
running the automated suite. See [release gates](RELEASING.md).
