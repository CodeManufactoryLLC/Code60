# Distribution Upgrade Plan

Draft implementation plan. Each numbered phase is one pull request, pushed to a
feature branch and merged only after its dependencies and required checks pass.
This document authorizes no implementation, service installation, release,
registry publication or website deployment.

The short intent remains in the [architectural view](docs/architectural-views/one-command-distribution.md).
[ARCHITECTURE.md](ARCHITECTURE.md) and [RELEASING.md](RELEASING.md) remain authoritative
until the corresponding implementation PR updates them.

## Goal and completed user journey

A developer arriving at code60.dev copies this proposed command:

```sh
npx --yes code60@latest setup
```

Setup checks prerequisites, installs a compatible release, makes the persistent
`code60` command available, requests background-service consent, initializes a
default database and opens the local browser UI. The developer verifies an
existing provider and chooses a repository. No agent task starts during setup.

Subsequent use is through `code60 open`, `code60 status`, `code60 update` and
`code60 uninstall`, alongside the existing service and pairing commands.

Success includes repeatable installation, useful failure recovery, reliable
updates and preservation of existing databases, histories and unfinished
workflows. One command is the entry point; missing prerequisites and consequential
service/shell changes still require clear instructions or consent.

## Baseline and decisions

### Existing implementation

- Code60 is a browser-only Node application supporting macOS Apple Silicon and
  Linux x64. Phases 1–2 add an isolated dev container and Docker acceptance harness.
- The management CLI already implements open, service and pairing operations.
  The gateway owns the application and scheduler; native service controls have
  injectable test boundaries.
- Packaging currently produces an npm tarball. The source manifest is private,
  and there is no public setup, update or application-uninstall command.
- Database initialization exists, but first use currently asks the user to
  create/select a database.
- Workflows use pinned Transmission staging.20; older unversioned records retain
  staging.18. The separately supplied Transmission source checkout exposes a
  different API. It is not a drop-in replacement.

### Distribution contract

- npm is the primary entry point. Native installers, Electron, bundled Node,
  remote hosting and automatic background updates are outside this plan.
- Require Node >=24.22.0 <25, npm and Git for the new setup path. Keep Node
  externally installed; align documented/runtime checks in the release that
  introduces this prerequisite.
- Support macOS arm64 and Linux x64 with a working user systemd session.
  Workflows remain macOS-only. Publish explicit OS/library minimums only after
  native validation establishes them.
- The npm bootstrap contains the launcher/installer and exact release metadata.
  Full platform payloads contain compiled application assets, locked production
  dependencies, offline models, notices and, on macOS, compatible Transmission.
  Installation performs no native compilation or production dependency resolution.
- Keep `package.json` as the only manually maintained Code60 version. Generate
  bootstrap/payload manifests from it. Transmission retains its independent,
  explicitly pinned engine version.
- Store versioned application files under `$XDG_DATA_HOME/code60`, defaulting to
  `~/.local/share/code60`. Retain existing private state/config locations.
  Application and engine releases have separate directories so application updates
  cannot overwrite an engine serving unfinished runs.
- Install the persistent launcher at `~/.local/bin/code60`. Respect an existing
  unrelated command; never overwrite it or write privileged command directories.
- Put the first default database at
  `$XDG_DATA_HOME/code60/databases/default.sqlite`, with the
  `~/.local/share` fallback and adjacent private `.code60_workspace`.
- Repeat setup reuses a healthy installed release and existing database selection.
  It does not implicitly update an installation, reconnect agents or resume work.
- Installation and update use exclusive ownership, bounded downloads, staging,
  verified archives and atomic activation. Never repair failed ownership by
  removing locks, deleting history or guessing which process to kill.

### Public command behavior

- `setup`: install/reconcile Code60, obtain consent, prepare the database, start
  the backend and open the browser. Code60's trailing `--yes` is distinct from
  npm's leading `--yes`.
- `open`: start the installed backend if necessary and open its token-free URL;
  honor existing pairing policy.
- `status`: read-only installation, runtime, backend and engine health.
- `update`: explicitly acquire and activate a newer compatible stable release.
  Display the consequences and require consent before stopping active backend work.
- `uninstall`: explicitly stop/remove owned application components and services;
  preserve user data and refuse uncertain or active workflow ownership.
- Preserve existing `service` and `pairing` interfaces. No prompt-submission or
  general shell/filesystem execution CLI is added.

## PR delivery and validation rules

Use sequential branches from current `origin/main`, after each prerequisite PR
merges. Suggested implementation branches are `codex/distribution-01-container`,
`codex/distribution-02-acceptance`, and similarly numbered branches thereafter.
The existing `packaging-and-distribution-updates` branch holds the planning work.

Each PR has its phase outcome, focused tests and user-visible documentation.
Run the narrow relevant checks first and full `npm run check` before every
commit. Behavior changes use the [workflow QA skill](.factory/skills/qa/SKILL.md)
and real browser journeys; static/unit checks do not establish E2E success.

Capability-affecting PRs update the knowledge catalog, availability rules/tests and
generated capabilities. Other PRs explicitly explain why no catalog change is
needed. Do not lower coverage floors, loosen module boundaries or broaden Knip
exclusions to accommodate distribution code.

Keep ordinary PR CI on Linux Node 24 and preserve the aggregate `CI passed`
check. macOS/native lifecycle gates remain explicitly requested workflows.
Routine tests use fake providers, fake native supervisors and isolated state.

Container runs remove their owned containers, temporary images, networks and
temporary volumes, including after failure. Preserve dependency/model/build caches
and host evidence. Verify cleanup and report blocked execution honestly; never
use global Docker prune or fall back to installing a real user service.

## Phase 1 — Minimal Linux dev container

**Status:** implemented and validated on macOS arm64 and Linux amd64 in Docker.
Both full check suites, the first-use browser journey, the development Fast Refresh/
restart journey and container packaged/offline-model smoke checks pass. Actual
VS Code port forwarding remains an explicitly unverified manual acceptance item;
no native login-service or macOS Transmission validation is claimed.

The concurrency follow-up reserves stable gateway/Vite pairs per worktree and
generates matching editor configuration. Two Linux containers passed the existing
first-use and development journeys simultaneously; removing one preserved the
other's backend, Vite and Git state. Actual editor forwarding remains unverified.

**PR outcome:** contributors can develop and run existing checks in a reproducible
Linux environment before distribution behavior changes.

### Work

- Add a pinned Node 24 development image and Dev Container configuration, with
  Git, headless Chromium dependencies and bash, zsh and fish for later shell tests.
- Run editor, development and test processes as a non-root user. Handle bind-mount
  UID/GID differences using the supported
  [Dev Container user configuration](https://code.visualstudio.com/remote/advancedcontainers/add-nonroot-user).
- Use Linux x64 for production-target validation, including on Apple Silicon via
  explicit Docker platform selection. Do not call emulation native macOS evidence.
- Support both ordinary clones and linked worktrees. Mount only the checkout and
  required common Git directory; do not mount the user's whole home, provider
  credentials, host services or Docker socket.
- Keep container dependencies separate from host `node_modules`. Prepare pinned
  model assets explicitly and keep reusable caches independent of test state.
- Support the existing development command and headless browser journeys. For
  manual browser access, document forwarding the original loopback gateway/Vite
  ports. Verify Host/Origin and HMR behavior without broadening production binding,
  authentication or CSP.
- Document a CLI entry path as well as editor reopening, startup and cleanup.
  Update development instructions and remove stale references to deleted harnesses.

### Acceptance

From a clean container, install dependencies, prepare models, run the existing
check suite and browser golden path, and demonstrate Fast Refresh. Git works in
a linked worktree. No host service, provider credential or shell profile changes.

**Depends on:** none.

## Phase 2 — Clean installation acceptance harness

**Status:** implemented. Fresh non-root Linux x64 customer/driver runs pass the
installed golden journey, offline model and negative probes. Concurrent runs and
independent cleanup are validated; terminal cancellation exits 130 with verified
owned cleanup. Installation may access public npm; runtime networking is disabled.
Real native service validation remains outside this harness. Required PR CI must
pass before delivery.

**PR outcome:** packaged installation is tested independently of the configured
development environment.

### Work

- Add a separate Linux acceptance image/runner using a fresh non-root HOME,
  minimal PATH and empty Code60 configuration/state.
- Consume built artifacts through a read-only input mount. Run outside the source
  checkout, without development dependencies or the development user's settings.
- Supply a local artifact/registry fixture and bounded fake supervisor commands.
  Production downloads remain fixed to approved release sources; test overrides
  are injected through test-only dependencies.
- Establish baseline coverage for the existing installed tarball, CLI, browser
  assets and offline embedding model. Extend the harness as later phases land;
  do not count skipped future scenarios as passes.
- Preserve traces and independent filesystem/process evidence on the host.
  Add targeted CI coverage without replacing existing browser/package checks.

### Acceptance

A packaged baseline starts with no source-tree imports, uses isolated storage and
loads embeddings without network access. The harness detects missing assets,
wrong architecture and leaked processes. It labels native service behavior as
unproven when a fake supervisor is used.

**Depends on:** Phase 1.

## Phase 3 — Platform payloads and bootstrap artifacts

**Status:** implemented and locally validated. Fresh Linux x64 and native macOS
arm64 payloads pass CLI/backend/assets and real offline CPU/model smoke checks.
The Linux payload completes the shared first-use golden journey and fault probes;
two concurrent runs verify independent cleanup. A private bootstrap containing both
real descriptors passes packed CLI and staging/model acceptance. Required PR CI
and exact-commit native workflow validation must pass before delivery. No artifact
publication, real login service or public setup is included. See the
[artifact workflow](docs/distribution/artifacts.md).

**PR outcome:** release tooling produces verified, installable macOS arm64 and
Linux x64 application payloads plus a small npm bootstrap.

### Work

- Extend the current build/package pipeline to stage production dependency trees
  and native dependencies on the target platform, with no target-side install scripts.
- Include compiled backend/renderer assets, models, provenance and notices.
  Keep the current tarball path available during migration.
- Generate versioned manifests with commit, platform, runtime requirements, archive
  identity, size and SHA-256 digest. Embed the platform descriptors in the exact
  version's npm bootstrap so a mutable download listing is not the trust anchor.
- Use immutable GitHub Release asset URLs for production payloads. Verify downloaded
  bytes against the descriptors before extraction. Extraction rejects traversal,
  escaping links and excessive contents.
- Build the bootstrap with only Node built-ins and its required installer code.
  It must run without importing the full application dependency tree.
- Produce artifacts locally/through CI without publishing them. Keep the source
  package private until the release phase deliberately changes publishing policy.

### Acceptance

Installed payloads work outside the checkout, contain only intended files, pass
CLI/backend/browser/model smoke checks and require no compilation. Wrong hashes,
platforms, malformed archives and missing assets fail before activation.

**Depends on:** Phase 2.

## Phase 4 — Persistent installation, launcher and shell integration

**Status:** implemented and locally validated. Managed installation, cache-independent
launchers, explicit owned repair, atomic activation, non-reclaiming locks and
previewed shell integration are covered by focused and full checks. Linux Bash,
zsh and fish startup cases and concurrent managed golden journeys pass; native
Bash/zsh and packed-bootstrap managed smoke pass on this Mac. Fish is unavailable
on this host and is required on the disposable native CI runner. Required PR CI
and exact-commit native validation must pass before delivery. This is the first
supported layout, with no legacy recognition, migration or compatibility layer.
Public setup remains Phase 5. See [installation internals](docs/distribution/installation.md).

**PR outcome:** an installed release has a durable `code60` command independent
of npm's cache.

### Work

- Implement distribution orchestration in management and filesystem/process
  primitives in platform, preserving public-index imports and existing boundaries.
- Add installation locking, versioned staging, an atomic current-release pointer
  and private receipts identifying owned files and the verified Node executable.
- Install the launcher in `~/.local/bin`; resolve application paths independently
  of the caller's working directory. Diagnose a moved/incompatible Node runtime.
- Detect PATH membership and conflicting `code60` commands. Never overwrite an
  unrelated launcher, follow an unsafe destination or edit a root-owned directory.
- Offer bounded, previewed shell changes for bash, zsh and fish. Respect the
  effective startup locations, including ZDOTDIR. Record only Code60-owned marked
  additions and preserve unrelated content. Unsupported/ambiguous shells receive
  manual instructions.
- Make repeated integration idempotent. Explain when a new terminal is needed
  and print a shell-appropriate current-session PATH command and absolute fallback.
  Never claim a child process changed its parent shell's environment.
- Keep the installation library internal until the complete public setup flow
  lands in Phase 5.

### Acceptance

Test each supported shell in a fresh environment, PATH already present/absent,
unrelated command conflicts, spaces in HOME, custom shell locations, read-only
profiles, repeated setup, interrupted activation and concurrent attempts.
Existing installations remain usable after failed candidates.

**Depends on:** Phase 3.

## Phase 5 — One-command setup, database and browser onboarding

**Status:** implemented on `codex/one-command-setup-and-onboarding`; final acceptance and PR validation in progress.
The confirmed default uses user data storage; declined/non-TTY service setup exits
0 with explicit incomplete status and a continuation command. Delivery requires
packaged setup golden coverage, required Linux CI and exact-commit native fixture
validation; real native login lifecycle remains Phase 9.

**PR outcome:** the packaged `setup` command completes the developer journey.

### Work

- Connect prerequisite checks, installation, launcher integration, service consent,
  registration, database preparation, readiness and browser opening.
- Keep service installation opt-in and default-no. Offer shell integration separately
  only when needed. Declining service setup leaves installed files available and
  prints the exact continuation command.
- Non-TTY setup requires Code60's explicit `--yes` for service changes and never
  waits for input. In that mode, print PATH instructions rather than editing shell
  files. Provide `--no-open` for headless setup.
- Add a narrow private management operation for initial database preparation.
  Accept no arbitrary path, reject browser origins and execute through existing
  application ownership/serialization. Management must not import application directly.
- Reuse database initialization and preferences. Create the default only when
  there is no prior selection and no damaged selection metadata. Preserve custom
  locations, validate existing defaults after interruption, and report missing,
  corrupt, newer-schema or unrelated files without replacement.
- Keep database initialization explicit to setup; normal launches do not manufacture
  replacement databases. No provider verification marker or execution authority is seeded.
- Add combined read-only status. Browser-opening failures still return a usable
  URL; status exposes availability without credentials or automatic repair.
- Adapt first-use browser journeys to start from the setup-created database and
  reach provider verification, project choice, accepted work and Undo. Keep manual
  database creation/selection journeys as independent coverage.

### Acceptance

From clean isolated state, invoke the packaged setup, approve service changes
through the injected supervisor boundary, connect a fake provider through the UI,
open a repository and complete the golden journey. Check SQLite/settings, files,
Git/index and process outcomes independently. Repeat setup, decline consent,
restart, change pairing policy and exercise all database failure cases.

**Depends on:** Phase 4.

## Phase 6 — Bundled Transmission and version-bound execution

**PR outcome:** macOS users receive workflow execution components as part of
Code60 installation without a separate runtime npm download.

### Work

- Package the currently supported staging.20 engine from its exact verified artifact,
  with native helpers prepared at build time. Preserve staging.18 compatibility
  for existing records. Record engine package integrity and native/runtime identities.
- Replace runtime `npx` downloads with the installed pinned launcher. Preserve the
  legacy MCP bootstrap where required by that pinned release; Code60 continues to
  use the authenticated HTTP engine API. External MCP remains an adapter.
- Do not substitute the newer Transmission checkout solely because its package
  name/version looks suitable. Its different API requires a separate compatibility
  migration before it can replace the pinned protocol.
- For pre-existing staging.18/staging.20 state, retain original versions, state
  directories, start keys and run identities. Cache/preserve the required legacy
  executable before claiming that those records survive updates.
- Keep status/read operations inert. Only explicit workflow start/reconnect may
  launch an engine; browser close/backend stop must not cancel its approved work.
- Preserve provider authentication boundaries. Workflow-specific configuration is
  requested when enabling workflows, without assuming application provider login
  supplies Transmission credentials.
- Linux payloads omit unsupported engine binaries and retain an accurate macOS-only
  workflow availability explanation.

### Acceptance

On an isolated Mac, exercise new workflows, both legacy record versions,
pause/resume where supported, guidance, cancellation and uncertain-start recovery.
Stop/restart Code60 while an approved workflow is active and verify engine/process
continuity and original routing. No runtime npm download or compiler invocation occurs.

**Depends on:** Phase 5. Missing reproducible pinned engine/native artifacts block
this phase; they are not grounds to change engine APIs silently.

## Phase 7 — Explicit updates and installation recovery

**PR outcome:** `code60 update` replaces the manual stop/install/repair/start sequence.

### Work

- Resolve the newer stable bootstrap through npm, verify its registry integrity,
  and consume its exact platform descriptors. Do not treat setup as an update.
- Download and validate the candidate before affecting the live backend. Summarize
  interactive/scheduled interruption and request consent before shutdown.
- Verify backend quiescence, activate the candidate atomically, repair pinned
  registration paths and wait for authenticated readiness.
- Keep loaded engines and unfinished workflows on their exact versions. Retain
  previous application files and explicit recovery instructions.
- Record update progress so interruption before/after activation is diagnosable.
  Never automatically downgrade a database or restart uncertain execution.
- Keep user-state files out of payload replacement. Browser Update Manager reports
  the installed version and terminal action; it gains no code-replacement authority.

### Acceptance

Test successful and no-op updates, denied consent, network/hash failures, concurrent
updates, failed shutdown, failed registration, failed readiness and interruption
at activation boundaries. Exercise old workflows and custom databases throughout.
Verify the prior release remains available and recovery never replays work.

**Depends on:** Phase 6.

## Phase 8 — State-preserving uninstall

**PR outcome:** `code60 uninstall` removes owned installation resources predictably.

### Work

- Inspect application and engine ownership first. Refuse uninstall while a workflow
  is active or its state/process ownership is uncertain; explain how to resolve it.
- Request explicit service-stop/removal consent, quiesce the backend, unregister
  owned services and remove only owned releases, launchers and shell additions.
- Preserve databases, configuration, run records, engine evidence and worktrees.
  Do not add a data-purge option in this increment.
- Never remove an unrelated global npm installation or launcher. Explain residual
  resources that belong to another installation.
- Make interrupted/repeated uninstall recoverable. Reinstallation reuses retained
  data after validation.

### Acceptance

Test decline/consent, active and uncertain workflows, partial cleanup, changed
profiles/launchers, repeated uninstall and reinstall. Compare user-state contents
and verify exact service/process removal independently.

**Depends on:** Phase 7.

## Phase 9 — Native lifecycle and release validation gates

**PR outcome:** release evidence covers the real supported installation lifecycle.

### Work

- Extend Linux CI to verify bootstrap and platform payload identity, clean-user
  installation, shell behavior, browser onboarding and update/uninstall fixtures.
- Keep actual launchd/systemd login-service validation in separately authorized
  disposable accounts/VMs. Ordinary development containers remain unprivileged.
- Extend the manually requested macOS workflow to produce and test its exact arm64
  payload and bundled engines. Validate the actual documented minimum OS.
- Add native scenarios for login startup, terminal/browser close, backend shutdown,
  Node relocation, registration repair, update and uninstall.
- Retain exact artifact hashes, runner/OS/runtime identity, QA reports and cleanup
  evidence. A Linux container or fake supervisor cannot satisfy a native gate.
- Align contributing/release instructions and stale ruleset descriptions with the
  actual CI jobs; retain protection and `CI passed` semantics.

### Acceptance

Fresh Linux x64 and macOS arm64 environments complete the install-to-first-task
journey and lifecycle matrix. Every unavailable journey is explicitly blocked.
Release promotion requires evidence for the exact artifacts being promoted.

**Depends on:** Phase 8.

## Phase 10 — Release preparation and npm publishing readiness

**PR outcome:** reviewed release tooling and documentation are ready for an
explicitly authorized public release.

### Work

- Verify control of the npm `code60` name before advertising it. If unavailable,
  block this public command until ownership or an explicitly approved alternative
  is resolved; do not silently switch the documented package.
- Prepare the version bump on a release-preparation branch and commit package and
  lockfile together. Honor the existing required major bump for the browser
  migration and any newly raised supported runtime prerequisite.
- Generate the public bootstrap manifest from the source manifest; retain exactly
  one manually set Code60 version. Deliberately set publishing visibility only for
  intended artifacts.
- Configure manually triggered publishing using
  [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) where supported.
  Account/package publisher setup is a maintainer action, separate from coding.
- Build/validate both platform payloads from the merged tagged revision, publish
  immutable payloads before making their bootstrap discoverable, and promote only
  artifacts with matching native evidence. If rebuilding changes bytes, repeat
  acceptance for the changed artifact.
- Document preview versus stable channels, promotion and recovery. Keep previously
  released payload URLs available to already installed bootstraps.
- Update architecture, quickstart, release guide, runtime/module instructions and
  capabilities to match shipped behavior. Retain advanced manual installation
  documentation during migration.

### Acceptance

A non-publishing rehearsal verifies tag/version/commit agreement, exact payloads,
manifest hashes, npm contents and preview-to-stable ordering. A preview install
exercises the actual registry/release delivery path before stable promotion.

**Depends on:** Phase 9.

**Release boundary:** merging this PR is not publishing authorization. Tagging,
uploading release assets, initial npm account/package operations and stable
promotion require explicit release authorization under the release guide.

## Phase 11 — Website quickstart and launch handoff

**PR outcome:** the website's owning repository has a reviewable landing-page
change matching the validated installation experience.

### Work

- Locate the existing code60.dev source and its instructions before implementation.
  It is not present in this checkout; do not create a new site implicitly.
- Present a concise product explanation, real application screenshot, supported
  platforms, prerequisites and a Copy button for the tested setup command.
- Link prerequisite help, documentation, GitHub and releases. Explain Linux workflow
  limitations and required provider setup before users reach an unsupported path.
- Keep default database/service internals out of the primary introduction. Help
  explains consent, background lifetime, PATH refresh, reopening and updates.
- Use actual released command names and verify onboarding copy against production
  behavior. Do not publish an executable-looking quickstart before its package
  and payloads are available.
- Keep deployment separate from the website PR. If source access is unavailable,
  this phase remains blocked and the release quickstart in Code60's README is the
  supported temporary entry point.

### Acceptance

On both supported platforms, follow the page from a fresh account through copy,
terminal setup, persistent command availability, browser onboarding and first
approved task. Check prerequisite/error guidance and return-after-login behavior.
A first-time user never needs a separate Transmission installation or a database
location decision.

**Depends on:** Phase 10 and a validated public/preview release. Public website
deployment follows stable promotion and requires explicit deployment authorization.

## Completion checklist

- [ ] Dev container and clean installation harness work from fresh environments.
- [ ] Same setup entry point works on both supported platforms.
- [ ] Persistent launcher works immediately when PATH permits; otherwise setup
      provides correct shell integration and current-session instructions.
- [ ] Default database initialization and existing/custom database recovery pass.
- [ ] Native background-service consent and lifecycle are validated.
- [ ] macOS workflows use installed compatible engines and survive backend updates.
- [ ] Update and uninstall preserve user data and refuse uncertain ownership.
- [ ] Exact release artifacts pass native and browser acceptance.
- [ ] npm ownership, publishing setup and immutable payload availability are verified.
- [ ] Release commands and website quickstart match actual shipped behavior.
- [ ] All PRs merged through protected-branch rules; release/deployment actions
      performed only with their required explicit authorization.
