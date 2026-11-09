# Planning and releasing Code60

See [the roadmap](ROADMAP.md) for the planned version sequence and links to the
GitHub issues and milestones that own implementation scope and progress.

Issues describe individual changes. Milestones define planned versions. GitHub
Releases identify shipped versions and provide notes and any downloadable builds.
See [CONTRIBUTING.md](CONTRIBUTING.md) for issue triage and labels.

## Installers and supported targets

The pipeline builds a signed, notarized Apple Silicon macOS DMG and Linux x64
DEB/AppImage installers, plus a signed per-user NSIS installer for Windows 11 x64.
CI uses macOS 15, Ubuntu 24.04 and Windows Server 2025 x64; Windows 11 desktop
acceptance must also be recorded on native x64 hardware. ARM64 development or
x64 emulation is not that acceptance. Older Windows, Windows ARM64 and Intel
macOS are not supported targets. See [Windows setup](WINDOWS.md).

The desktop bundles Electron and its Node.js runtime. Users do not need Node or
npm to launch it. Git and agent CLIs remain external prerequisites: install and
authenticate the chosen agent separately. Finder and Linux desktop launches
automatically discover tools using your interactive login shell's PATH, then the
inherited PATH and common installation directories (`~/.local/bin`, `~/bin`,
Homebrew on macOS, `/usr/local/bin`, and standard system directories). This covers
agents such as Droid and tools such as Git and `npx`, including version-manager
paths configured by your shell. Shell discovery waits at most three seconds;
if the shell fails or hangs, the app continues with inherited and fallback paths.
Restart Code60 after changing your shell PATH. No config edit is required for
ordinary installations. An absolute executable path in the existing
`~/.config/code60/config.json` (or `$XDG_CONFIG_HOME/code60/config.json`) remains an
optional override for unusual installations. Agents launched through `npx` still
need their own Node/npm setup; the bundled desktop runtime does not supply `npx`.
The installer does not install the headless `code60` command; its existing
source-based `npm run install:global` workflow is unchanged. The Linux desktop
launcher is `code60-desktop`.

Install or upgrade while Code60 is closed:

- macOS: open the DMG and copy Code60 to Applications, replacing the previous app.
- Windows: run `Code60-X.Y.Z-win-x64.exe`. It installs for the current user
  without elevation, under the user's Programs directory. It does not change
  PATH or install Node, Git, providers or the headless CLI. Close Code60 before
  upgrading. Uninstall from Windows Settings; config, records, databases and
  worktrees are retained.
- Ubuntu: run `sudo apt install ./Code60-X.Y.Z-linux-x64.deb` with the downloaded
  filename. DEB package identity is `code60`; it installs the GUI launcher.
- AppImage: install the FUSE 2 compatibility runtime (`libfuse2t64` on Ubuntu
  24.04), make the downloaded AppImage executable, and run it. Replace the old
  file to upgrade. AppImage also requires working unprivileged user namespaces;
  on hosts that restrict them, use the DEB (which installs its AppArmor profile)
  or have the administrator configure the host. Code60 rejects launchers that
  pass `--no-sandbox`; do not run it as root.

Application replacement preserves existing configuration, desktop preferences,
run records, and user-selected SQLite databases.

Installed releases check for updates about 30 seconds after startup and every four
hours afterward. The on-by-default **Automatically check for updates** switch in
Settings → Updates is saved across restarts. Automatic failures stay quiet; manual
checks show errors. A footer button opens the Updates section and shows availability,
download progress, or readiness to install. An in-app popup offers **Download now**
and **Later** once per version, remembered across renderer reloads and app restarts.
It waits for other dialogs to close. Checks never start downloads.

Installed releases offer **Settings → Updates**: Check for updates, Download update
(with progress and cancellation), then Install and restart. Downloads never start
automatically, and ordinary quitting never installs an update. Installation asks
for confirmation and stops every agent before restarting. Stable releases stay
on stable versions; prerelease builds can receive their prerelease channel and
stable releases. Downgrades are disabled. Source/development builds cannot update.
Linux DEB updates require PolicyKit (`pkexec`) and a running desktop authorization
agent, and may ask for administrator approval. AppImages must be in a writable
directory; the updater preserves custom filenames and keeps the old app if staging
fails. On macOS, first copy the app out of the DMG into Applications.
Failures are shown explicitly; install failures after agent shutdown close the
app so it can be restarted cleanly.

The first version containing this feature must still be installed manually.
Back up project databases before a release that changes their schema. Download
checksums are in `SHA256SUMS`; use `shasum -a 256 -c SHA256SUMS` on macOS or
`sha256sum -c SHA256SUMS` on Linux after downloading the listed artifacts (or
compare the relevant line for the installer you downloaded).

## One-time GitHub setup

The repository uses only standard GitHub-hosted Linux runners for PRs and pushes
to main. Windows x64 and Apple Silicon `macos-15` runners run only for explicitly
requested releases. Require **CI passed** rather than individual platform checks
in branch protection.
The aggregate fails on failed, cancelled, or skipped validation jobs. If merge
queues are enabled later, add their `merge_group` trigger before using the queue.
Apply and verify the [versioned branch ruleset](.github/rulesets/README.md).
It requires reviewed PRs, up-to-date CI, and resolved discussions, and prevents
direct pushes, force pushes, and deletion without administrator bypasses.

Set the following repository secrets in **Settings → Secrets and variables →
Actions**. Never commit their values or put them in release inputs/logs.

| Secret | Value |
| --- | --- |
| `CSC_LINK` | Base64 of the exported password-protected Developer ID Application `.p12` certificate, including its private key. |
| `CSC_KEY_PASSWORD` | The password used to export that certificate. |
| `APPLE_API_KEY_P8` | Full PEM contents of an App Store Connect **team** API key `.p8` file. |
| `APPLE_API_KEY_ID` | That API key's key ID. |
| `APPLE_API_ISSUER` | That API key's issuer ID. |
| `WIN_CSC_LINK` | Password-protected Authenticode `.p12`/`.pfx` certificate with its private key, in electron-builder's supported format. |
| `WIN_CSC_KEY_PASSWORD` | Password for the Windows signing certificate. |

Create the team API key through App Store Connect's Users and Access / Integrations
settings with access suitable for notarization. The API key authorizes Apple's
notary service; the Developer ID certificate signs the app. App Store distribution
is not required. Export the certificate and private key from Keychain Access.
Do not use an Apple Development or Mac App Store signing certificate.

These examples read local files without printing their contents:

```sh
base64 < DeveloperID.p12 | gh secret set CSC_LINK --repo CodeManufactoryLLC/code60
gh secret set CSC_KEY_PASSWORD --repo CodeManufactoryLLC/code60
gh secret set APPLE_API_KEY_P8 --repo CodeManufactoryLLC/code60 < AuthKey.p8
gh secret set APPLE_API_KEY_ID --repo CodeManufactoryLLC/code60
gh secret set APPLE_API_ISSUER --repo CodeManufactoryLLC/code60
```

The commands without redirected files prompt for their value. Also set repository
variable `RELEASE_MAINTAINER` to a public package contact in `Name <email>` form.
Set repository variable `WIN_SIGNING_THUMBPRINT` to the expected Windows signing
certificate's 40-hex thumbprint. Configuration is a maintainer action, not an
automatic part of implementing Windows support.
This address is included in the DEB metadata. PR packages use
`Code60 CI <ci@example.invalid>` and are not published.

Preflight checks only signing-setting presence, not values, on Linux. Secret values
are supplied only to their platform's signing steps. On macOS the API key and certificate
keychain are temporary and removed even after failure. Apple authorization and
certificate validity are checked by signing/notarization. Missing credentials or
maintainer metadata stop the workflow before platform packaging.
Windows release signing uses SHA-256 and RFC 3161 timestamps. Installer tests
require valid Authenticode signatures, timestamps and the expected certificate
on the final installer, installed application, native helper and uninstaller,
including after reinstall. A missing or invalid signature blocks staging.

## CI and release validation

PRs and pushes to main run checks, builds, and CLI smoke tests on Linux with
Node 22.12 and 24. Node 24 additionally runs the Electron suite under Xvfb,
builds both Linux installers, installs the DEB, and launches both the installed
DEB application and the actual AppImage. An ephemeral runner-only user-namespace
setting allows Electron to retain its Chromium sandbox on Ubuntu 24.04.
These Linux jobs are required by **CI passed**; PRs receive no signing secrets.
Windows and macOS checks are release-only, so platform-specific regressions on
those systems are detected during release validation rather than on every PR.

A release is a manual `Release installers` workflow dispatch from `main`, with
one existing version tag. The workflow validates the exact tagged commit and
both package versions; tags outside main, missing tags, published releases, and
conflicting drafts fail. It runs Linux validation and installer tests first.
Only successful Linux validation starts macOS and Windows validation. macOS runs
checks, desktop tests, packaging,
Developer ID signing, app and DMG notarization/stapling, and verification of the
application copied from the final mounted DMG.
Windows repeats checks and desktop tests, then builds and verifies the signed
installer. Installer tests retain real application profiles, configuration,
SQLite databases, records and worktrees and compare their hashes after reinstall
and uninstall. Staging requires a verification report bound to the installer hash.

Packaged tests launch outside the repository, with isolated test data and fake
agents. They cover a PATH without Node/npm, version/assets/preload/sandbox,
SQLite and project persistence, agent execution/cancellation, the packaged MCP
sidecar's gateway request, and shutdown. No live agents or user credentials are
needed for tests.

Each platform uploads its tested final installers, updater metadata, and a manifest identifying
the tag, exact SHA, and SHA-256 hashes. macOS also produces a signed/notarized app
ZIP required for in-app updates. Channel YAML (`latest` or the prerelease channel,
with platform suffixes) is verified against the exact artifact names, versions and
SHA-512 checksums. DMG metadata is refreshed after notarization/stapling.
The Linux publication job checks all eight release assets and three manifests,
revalidates the tag, and uploads to a matching
draft before publication. It never rebuilds installers. Only that job receives
repository write permission. Prerelease suffixes produce GitHub prereleases;
older stable releases do not replace newer releases as latest. Publication jobs
are serialized across tags to keep that latest-version decision consistent.

Normal checks have a 15-minute limit, Linux desktop/package validation 30 minutes,
macOS and Windows 45 minutes, and publication 10 minutes. Playwright stops earlier so failure
traces can upload. Artifacts and failure diagnostics expire after seven days.
New PR commits cancel superseded runs; release runs do not cancel an active run
for the same tag. GitHub can replace a pending concurrency-group run with a newer
pending run; rerun a release that was cancelled while waiting.

## Local packaging and checks

```sh
npm ci
npm run check
npm run test:desktop
npm run package:dir
# On the appropriate target host:
npm run package:mac
npm run package:linux
npm run package:win
npm run test:installers
```

On Linux, use `xvfb-run -a` around desktop/installer tests when no display is
available. Installer tests install the DEB with `sudo apt-get` and require a
usable FUSE runtime for AppImage. Run them on a disposable test machine. The
Mac installer test mounts the DMG read-only and copies the app to a temporary
installation directory; it does not overwrite Applications.
Windows source builds require MSVC C++ Build Tools and a Windows 11 SDK.
`package:win` cross-builds the first-party helper and Electron package for x64.
Windows installer tests create and remove a temporary per-user installation;
run them only on a disposable development/test account with no existing Code60
installation. They do not provide native x64 acceptance when run under emulation.

Output is under `release/build/`. Local Mac builds use an ad-hoc signature and
skip notarization; they are test artifacts, not public releases. Release CI sets
`CODE60_RELEASE=1`, validates required secrets, enables hardened runtime and
mandatory signing, and verifies notarization before promotion. Never distribute
local test artifacts as signed releases. `npm run test:packaged` also accepts an
absolute `CODE60_PACKAGED_EXECUTABLE` path for inspecting an installed build.

The icon has a full viridian (`#40826d`) background with black 60 numerals and a
black upper-right corner behind a 45-degree chamfer. The desktop cut extends
352px into the 1024px canvas so it remains visible inside macOS's rounded icon mask.
After `npm ci`, `node scripts/generate-icon.mjs` regenerates the 1024px
`packaging/icon.png` using Electron, the renderer styles, and bundled D-DIN
Regular. On Linux without a display, use `xvfb-run -a node scripts/generate-icon.mjs`.
The bundle ID `com.codemanufactory.code60` and
existing user-data paths must remain stable across updates.

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
`npm version preminor --preid=beta --no-git-tag-version`; increment an existing beta with
`npm version prerelease --preid=beta --no-git-tag-version`. Choose the intended final
version explicitly when leaving preview, for example
`npm version 0.2.0 --no-git-tag-version`. These are alternatives to the
stable bump below, not commands to run in sequence. All version commits follow
the same checks, sign-off, and reviewed PR procedure.

## Release checklist

- Required milestone issues are merged and release blockers resolved.
- Compatibility impact, database migrations, known issues, and source-build
  instructions are reviewed.
- `npm run check`, build, and desktop tests pass before the version commit.
- Version commit is signed off and merged through a reviewed PR; package and
  lockfile versions match the tag created on main after merge.
- Signing secrets, Apple access, and maintainer metadata are configured.
- The manually requested workflow passes all Linux, Mac and Windows validations.
- Steps that run only in `release.yml`, such as the publication job's
  `actions/download-artifact`, are first exercised by a release run. After an
  update to such an action, confirm that step succeeded before publishing.
- Native Windows 11 x64 acceptance and the signed installer checks are recorded.
- All four tested installers and checksums are published for the exact tag.
- Public release links work; the first installer prerelease has been installed
  and exercised before declaring the pipeline operational.

## Prepare the version and dispatch

Start with a clean, up-to-date main and create a release-preparation branch.
Follow semantic versioning above and the
repository's DCO sign-off policy. Review `git config user.name` and
`git config user.email` before making the release commit.

```sh
git switch main
git pull --ff-only
git status --short
git switch -c release/prepare-version
npm ci
npm run check
npm run build
npm run test:desktop
npm version patch --no-git-tag-version
npm run check
npm run build
node dist/cli/main.js --version
version=$(node -p "JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).version")
git add package.json package-lock.json
git diff --cached
git commit -s -m "chore: prepare release v$version"
git push -u origin HEAD
gh pr create --base main --title "chore: prepare release v$version" \
  --body "Prepare the reviewed version bump. Create the release tag on main only after merge and CI passed."
```

Choose the bump intentionally; use the preview commands above for the first
installer validation release. Review the diff, resolve discussions, and merge only after **CI passed** succeeds on an up-to-date branch.
Do not push version commits directly to main.

After the PR is merged, update main and verify that it contains the intended
release version before creating the tag. Tagging after merge also works with
squash or rebase merges. Do not amend a tagged commit or move a published tag.
CI never bumps versions or creates tags.

```sh
git switch main
git pull --ff-only
git status --short
version=$(node -p "JSON.parse(require('node:fs').readFileSync('package.json', 'utf8')).version")
git log -1 --oneline
git tag -a "v$version" -m "Release v$version"
git push origin "refs/tags/v$version"
```

Dispatch the existing tag, substituting the actual version:

```sh
gh workflow run release.yml --repo CodeManufactoryLLC/code60 --ref main -f tag=vX.Y.Z
```

The workflow must already exist on main and the tagged commit must contain the
packaging implementation. Dispatch authorizes automatic publication after all
checks pass. Do not manually publish a release while its workflow is running.
Review the resulting generated release notes, add relevant compatibility details,
verify download links, and close the release preparation issue/milestone.

## Failure recovery

A failed, cancelled, or skipped platform job blocks publication. Fix failing code
on main and make a new version tag; do not retag published versions. For transient
infrastructure or Apple failures, rerun the same workflow. The DMG stapling step
retries Apple's temporary ticket-delivery failures twice, after 15 and 30 seconds;
persistent failures still block publication. A publication failure can leave a
draft with partial uploads: a rerun may replace assets in that draft
only when its tag and target SHA match. Published release assets are never
replaced. After the seven-day artifact retention period, rerun the whole workflow
so every replacement artifact is built and tested again.

If a published release is bad, document the problem and publish a new patch.
Manual installer upgrades retain user data; do not promise downgrade compatibility
across database schema changes without verifying it.

## Release-note template

Replace placeholders, remove empty sections, and link the relevant issues/PRs.

```markdown
# Code60 vX.Y.Z

What users can now accomplish. State preview status here.

## Download
| Platform | Architecture | Installer |
| --- | --- | --- |
| Verified platform and minimum version | Verified architecture | Asset link |

Link checksums and describe signing/notarization status for downloadable builds.
List only the installers validated by the release workflow.

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
