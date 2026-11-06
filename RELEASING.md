# Planning and releasing Code60

Issues describe individual changes. Milestones define planned versions. GitHub
Releases identify shipped versions and provide notes and any downloadable builds.
See [CONTRIBUTING.md](CONTRIBUTING.md) for issue triage and labels.

## Current distribution

Code60 currently supports macOS and Linux. Windows is an architecture non-goal.
The repository builds the desktop app and CLI from source; it does not yet define
an installer packaging, signing, notarization, or automatic-update pipeline.
`npm run build` produces `dist`, not a standalone installer. The package is private
to prevent npm publication; public GitHub source releases are still possible.

Until packaging exists, identify releases as source-only and provide instructions
to install dependencies, build, and start the tagged source. Do not list installers
or claim update support that the release does not provide. Track packaging work
as ordinary issues before promising downloadable desktop builds.

## Milestones

Create one milestone per target version, titled `vX.Y.Z — User outcome`. Assign
issues to it and link their implementing PRs; do not also assign those PRs to the
milestone and count the same work twice. Leave uncommitted backlog ideas without
a milestone. A stable-version milestone may include its preview iterations.

Copy this into the milestone description and replace the placeholders:

```markdown
## Outcome
What can a user accomplish when this version ships?

## Supported environments
List the verified operating systems, minimum versions, and CPU architectures.
State whether this version is source-only or includes installers.

## Required scope
Link the issues essential to the outcome.

## Release criteria
- [ ] Required scope is complete.
- [ ] No unresolved release-blocker issues remain in this milestone.
- [ ] Install/build, launch, primary workflow, and data persistence are verified.
- [ ] CLI and non-interactive behavior are verified.
- [ ] Upgrade and data compatibility are verified, where applicable.
- [ ] Release preparation issue is complete and the release is published.

## Deferred
Link work moved to a later version and explain the decision.
```

Create a maintenance issue titled `Prepare vX.Y.Z release` in the same milestone.
Use the checklist below as its completion criteria. Keep it open until publication;
close the milestone after the final target version ships, not after a preview.
Move deferred issues out of the milestone and record why. A blocker cannot be
deferred if doing so makes the advertised release outcome or compatibility claims
untrue.

## Versioning

`package.json` is the source of the product version. npm maintains the matching
version in `package-lock.json`; do not hard-code a second product version.

- Major: breaking changes to CLI flags, output, exit codes, config, or run records.
- Minor: new features.
- Patch: fixes.

Apply these rules during `0.x` development too. Review database migrations and
downgrade compatibility for every release. Reserve `1.0.0` for a documented
stability and compatibility commitment. A documentation-only commit does not
require a version bump on its own.

Preview versions use a suffix such as `v0.2.0-beta.1` and are marked as prereleases
on GitHub. To start a beta for the next minor version, use
`npm version preminor --preid=beta --message "$release_message"`; increment an existing beta with
`npm version prerelease --preid=beta --message "$release_message"`. Choose the intended final
version explicitly when leaving preview, for example
`npm version 0.2.0 --message "$release_message"`. These are alternatives to the
stable bump below, not commands to run in sequence. Define `release_message` as
shown below first; all version commits follow the same checks and sign-off procedure.

## Release checklist

Copy this into the release preparation issue. Replace conditional items with
verification evidence or an explicit reason they do not apply.

```markdown
- [ ] Scope and supported environments are recorded in the milestone.
- [ ] Required issues are merged; blockers are resolved or explicitly descoped.
- [ ] Version and compatibility impact are reviewed.
- [ ] npm ci, npm run check, and npm run build succeed.
- [ ] Desktop smoke test passes on a machine with a display.
- [ ] CLI help, version, and relevant non-interactive workflows are verified.
- [ ] Primary desktop workflow, cancellation, and data persistence are verified.
- [ ] Upgrade from the previous release and data/downgrade limits are documented.
- [ ] Version commit is signed off; tag matches package.json and package-lock.json.
- [ ] Required CI jobs pass for the exact version commit.
- [ ] Source-build instructions are verified on the claimed platforms.
- [ ] If shipping installers: each platform/architecture artifact is installed and tested.
- [ ] If shipping installers: signing/notarization status is verified and documented.
- [ ] If shipping binaries: SHA-256 checksums and any required updater files are attached.
- [ ] Release notes, known issues, and contributor credits are reviewed.
- [ ] Draft release points at the verified tag and contains all intended assets.
- [ ] Release is published; public links and downloads are verified.
```

## Prepare the version and tag

Start with a clean, up-to-date `main`. Resolve any local work before switching
branches. Run commands from the repository root:

```sh
git switch main
git pull --ff-only
git status --short
npm ci
npm run check
npm run build
npm run test:desktop
node dist/cli/main.js --help
node dist/cli/main.js --version
```

The desktop test needs a display. If unavailable locally, arrange a run on a
machine with a display and record the result before release. CI currently checks
macOS and Linux with Node.js 22.12 and 24; it does not run the desktop smoke test.
Do not infer installer or architecture coverage from the CI matrix.

After choosing the bump, run exactly one version command. This example makes a
patch release. The message adds the DCO sign-off to npm's automatic version commit
using your configured Git identity. Verify that `git config user.name` and
`git config user.email` identify you before proceeding:

```sh
release_message=$(printf 'chore: release v%%s\n\nSigned-off-by: %s <%s>' "$(git config user.name)" "$(git config user.email)")
npm version patch --message "$release_message"
```

[`npm version`](https://docs.npmjs.com/cli/v11/commands/npm-version/) updates the
package files, commits them, and creates the `v<version>` tag. Check the commit's
`Signed-off-by` trailer with `git log -1 --format=full`. Do not amend a commit
after tagging it: the tag must identify the tested version commit.

Validate the bumped version and rebuild so the output reports that version:

```sh
npm run check
npm run build
npm run test:desktop
node dist/cli/main.js --version
git status --short
git push --follow-tags
```

Stop on any failure. Do not publish until the working tree is clean, the tag and
package versions agree, and all required CI jobs pass for that commit. If main
advances and a push is rejected, reconcile the changes and repeat validation;
do not force-push main or move a published release tag.

## Draft, verify, and publish

1. Open [Releases](https://github.com/CodeManufactoryLLC/code60/releases) and create
   a draft using the existing pushed tag. Do not create a different tag in the UI.
2. Fill in the release-note template below. Generated notes can help identify PRs,
   but review them and explain user-visible effects and compatibility changes.
3. For a source-only release, remove the installer table and clearly say that the
   GitHub source archives are not installers. Include the source-build steps below.
4. When packaging exists, build from the exact tag, upload the tested installers
   and SHA-256 checksums, and attach any updater files the product actually needs.
5. Mark previews as prereleases. Make the intended stable version the latest
   release; keep previews out of the stable download path.
6. Review the complete draft, then publish and verify its public links and assets.
7. Close the release preparation issue. For the final target version, close the
   milestone and link the published release from its description.

Upload every intended asset before publishing. This is also required if repository
release immutability is enabled. See
[GitHub's release documentation](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).
For a bad published build, document the problem and ship a new patch version;
do not silently replace binaries or retag the release.

## Release-note template

Replace placeholders, remove empty sections, and link the relevant issues/PRs.

```markdown
# Code60 vX.Y.Z

What users can now accomplish. State preview or source-only status here.

## Download
| Platform | Architecture | Installer |
| --- | --- | --- |
| Verified platform and minimum version | Verified architecture | Asset link |

Link checksums and describe signing/notarization status for downloadable builds.
For source-only releases, replace this table with source-build instructions.

## New
- User-visible capability. (#issue)

## Fixed
- User-visible problem resolved. (#issue)

## Changed
- Behavior or compatibility changes and required user action.

## Installation and upgrade
Supported environments, prerequisites, installation steps, migrations, backup
needs, and any data compatibility or downgrade restrictions.

## Known issues
- Limitation, workaround, and tracking issue.

## Contributors
Credit contributors and link the full changelog or comparison with the prior tag.
```

For source-only notes, replace `vX.Y.Z` with the actual tag and verify these steps
in a fresh directory on each claimed platform:

```sh
git clone --branch vX.Y.Z --depth 1 https://github.com/CodeManufactoryLLC/code60.git
cd code60
npm ci
npm run build
npm start
```

State the required Node.js version (currently 22.12 or later) and any agent setup
needed for the primary workflow. To use the CLI from this checkout, run
`node dist/cli/main.js --help`. Agents authenticate through their own CLIs.
