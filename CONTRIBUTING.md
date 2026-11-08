# Contributing to Code60

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

- `npm run check`: typecheck, Biome lint and formatting checks, and unit and integration tests.
- `npm run format`: apply formatting and safe lint fixes.
- `npm run build`: compile the CLI and desktop main process and build the renderer.
- `npm run dev`: build and start the desktop app with rebuilds on changes.
- `npm run test:desktop`: build and run the Electron Playwright tests. A display is required.

Run `npm run check` before each commit. Run `npm run test:desktop` for desktop
changes. Tests must not require live agents, credentials, or network services.
Place unit tests beside the code as `*.test.ts`; cross-cutting tests live in `test/`.

## Architecture and changes

Read [ARCHITECTURE.md](ARCHITECTURE.md), [AGENTS.md](AGENTS.md), and the
`src/<module>/AGENTS.md` instructions for the modules you change. Keep module
boundaries intact and import other modules through their `index.ts` entry points.
Add tests for changed behavior and update CLI help and relevant documentation
when the user-visible behavior changes.

Keep pull requests focused. Explain what changed, why, and which checks you ran.
Use conventional commit messages, such as `fix: handle an unavailable agent`.

## Protected branches

Changes to `main` (the default branch) and `dev`, if created, must go through a
pull request with one approving review, resolved discussions, and **CI passed**.
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

Require the **CI passed** check for merges. Routine PRs use Linux for checks,
Electron UI tests, and DEB/AppImage packaging and installation tests. macOS runs
only for manually requested release candidates. See [RELEASING.md](RELEASING.md)
for local packaging, required GitHub settings, and the signed installer workflow.
