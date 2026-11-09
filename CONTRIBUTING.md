# Contributing to Code60

Read the [security policy](SECURITY.md) for agent permissions, sensitive local
data, and safeguards and limitations. Report suspected vulnerabilities privately
to [support@code60.dev](mailto:support@code60.dev), not through public issues.

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
| `platform:windows` | `bfd4f2` | Windows requests; Windows is currently unsupported. |
| `good first issue` | `7057ff` | Small, clear scope with guidance and no unresolved design decisions. |
| `help wanted` | `008672` | Contributions are welcome. |
| `release-blocker` | `b60205` | Must be resolved or explicitly removed from the target release's scope. |

Use one priority label at a time and only the relevant platform labels. Existing
labels such as `accessibility`, `duplicate`, `invalid`, `question`, and `wontfix`
remain available. A platform label does not imply platform support; expanding
support requires updating the architecture and adding validation.

## Setup and checks

Use macOS or Linux with Node.js 22.12 or later and npm.

```sh
npm ci
npm run check
```

Useful scripts:

- `npm run check`: typecheck, Biome checks, Knip, and one coverage-enabled unit/integration suite.
- `npm run test:coverage`: prepare Windows helpers, run Vitest once, write JSON summary/HTML to `coverage/`, and enforce all four coverage metrics.
- `npm run check:unused`: check unused files, exports, types and dependencies with Knip.
- `npm run test:logs:performance`: build, then measure production logging in a fresh process against an exact 20 MiB fixture, including first query, 24 saved plus 24 column conditions, 200-row pages, event-loop delay, memory and dirty shutdown. Run `node scripts/benchmark-logs.mjs --fragmented` afterward for a seven-day, 10,066-segment worst case.
- `npm run format`: apply formatting and safe lint fixes.
- `npm run scan:secrets`: scan full fetched Git history and current files with checksum-pinned Gitleaks; requires GitHub access and `tar`.
- `npm run build`: compile the CLI and desktop main process and build the renderer.
- `npm run dev`: build and start the desktop app with rebuilds on changes.
- `npm run test:desktop`: build and run the Electron Playwright tests. A display is required.
- `npm run test:desktop:container`: build and run the same desktop suite in Linux with Xvfb, without opening windows on your Mac.

Run `npm run check` before each commit. Run `npm run test:desktop` for desktop
changes. Tests must not require live agents, credentials, or network services.
Place unit tests beside the code as `*.test.ts`; cross-cutting tests live in `test/`.

### Coverage and unused-code gates

`coverage-baseline.json` versions overall and critical-file floors for statements,
branches, functions and lines. The checker never rewrites it. Add meaningful tests
before raising a floor; lowering a floor requires an explicit reviewed baseline
change with a reason. Do not exclude executable code to improve coverage. The
matching Vitest V8 provider includes unimported production files, including the
CommonJS preload. Only tests and declarations are excluded. Keep the coverage
provider exactly aligned with Vitest when changing either dependency.

`npm test` and `npm run test:watch` remain available without coverage. `check`
runs the suite only once. CI retains HTML and machine-readable summaries for
seven days on Linux Node 22.12/24 and in native Windows/macOS Node 24 validation.
Native runs remain required evidence for platform claims; local POSIX runs do not
substitute for Windows helper/ACL or installer validation.

Knip follows the CLI, desktop main/preload, renderer/Vite workers, MCP sidecar,
tests, dynamically launched fake agents/Docker fixtures and manual icon generator.
Vite's configured renderer root and HTML script provide its renderer entry and
worker imports; the redundant global renderer entry is intentionally omitted.
Its project patterns include source and tooling, not generated builds, coverage,
packaged output or native binaries. Native helper source, bundled fonts/icons and
worker assets remain discoverable through build/Vite/packaging entry points.
`test/unused-gates.test.mjs` also runs Knip on a fixture containing deliberate
unused files, exports and a dependency, without suppressing categories.

The only dependency exceptions are `@wyw-in-js/shared` and `app-builder-lib`:
`test/dependency-compatibility.test.ts` intentionally inspects these installed
transitive dependencies to verify security overrides without adding them as
runtime dependencies. `mkfifo` is an OS binary used by POSIX file-safety tests.
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
npm run test:desktop:container -- --grep "<test name>" --repeat-each=10 --retries=0
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
  explain why in a comment, as in `src/desktop/environment.test.ts`.

Record the failure rate before and after the fix in the pull request.

### Desktop tests in a Linux container

Install and start Docker Desktop with a Linux engine, and make sure `docker info`
responds in your selected Docker context. You need Node.js and npm on the host,
but do not need host `node_modules` or a display server for this command:

```sh
npm run test:desktop:container
npm run test:desktop:container -- --grep "search"
```

The runner uses the engine's native architecture (Linux ARM64 on Apple Silicon,
Linux x64 on Intel), even if `DOCKER_DEFAULT_PLATFORM` specifies an emulated
architecture. It runs all tests selected by `playwright.config.ts`, including
agent discovery. Packaged-app and DEB/AppImage installer tests remain separate.
This checks Linux behavior, not macOS-specific integration.

The first run downloads the Node.js 24 Bookworm image, Linux display dependencies,
npm packages and Electron. Later runs reuse Docker build layers; changes to the
package manifests reinstall dependencies with `npm ci`. Current working files,
including uncommitted and untracked source, are copied into the image. Host
dependencies, build output, Git metadata and local `.env`/`.npmrc` files are
excluded. The Mac's `node_modules` and `dist` are never mounted or changed.

Electron runs as a non-root user with its Chromium sandbox enabled, under Xvfb
at 1280×1024. The container has a 1 GiB shared-memory limit and uses a vendored
seccomp profile permitting Chromium's user namespaces. It needs no privileged
mode, host display, credentials, or live agents. The Docker engine must allow
user namespaces; if sandbox startup fails, repair that engine configuration
rather than passing `--no-sandbox`.

Output streams to your terminal. Each run prints a unique host directory under
`test-results/container/` containing screenshots and any retained failure traces.
It is the only host directory mounted into the container, and is made writable
by the non-root container user. Use a local Docker Desktop context with repository
file sharing enabled; a remote engine cannot mount your Mac's artifact path.
To inspect a trace after installing host dependencies:

```sh
npx --no-install playwright show-trace test-results/container/<run>/<test>/trace.zip
```

Test/build failure returns a nonzero exit status. On success, failure, or Ctrl+C,
the runner removes its container and exported test image, preserving host
artifacts and BuildKit dependency/build caches. Each run owns a uniquely tagged
and labelled image, so concurrent runs cannot delete one another's images.
Docker checks time out after 10 seconds; image build and attached test execution
each have a 20-minute outer limit, in addition to Playwright's existing timeouts. Cleanup is
bounded and prints the exact removal command if the daemon cannot complete it.
No containers belonging to other runs are stopped, and Docker settings are not
changed automatically.

After every Docker test session, including failures and interruptions, verify
that both its containers and built images have been removed. The runner normally
handles this automatically; if cleanup fails, use its printed removal command once the
Docker engine is responsive. Also remove temporary images, volumes, and networks
created solely for manual test or debugging runs. Do not retain built test images
as "reusable" without an explicit user request. Dependency/build caches are
separate Docker resources and remain cached; report that retention separately
from image cleanup. Preserve host screenshots and traces. Scope cleanup to the
resources created by your session; never use global Docker prune commands or
remove resources belonging to other work. Report any cleanup left incomplete.

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
| `minimatch@>=7 <11.0.1` → `11.0.1` | `@linaria/react`, `@wyw-in-js/shared`, `@electron/universal`, `app-builder-lib` | GHSA-g3hv-75wg-m249 in the 9.x and 10.x copies. Unaffected 3.x and 5.x copies are unchanged. |
| `dompurify` → `3.4.17` | `monaco-editor` | Monaco pins DOMPurify 3.4.15, which has a critical advisory. |

An override that crosses a major version needs tests of the APIs its callers use,
as in `test/dependency-compatibility.test.ts`. Remove an override once every listed
parent's own dependency range resolves a fixed version. Delete it, run
`npm install`, and confirm the result:

```sh
npm ls minimatch dompurify
npm audit --package-lock-only --ignore-scripts --include=dev
```

Then update or remove the matching compatibility tests and run `npm run check`
and `npm run test:desktop:container`, because electron-builder and the renderer
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
Add tests for changed behavior and update CLI help and relevant documentation
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

## Installer CI

Require the **CI passed** check for merges. Routine PRs and pushes to main use
only Linux for checks, Electron UI tests, and DEB/AppImage packaging and
installation tests. Windows and macOS run only for manually requested release
candidates. See [RELEASING.md](RELEASING.md) for local packaging, required GitHub
settings, and the signed installer workflow.
