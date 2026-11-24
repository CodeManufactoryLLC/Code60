# Contributing to Code60

Read the [security policy](SECURITY.md) for agent permissions, sensitive local
data, and safeguards and limitations. Report suspected vulnerabilities privately
to [support@code60.dev](mailto:support@code60.dev), not through public issues.

Use the [official terminology](TERMINOLOGY.md) for component names.

## Issues and planning

Use the [issue forms](https://github.com/CodeManufactoryLLC/code60/issues/new/choose)
for bug reports, feature requests, and maintenance. Search existing issues first.
Keep each issue focused on one problem or independently verifiable outcome. Break
large proposals into linked issues before implementation. Documentation work uses
the maintenance form and the `documentation` label.

Maintainers clarify acceptance criteria, check scope against `ARCHITECTURE.md`,
apply labels, and remove `needs-triage` once a decision is recorded. Accepted work
can remain in the backlog without a milestone. Assign a milestone only when the
work is intended for that version; milestone dates are targets, not guarantees.
Use [RELEASING.md](RELEASING.md) for milestone and release templates.

Link implementing pull requests with `Closes #<issue-number>`. Close an issue when
its acceptance criteria are met and the implementation is merged. A closed issue
means implemented; the release notes establish which published version includes
the change. Close duplicates or declined requests with an explanation and, when
applicable, a link to the existing issue.

### Labels

The following labels are the shared vocabulary. Colors are six-digit hex values.
Maintainers assign priority and platform labels during triage; selecting a platform
in an issue form does not automatically apply a platform label.

| Label | Color | Use |
| --- | --- | --- |
| `bug` | `d73a4a` | Existing behavior is broken. |
| `enhancement` | `a2eeef` | New or improved user-visible behavior. |
| `maintenance` | `ededed` | Tooling, dependencies, refactoring, or release preparation. |
| `documentation` | `0075ca` | Documentation additions or corrections. |
| `needs-triage` | `fbca04` | Awaiting a maintainer's scope and priority decision. |
| `needs-info` | `d876e3` | Awaiting details needed to proceed. |
| `blocked` | `b60205` | Cannot proceed; link the blocking dependency in the issue. |
| `priority:high` | `b60205` | Address before normal-priority work. |
| `priority:normal` | `fbca04` | Normal scheduling priority. |
| `priority:low` | `c5def5` | Can wait behind other accepted work. |
| `platform:macos` | `bfd4f2` | Specific to macOS. |
| `platform:linux` | `bfd4f2` | Specific to Linux. |
| `good first issue` | `7057ff` | Small, clear scope with guidance and no unresolved design decisions. |
| `help wanted` | `008672` | Contributions are welcome. |
| `release-blocker` | `b60205` | Must be resolved or explicitly removed from the target release's scope. |

Use one priority label at a time and only the relevant platform labels. Existing
labels such as `accessibility`, `duplicate`, `invalid`, `question`, and `wontfix`
remain available. A platform label does not imply platform support; expanding
support requires updating the architecture and adding validation.

## Setup and checks

Use Node 24 and npm on macOS Apple Silicon or Linux x64:

```sh
ONNXRUNTIME_NODE_INSTALL=skip npm ci
npm run prepare:models
npm run dev
```

Development serves React through Vite Fast Refresh and an isolated foreground
Code60 Gateway. It prints the loopback URL and, when enabled, a pairing code; no login service or native
window is created. Gateway changes restart that development Gateway; renderer
changes preserve it.

Run `npm run check` before every commit. It validates instructions, types, Biome,
Knip and one coverage-enabled unit suite. Run `npm run test:browser` for behavior,
bridge, fixture, configuration and packaging changes. Headless Chromium runs on
the host without Electron or a display. Tests use isolated state and fake providers.
They must never require live agents or credentials.

`npm run build` compiles the Gateway/management CLI and bundled renderer.
`npm run package:app` creates the npm tarball after verifying prepared model assets.
`npm run test:packaged` installs it in a temporary prefix and checks the CLI,
assets, foreground Gateway and offline embedding model without service enrollment.
`npm run test:rag:model` exercises the actual offline model and worker lifecycle.

For Transmission development on native macOS arm64, run `npm run prepare:engines`
after building to stage both pinned engines and their native Codex dependency from
the separate committed lockfile. A full build clears these generated assets.
Packaging prepares them automatically on macOS; Linux omits them. After native
packaging, `npm run test:transmission` runs the real engine/ACP/Codex browser
journey with an isolated fake model endpoint, never a live provider. It retains
traces, identities and process cleanup evidence under `test-results/transmission-native`.

For independent Linux installation acceptance, build the tarball and run
`npm run test:packaged:clean` on the host. The [clean-install guide](test/clean-install/README.md)
describes the fresh customer environment, separate browser driver, online installation
and offline runtime checks. It reuses the complete golden journey and preserves
evidence under `test-results/clean-install`. This additional CI gate does not
replace existing browser, package or model checks.

### Linux development container

Use the [Linux development container](.devcontainer/README.md) for a non-root
Linux x64 environment with isolated dependencies and model/browser caches.
After host dependency installation, use `npm run devcontainer -- start` to
prepare dependencies/models and run Code60 with host-browser forwarding, without
an editor. Ctrl+C cleans up. Alternatively, run `npm run devcontainer -- prepare`
and use the documented editor or terminal workflow. Docker must already be running.
Always finish a test session with `npm run devcontainer -- down`; it removes owned
containers and exported images while preserving caches, the private provider home
and test evidence. Global npm provider tools install to the persistent home prefix;
sign in inside the container, independently of host credentials.

Preparation reserves a stable gateway/Vite port pair for each worktree and generates
matching editor forwarding without remapping. Agents in separate worktrees can
develop and test concurrently; cleanup affects only its own worktree. Close existing
forwarding before preparing again. Ordinary host development keeps its
existing allocated ports. The container does not validate native login services.

### Shared-host development

Assume another agent may be using this host, even when no container is running.
Follow the [agent ownership rules](AGENTS.md#concurrent-work-on-a-shared-host).
Confirm your canonical checkout, branch, changes and registered worktrees before
editing. Use the assigned worktree and a task-owned branch; create a separate
worktree for an independent task instead of changing another checkout's branch.
Record these identities and your resource/evidence paths in the QA report or handoff.

For the container workflow, run these commands from your own checkout:

| Location | Work |
| --- | --- |
| Host | Initial CPU-only dependency install for the pinned CLI; `npm run devcontainer -- prepare`, `up`, `start`, `exec` and `down`; authenticated Git fetch/commit/push and PR operations. |
| Container | Explicit dependency/Chromium/model preparation, development, builds and checks through `exec` or the isolated editor terminal. Use synthetic Git identities in test repositories. |

For example, `npm run devcontainer -- exec npm run check` runs Linux checks with
that worktree's dependencies. Plain `npm run check` on the host validates the
native host environment. Record which environment you used; keep host/container
dependencies and build output separate. Native host development is still supported. After a containerized package build,
`npm run test:mcp:native` checks the installed MCP adapter on the selected native
macOS/Linux Node 24 host using a disposable installation/home and synthetic private
broker. It never installs a service. Set `CODE60_NATIVE_EVIDENCE` to this task's QA
folder to retain its result and dependency cache. Run this targeted native check
separately from the full emulated suite and record process/listener cleanup.

Linked worktrees share refs, stashes, repository configuration and hooks. Use
command-local `git -c` options for temporary settings. If you temporarily stash
your own changes, record the resulting commit ID and apply that exact stash;
verify ownership again before dropping it. Another agent can move stash indices.
Do not clear the stash list, alter another task's branch, change shared hook policy,
or prune worktrees as routine task cleanup.

Inspect a conflicting listener's identity before stopping it. If it belongs to
another task or ownership is unclear, coordinate with its owner/user; do not kill
it just to obtain a port. Do not restart Docker, change its context/resource
allocation, or use broad process-killing/global cleanup commands to repair a
single task. Worktree-scoped container labels do not prove that every process in
that container belongs to your current session.

Containers share the host's CPU, memory and disk. Keep their existing worker caps
and schedule heavy jobs to fit available resources. In particular, avoid running
the full native host suite alongside emulated container suites: existing
five-second Git tests timed out when those overlapped during validation, while
two concurrent container suites passed without the competing host suite. Preserve failure logs
and diagnose contention before rerunning; do not raise timeouts or weaken gates
to hide it. Remove only your task's confirmed resources, preserving caches/evidence
and worktrees still owned by other tasks.

### Workflow QA

Use the [workflow QA skill](.factory/skills/qa/SKILL.md). The built-path golden
journey is `test/browser-workflow.e2e.ts`: first use → plan → acceptance → automatic
edits → diff → attachment → refresh → declined Undo → confirmed Undo. It checks
independent files, index, HEAD and worker evidence. Supporting static renderer
fixtures are labeled separately from complete Gateway journeys.

Run a focused journey with:

```sh
npm run test:browser -- --grep "browser: first use"
```

Write evidence and gaps under ignored `test-results/qa/`. Missing browsers/assets
or native environments mean BLOCKED, not a unit-test substitute. Never install a
real service during routine tests. Use injected native controls for ownership and
handoff tests; actual login-service lifecycle validation remains a native release gate.

### Optional Git hooks

Nothing installs hooks during `npm ci`. Opt in explicitly:

```sh
npm run hooks:status
npm run hooks:install
```

The checked-in pre-commit hook runs `npm run check:precommit`: instructions,
typecheck, Biome and Knip, in that order. It never formats, stages or rewrites
files. Keep running full `npm run check` before **every** commit; this quicker
hook does not run coverage or browser tests.

Installation refuses existing hook-path policy or active default hooks rather
than hiding them. Review any conflict manually; there is no force option.
`npm run hooks:uninstall` removes only this project's local `.githooks` setting,
not hook files or another scope's configuration. Hook configuration may be shared
by linked worktrees. Do not install on someone else's behalf.

### Operational recovery

Follow the [recovery runbooks](docs/runbooks/README.md) for scheduler registration,
low disk, unavailable diagnostics and damaged Relay history. Read-only diagnosis
comes first; preserve history/worktrees/locks and obtain permission for changes.
Desktop Stop all and quit do not stop service-owned automations.

### Coverage and unused-code gates

`coverage-baseline.json` versions overall and critical-file floors for statements,
branches, functions and lines. The checker never rewrites it. Add meaningful tests
before raising a floor; lowering a floor requires an explicit reviewed baseline
change with a reason. Do not exclude executable code to improve coverage. The
matching Vitest V8 provider includes unimported production files.
Only tests and declarations are excluded. Keep the coverage
provider exactly aligned with Vitest when changing either dependency.

`npm test` and `npm run test:watch` remain available without coverage. `check`
runs the suite only once. CI retains HTML and machine-readable summaries for
seven days on Linux Node 24 and in native macOS Node 24 validation.
Native runs remain required evidence for platform claims; local POSIX runs do not
substitute for native login-service validation.

Knip follows the gateway/management entries, renderer/Vite workers, MCP sidecar,
tests, dynamically launched fake agents/Docker fixtures and manual icon generator.
Vite's configured renderer root and HTML script provide its renderer entry and
worker imports; the redundant global renderer entry is intentionally omitted.
Its project patterns include source and tooling, not generated builds, coverage,
packaged output or native binaries. Native helper source, bundled fonts/icons and
worker assets remain discoverable through build/Vite/packaging entry points.
`test/unused-gates.test.mjs` also runs Knip on a fixture containing deliberate
unused files, exports and a dependency, without suppressing categories.

The external-binary exception is `mkfifo`, used by POSIX storage fixtures.
It does not exclude code, exports or issue categories from analysis.

The only dependency exception is `@wyw-in-js/shared`:
`test/dependency-compatibility.test.ts` intentionally inspects these installed
transitive dependencies to verify security overrides without adding them as
runtime dependencies.
Document any new exception narrowly. Remove code only after verifying it is not
an entry point or dynamic asset.

Desktop operational logs use fixed, allowlisted metadata only. Do not add prompts,
provider/tool payloads, paths, commands, environment values or raw error objects.
See [diagnostic logging](ARCHITECTURE.md#desktop-diagnostic-logging) and
[the security policy](SECURITY.md#desktop-diagnostic-logs) before instrumentation.

### Investigating flaky tests

Reproduce a flaky test before changing it, on an otherwise idle machine so other
work does not distort the result. Repeat the single test, then the full suite,
because some failures appear only under the suite's own parallel load:

```sh
for i in $(seq 1 20); do npm test >"/tmp/unit-$i.log" 2>&1 || echo "run $i failed"; done
npm run test:browser -- --grep "<test name>" --repeat-each=10 --retries=0
```

If it still does not fail, add a temporary delay at the suspected race point to
show the failure on demand, and do not commit it. Fix the test by waiting for the
state it depends on, not for time:

- Retry the action together with its assertion, using `vi.waitFor` or Playwright
  `expect(...).toPass()` with short per-attempt timeouts.
- Wait for the actual state, such as a process reporting its ID or a new
  workspace appearing, and fail as soon as the operation settles without reaching it.
- Never add retries, and do not raise a timeout to hide a race. When a deadline
  under test must outlast fixture startup, raise only that test's deadline and
  explain why in a comment, as in `src/application/environment.test.ts`.

Record the failure rate before and after the fix in the pull request.

### Browser tests

The registered headless Playwright suite runs the bundled React app against an
isolated Code60 Gateway. Install Chromium with `npx --no-install playwright install
chromium` when needed. Browser close, explicit Gateway stop and Gateway restart
are different lifecycle events and need separate assertions. Keep provider/process
and filesystem outcomes independent of browser snapshots.

Electron container/installer harnesses are removed. If separate Docker checks are
added, clean up only their owned containers, temporary images, networks and
volumes; preserve caches and other work's resources. Never globally prune Docker.

## Dependency updates

[Dependabot](.github/dependabot.yml) checks npm dependencies (including development
tools) and GitHub Actions every Monday at 09:00 UTC. It updates the npm manifest
and lockfile together. Minor and patch updates are grouped separately for
production dependencies, development dependencies, and Actions; major upgrades
remain separate PRs for focused review. Updates use the `maintenance` label and
must pass the normal PR checks before maintainers merge them. Nothing is
automatically merged.

Scheduled version updates start once the configuration is merged into `main`.
Enable Dependabot alerts and security updates in the repository's security
settings to receive vulnerability fixes independently of the weekly schedule.

### Declining an update

Close the Dependabot PR with a comment giving the reason and when to revisit it.
Do not add `ignore` or `allow` rules to the configuration; `test/dependabot.test.mjs`
rejects them, so run the full `npm run check`, not only lint. For example,
`@types/node` majors track the minimum supported Node.js version (22.12) and are
declined until `engines` in `package.json` changes.

### Dependency overrides

`overrides` in `package.json` patch vulnerable transitive copies that their parent
packages have not updated yet. Each override is scoped to the parents that need it,
never applied globally, and must name a fixed version; do not use one to silence an
advisory without a fix.

| Override | Parents | Reason |
| --- | --- | --- |
| `dompurify` → `3.4.17` | `monaco-editor` | Monaco pins DOMPurify 3.4.15, which has a critical advisory. |

An override that crosses a major version needs tests of the APIs its callers use.
Remove an override once every listed parent's own dependency range resolves a fixed version. Delete it, run
`npm install`, and confirm the result:

```sh
npm ls minimatch dompurify
npm audit --package-lock-only --ignore-scripts --include=dev
```

Then update or remove the matching compatibility tests and run `npm run check`
and `npm run test:browser`, because the package and renderer
build use these packages. Commit the lockfile change.

## Security triage and ownership

The sole maintainer, `@matthewholliday`, owns security triage through
[CODEOWNERS](.github/CODEOWNERS). Ownership routes review; it does not require
an approving review or change the zero-required-approvals policy.

Review the [Security review workflow](.github/workflows/security-review.yml)
on every PR and after scheduled scans. Triage CodeQL findings in code scanning,
dependency advisories in the job summary/artifact, and Gitleaks locations in
workflow logs. Record the impact, decision, and fix or follow-up without copying
credentials or private task data into issues. A passing CodeQL job means analysis
completed, not that all findings are resolved.

Run `npm run scan:secrets` before submitting changes. Exit 1 means findings;
exit 2 means the scan failed to complete and must be repaired and rerun, not
waived as clean. Review false positives in context rather than adding broad
exclusions or bypass comments. The scanner checks tests and environment files
too, so use clearly synthetic fixtures, never real credentials.

If a real credential is found, revoke or rotate it first, review its use, and
remove it from current files. Deleting the latest copy does not remove history
exposure. Coordinate any history cleanup explicitly; do not rewrite published
history as an automatic response. Report vulnerabilities privately to
[support@code60.dev](mailto:support@code60.dev).

GitHub's native secret scanning is optional and is not enabled by these files.
The repository uses CI scanning, not push protection; these changes do not
modify live GitHub settings.

For a read-only protection check, use the ruleset lookup and GET requests in
[Verify](.github/rulesets/README.md#verify), not the POST/PUT application steps.
Confirm active enforcement, no bypass actors, required PRs and **CI passed**,
and zero required approving reviews. Checked-in policy tests do not prove that
live settings match.

## Architecture and changes

Read [ARCHITECTURE.md](ARCHITECTURE.md), [AGENTS.md](AGENTS.md), and the
`src/<module>/AGENTS.md` instructions for the modules you change. Keep module
boundaries intact and import other modules through their `index.ts` entry points.
Add tests for changed behavior and update relevant application and scheduler documentation
when the user-visible behavior changes.

Keep pull requests focused. Explain what changed, why, and which checks you ran.
Complete the [pull request template](.github/pull_request_template.md), including
test results, checks not run and why, related issues, and compatibility risks.
Mark inapplicable sections explicitly and redact sensitive information from
supporting evidence.
Use conventional commit messages, such as `fix: handle an unavailable agent`.

## Protected branches

Changes to `main` (the default branch) and `dev`, if created, must go through a
pull request with resolved discussions and **CI passed**. Approving reviews are
welcome but not required while the project has a single maintainer.
Keep the PR branch up to date with its target. New commits dismiss stale
approvals. Direct pushes, force pushes, and branch deletion are blocked, including
for administrators; feature branches are unaffected.

The [versioned ruleset](.github/rulesets/README.md) documents the policy and its
administrator-only application and verification. Release version changes also
use a PR; tag the merged commit as described in [RELEASING.md](RELEASING.md).

## License and sign-off

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).

Sign off each commit under the
[Developer Certificate of Origin 1.1](https://developercertificate.org/):

```sh
git commit -s
```

The `Signed-off-by` trailer certifies that you have the right to submit the
contribution under the project's license. Use your own name and email.

## Browser and package CI

PRs and main pushes run Linux Node 24 unit/static/coverage checks, browser journeys
and clean-prefix npm package/offline-model smoke tests. A dependent clean-install
job tests that exact package in isolated customer/driver containers. The aggregate required
check remains **CI passed**. Manual native validation runs on macOS Apple Silicon
with Node 24. No native installer or automatic publisher remains. Actual launchd
and systemd login/update lifecycle checks are required before release claims.

## Platform distribution candidates

See the [artifact workflow](docs/distribution/artifacts.md) for `npm run package:payload`,
`npm run test:payload`, `npm run package:bootstrap` and clean installed-payload
acceptance. Build Linux in the pinned amd64 container and macOS on Apple Silicon.
Retain per-run evidence and remove owned test resources; do not publish artifacts,
install a login service or enable public setup during this contributor workflow.

## Managed installation acceptance

See [installation internals](docs/distribution/installation.md). Standard tests build
the narrow Node-only distribution closure for real launcher subprocesses.
`npm run test:installation` exercises isolated shell fixtures; require fish in the
Linux container and disposable native runner. The managed clean-install mode adds
the full installed production golden journey after removing bootstrap/npm caches.
No contributor check edits your profiles or installs your login service.

## Setup development

See [candidate setup behavior](docs/distribution/setup.md) for consent, status,
database defaults and failure recovery. After preparing a platform payload, run
`npm run test:setup` for real CLI/gateway integration through an isolated supervisor
fixture. On the Docker host, also run
`npm run test:packaged:clean -- --setup release/payloads/linux-x64.json` for the full
setup-created-database browser journey. Keep the manual database journey and all
existing package/model regressions. No real user service or host profiles are
changed by acceptance; retain evidence and verify owned resource cleanup.

## Update development

See [explicit updates and recovery](docs/distribution/updates.md). After packaging,
run `npm run test:update` for installed runtime/browser acceptance with isolated
state and the bounded supervisor. On the Docker host also run
`npm run test:packaged:clean -- --update release/payloads/linux-x64.json` for the
offline customer/driver journey. Preserve custom databases, prior releases,
workflow bindings and independent filesystem/Git/process evidence. No check
installs a real host service or edits host profiles. Host tooling and both builds
share the Node-only platform verifier without importing development dist.
