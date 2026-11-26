# Managed installation internals

Phase 4 introduces the first supported installation layout. There is no legacy
recognition, migration or compatibility layer. The filesystem APIs remain internal. Phase 5 now composes them through the private
candidate setup command; see [setup behavior](setup.md). Installation primitives
do not initialize databases, verify providers, register services or update/remove
releases themselves. Phase 7 composes an explicit guarded version transition;
see [updates and recovery](updates.md).

## Layout and activation

The default root is `~/.local/share/code60`, overridden by absolute XDG_DATA_HOME
with `/code60` appended. It contains a private installation receipt, `.install-lock`,
`.staging`, digest-keyed `releases`, immutable `activations` and the relative
`current` symlink. The durable command is
`~/.local/bin/code60`, an exclusively created symlink to the owned current launcher.

Management receives Phase 3's verified artifact acquisition as an injected port.
Staging stays on the destination filesystem. Receipt and launcher support writes
are flushed before an atomic current-pointer rename. Each generation embeds its
own absolute Node and helper paths, so concurrent commands use one coherent
activation even if current changes. No helper remains dependent on npm's cache. The packaged adapter identifies only
its own invoking bootstrap executable as a transient PATH exemption, preventing
npx from conflicting with itself; unrelated commands still block activation.

An existing healthy matching release is reused without download. Explicit repair
may replace an owned launcher/runtime binding. A different version or digest is
rejected rather than implicitly updated by setup. Only the explicit update flow
may prepare a newer stable generation and pass its consent/quiescence gate.
Unknown receipts, unowned files, unsafe
links, privileged destinations and effective command conflicts are errors.

Installation locks fail promptly when busy or uncertain. They are never reclaimed
automatically, even when a recorded process appears gone. Only the verified owner
releases its token. Before publication, cleanup removes the attempt's verified
inactive resources. After publication or uncertain publication, preserve the
possibly active release and report failure rather than destroying it. Previously
active releases are never pruned by this phase.

The launcher checks private receipts, owned support files, payload identity and the
installed CLI entrypoint. It checks the recorded canonical Node and supported
runtime before loading application code. It strips NODE_OPTIONS/NODE_PATH and
never searches PATH for a replacement Node. Missing/incompatible runtime errors
require explicit reconciliation using supported Node; the launcher performs no
implicit repair. CLI arguments, environment, exit status and signals retain the
existing management behavior.

## Shell preview and consent

The internal shell planner returns paths, fingerprints and only the exact proposed
addition, never existing profile contents. Do not log original shell profiles.
The application step requires both interactive context and explicit approval.
Non-interactive or declined integration prints instructions without profile edits.
Each preview covers at most two files of at most 1 MiB, and rechecks identity and
content before atomic replacement. Preserve permissions, newline style and unrelated
bytes. An installation-specific marked block and private shell receipt record
ownership. Modified/unknown blocks receive manual instructions.

The internal removal planner returns only each exact owned addition to remove.
New receipts retain that addition so unrelated later profile edits can survive
removal byte for byte. A receipt without its addition fingerprint requires an
unchanged whole-file hash. Removal also requires separate interactive approval;
service consent never grants permission to edit profiles. An edit made after the
preview is preserved, and partial completion is reported. This planner alone does
not unregister services or uninstall the application.

Bash uses its first existing login profile and `.bashrc`; zsh uses `.zprofile` and
`.zshrc` under absolute ZDOTDIR or HOME; fish uses XDG_CONFIG_HOME/fish/config.fish
or its default. No discovery runs user profiles. Unsupported shells, startup
redirection, symlinked/read-only/unsafe profiles and stale previews receive manual
guidance. fish uses process-global PATH only, never universal variables.

Partial success is recorded without reverting unrelated changes. The installed
command stays available by absolute path even if shell integration needs manual
work. Print the shell-appropriate current-session command and explain that a new
terminal is normally needed; a child cannot update its parent shell's environment.

## Build and acceptance

`npm run build:distribution` builds and verifies a clean Node-only management/platform
closure. The private bootstrap contains it alongside the Phase 3 verifier and
embedded descriptors. It still has no runtime dependencies/hooks and stays below
1 MiB compressed. `npm run test:bootstrap` preserves artifact-only checks.

Run `npm run test:installation` for real process-level shell/launcher fixtures;
`npm run test:installation -- --require-fish` requires all three shells. These are
supporting integration tests, not the production golden journey. An unavailable
shell is BLOCKED, never silently counted as passed. Supply fish in the Linux dev
container or disposable native runner, not by changing the user's host.

After building a Linux payload, run on the Docker host:

```sh
npm run test:packaged:clean -- --managed release/payloads/linux-x64.json
```

The test-only bootstrap fixture uses the actual packaged adapter and compiled
installer closure with the exact Linux descriptor. The production bootstrap builder
continues requiring both real platform descriptors. Managed acceptance installs
outside the checkout, removes the temporary bootstrap cache, invokes both the
absolute launcher and bare command, and runs the existing full golden journey and
offline model/probes against the managed release. Provider fixtures stay separate
from the immutable application; only their SDK link points into its production
dependencies. Artifact-only payload and legacy tarball modes remain independent.

Retain QA reports and `test-results/installation`, bootstrap, payload and clean-install
evidence. Verify owned process/container/image/volume cleanup; preserve caches and
other agents' resources. The manual Apple Silicon workflow validates native launchers
and shells without installing a user service.

## Failure recovery

Use `code60 update status` to inspect a recorded update and `code60 update recover`
to repair its current generation with explicit consent. Recovery retains both
release generations and never automatically downgrades databases or replays work.

Preserve failed-run evidence and uncertain locks. Inspect the exact installation
receipt, activation pointer and owner token. Do not erase a lock, delete history,
prune releases or kill an unverified process to make another attempt succeed.
Repair requires establishing ownership and an explicit operator decision; there is
no automatic stale-lock recovery command in Phase 4. Failed shell edits leave
manual continuation instructions and identify any blocks already applied.

## Uninstall recovery internals

Phase 8's installed uninstall command is implemented and undergoing acceptance;
see [uninstall and recovery](uninstall.md). Its internal cleanup publishes private
support under `removals/<attempt>` before deleting any
application files. The printed absolute recovery launcher uses recorded Node and
remains usable after the application entrypoint or temporary bootstrap cache is gone.
The original `current` pointer is retained until its owned files have been removed.

Recovery uses immutable inventory/support hashes and durable `removal.json` progress.
It rechecks the original service directory and registration identity under the same
non-reclaiming operation lock used for guarded removal. It never selects a different
state directory from a changed environment or stops an uncertain process. Changed
files and replaced links remain intact; cleanup failures are reported even after
application deletion has completed.

Databases, configuration, run records, engine evidence/cache and worktrees are
retained. Reinstall refuses unfinished cleanup, then validates completed removal
and retained installation ownership. A completed old recovery command refuses a
later activation. Full packaged uninstall, recovery and real database reinstallation
acceptance are still required before Phase 8 delivery.
