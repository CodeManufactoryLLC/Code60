# Setup and first use

The private distribution candidate now implements `setup`. npm ownership, release
asset publication and public availability remain Phase 10. The proposed public
entry point is not an announcement that an npm package is available today:

```sh
npx --yes code60@latest setup
```

## Consent and continuation

Setup checks Node >=24.22.0 <25, npm, Git, supported platform and safe destinations.
It installs verified application files and a durable `~/.local/bin/code60`, then
delegates to that launcher. Shell integration has its own exact preview and
interactive approval; Code60's `--yes` never approves profile edits.

Background service enrollment is opt-in and defaults to No. Without a TTY, use
Code60's trailing `--yes` to authorize it. npm's leading `--yes` only accepts npm's
own package prompt. Declining enrollment exits 0 with an explicit **incomplete**
result, installed launcher fallback and the exact continuation command. It creates
no database and does not open a browser. Linux completion requires a working user
systemd session; no sudo or system service is installed.

```sh
~/.local/bin/code60 setup --yes --no-open
~/.local/bin/code60 status
~/.local/bin/code60 open
```

`--no-open` skips the browser opener, not readiness or database preparation. Setup
prints the exact token-free loopback URL. Opener failure leaves a usable URL and
returns success. Existing pairing policy is preserved; when pairing is enabled,
the intentionally printed single-use code is never passed as a subprocess argument.
A new terminal may be needed after profile edits. Setup cannot change its parent
shell's PATH. Non-interactive operation only prints PATH instructions.

## Database and repeated setup

The first default is `$XDG_DATA_HOME/code60/databases/default.sqlite`, using
`~/.local/share` when XDG_DATA_HOME is unset. Its sibling `.code60_workspace` is
private. Releases, activation generations and databases occupy separate trees.
The service retains XDG_DATA_HOME so it uses the same location as setup.

Gateway startup and explicit setup prepare the default database when no selection
exists yet. Strict preference checks distinguish no selection from damaged
metadata. Valid custom selections are retained; missing, unsafe, corrupt, empty
unrelated or newer-schema files are never replaced or silently bypassed. An
existing default is validated before adoption after an interruption. New defaults
are staged privately and published without overwriting. Database preparation is
serialized with application operations, and the private management route accepts no
caller-supplied path or browser Origin.

Repeat setup reuses healthy matching files and database selection. It does not
implicitly update releases, repair uncertain registration, verify a provider,
connect an agent or resume work. The browser still requires visible provider
verification and project selection. Manual database creation/selection remains
available independently.

## Status and failures

`code60 status` returns JSON for installation/runtime, service/backend, database
and existing engine availability. Unavailable and offline components are explicit.
Status never creates storage, installs/repairs services, issues pairing codes or
starts an engine. macOS installation candidates preserve pinned workflow engines
outside application activations; workflow start/reconnect remains explicit and
uses separate Codex authentication. Linux x64 installations preserve the verified Linux engine for new workflows.

Failed readiness, registration or database preparation returns nonzero and preserves
valid installed files and committed state. Inspect `code60 status` and
`code60 service status`; use the printed explicit recovery instructions. Do not
delete uncertain setup/installation locks, replace a database, stop an unrelated
process or repeat an uncertain registration as an automatic repair. A setup lock
has unique ownership and is never reclaimed automatically. Interrupted setup
preserves signal exit codes after owned cleanup; an already enrolled service is
not rolled back or uninstalled.

## Validation boundaries

`npm run test:setup` exercises the real installed CLI, private preparation,
files-only/repeat/restart/pairing behavior and offline models using a bounded fake
backend supervisor. `npm run test:packaged:clean -- --setup release/payloads/linux-x64.json`
adds the complete installed browser golden journey and independent Git/process
assertions. Release/helper trees remain read-only; metadata and databases are
writable. Original manual-database, tarball, artifact-only and managed journeys
remain independent. These fixtures prove no real login/startup behavior; native
launchd/systemd lifecycle certification remains Phase 9. Never install a real
service, fish or shell profiles on the developer's host to make these checks pass.
