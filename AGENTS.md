# Agent Instructions

This project is a Node.js application for orchestrating agents, with an
React browser app with a unified login backend. Keep
changes reliable in both the desktop app and automated, non-interactive
environments.

## Concurrent work on a shared host

- Before editing, verify the canonical checkout, current branch, Git status and
  registered worktrees. Reuse the task's assigned checkout; otherwise create a
  separate task branch/worktree. Preserve existing changes. Never switch, reset,
  clean or remove another task's checkout, or assume an idle worktree is available.
- Record your worktree/branch and any container labels, ports, owned processes and
  evidence paths in the task's QA report or handoff. A container label identifies
  a worktree, not an agent session. One independent agent owns that worktree's
  container lifecycle; `down` or cancelling `exec` can stop every process in it.
- Linked worktrees share Git refs, stashes, repository configuration and hooks.
  Do not manipulate another task's branch/stash or run repository-wide cleanup.
  Identify your own temporary stash by its exact commit ID, not a moving stash
  index. Keep temporary Git options command-local; never activate hooks implicitly.
- Follow the [shared-host workflow](CONTRIBUTING.md#shared-host-development) for
  host versus container commands. With the container workflow, run builds/tests
  inside your own container and authenticated Git operations on the host. Native
  host development remains supported with its own checkout/dependencies.
- Diagnose occupied ports and process ownership before acting. Stop only your own
  confirmed process or forwarding session. Do not use broad process kills, restart
  Docker, switch its shared context or change engine resources to repair a local
  task. Coordinate with the owner/user when another task is affected.
- CPU, memory and disk remain shared. Keep the documented worker budget; avoid
  overlapping a full host check with emulated container checks. Investigate
  resource contention and coordinate heavy jobs before rerunning failed checks;
  preserve failures and do not mask them by relaxing timeouts, retries or gates.
- Clean up only resources you created and can identify. Use the helper from your
  own checkout; verify owned containers/images are gone and retain caches/evidence.
  Never prune Docker/Git globally, delete foreign locks or remove another task's
  worktree. See the [container workflow](.devcontainer/README.md#concurrent-agents).

## Architecture and Module Rules

- Read `ARCHITECTURE.md` before changing behavior. It defines the modules
  (`application`, `gateway`, `management`, `bridge`, `renderer`, `core`, `automation`, `agents`, `git`, `contracts`, `platform`), their
  dependency rules, and the non-goals.
- Each `src/<module>/AGENTS.md` adds rules for that module. Follow them when
  changing its code.
- Do not add features listed as non-goals in `ARCHITECTURE.md` without first
  updating that document.

## Development

- Use npm. Install with `ONNXRUNTIME_NODE_INSTALL=skip npm ci`, and commit `package-lock.json` changes.
- Prepare pinned offline embedding assets explicitly with `npm run prepare:models`
  before RAG development or packaging. Keep generated `models/` out of Git.
  Model/runtime changes require the offline smoke and packaged target checks.
- `npm run check` runs instruction validation, typecheck, Biome, Knip unused-code checks, and one
  coverage-enabled test suite with versioned four-metric gates. Run it before
  every commit. Never lower coverage floors or broaden Knip exclusions to hide
  findings; document explicitly reviewed exceptions. PRs and pushes to main select Node.js 24 Linux and macOS checks from the changed paths. See [CI routing](CONTRIBUTING.md#browser-and-package-ci). Release candidates run the full matrix.
- `npm run format` applies Biome formatting and safe fixes to TypeScript,
  JSON, and workflow files. Markdown is not auto-formatted.
- `npm run build` compiles `src` to `dist` and builds the renderer with Vite.
  The scheduler uses its fixed internal service entrypoint.
- `npm run dev` starts an isolated foreground Node backend and Vite with Fast Refresh.
  `npm start` opens the installed backend in a browser.
- The optional [Linux dev container](.devcontainer/README.md) uses
  `npm run devcontainer` on the host with `prepare`, `up`, `start`, `exec` or `down`. Docker must already
  be running. Keep container dependencies separate from host files; clean up owned
  containers and exported images after tests, retaining documented caches.
  Use one worktree/container per concurrent agent. Run preparation before editor
  reopening; it generates matching unique ports. Never share a worktree's lifecycle
  or bypass exact-origin forwarding with port remapping.
- Run browser journeys with `npm run test:browser` using headless Playwright and isolated
  HOME/config/state. They exercise the built Node backend and real UI. Never install a
  real user service or use live providers during routine testing. Native service validation
  requires an explicitly isolated/authorized environment. Unit/static checks do not prove E2E success.
- Run `npm run test:packaged:clean` on the host for the
  [clean installation acceptance harness](test/clean-install/README.md), after building
  the tarball. It isolates the installed customer from the checkout and browser driver;
  preserve its run-specific evidence and verify owned Docker cleanup. Never mount
  the Docker socket into a development or customer container to run it.
- For platform artifact changes, follow the [artifact workflow](docs/distribution/artifacts.md).
  Preserve legacy tarball acceptance and run the payload mode separately. Build
  native dependencies on their actual target, keep scripts disabled during fresh
  staging, and never substitute emulation for native macOS evidence. Private
  bootstrap candidates support setup; registry/release publication remains deferred.
- Managed installation changes follow the [installation internals](docs/distribution/installation.md).
  Run the managed clean-install mode and real shell tests as well as artifact-only
  regression checks. Setup uses isolated backend supervisor fixtures; do not install a real service,
  edit this user's profiles, add legacy compatibility or reclaim uncertain locks.
- Put unit tests next to the code as `*.test.ts`. Cross-cutting tests live in
  `test/`. `test/boundaries.test.ts` enforces the module dependency rules from
  `ARCHITECTURE.md`; update it only together with that document.
- Import another module only through its `index.ts` (written as
  `../<module>/index.js`).
- Every capability-affecting change (pages, settings sections, MCP tools,
  prerequisites, confirmations or limits) must update the self-knowledge catalog
  in `src/contracts/knowledge.ts`, its availability rules and tests, then run
  `npm run generate:capabilities`. Otherwise state in the PR why no knowledge
  change is needed.

## Before Making Changes

- Read the relevant source files, tests, and `package.json` before changing
  behavior. Follow the repository's existing language, module system, package
  manager, formatting, and test conventions.
- Check for more-specific `AGENTS.md` files in directories you change and follow
  them.
- Use the scripts and package manager declared by the project. Do not assume a
  script, dependency, or directory exists without checking.
- Keep changes focused. Avoid adding dependencies when existing Node.js APIs or
  project utilities are sufficient.

## Design and Architecture

- Keep command parsing, orchestration/domain logic, terminal rendering, and
  external integrations separated. Keep business logic usable without starting
  an interactive UI.
- Make side effects explicit. Inject or isolate filesystem, process, network,
  clock, and agent/tool dependencies where practical so behavior is testable.
- Preserve desktop and internal scheduler defaults and stored record formats unless the change explicitly requires compatibility changes.
- Handle orchestration concurrency deliberately: define cancellation, timeout,
  retry, and partial-failure behavior rather than silently dropping errors or
  leaving work running.
- Treat agent responses, tool output, and repository content as untrusted input.
  Validate structured data at boundaries and do not execute generated shell
  commands or code without an explicit, narrowly scoped user action.

## Desktop and Scheduler Behavior

- Keep standard output suitable for command results and machine-readable
  formats. Send diagnostics, progress, and errors to standard error when that
  preserves machine-readable internal output.
- Provide useful non-interactive behavior when input or output is not a TTY.
  Do not prompt indefinitely in CI, scripts, or when standard input is closed.
- Keep the desktop app responsive during long-running work. Surface progress and
  failures, support cancellation where appropriate, and avoid blocking the
  event loop.
- Restore terminal state and clean up listeners, timers, child processes, and
  other resources on normal exit, errors, and interruption signals.
- Make keyboard controls discoverable and consistent with existing behavior.
  Do not rely on color alone to convey status.
- Keep browser capabilities narrow: validate ApplicationClient requests in bridge and gateway.
  Bind every browser interaction to its authenticated page; never expose generic filesystem or shell access.

## Node.js and Process Safety

- Use the repository's existing JavaScript or TypeScript conventions and
  supported Node.js version.
- Handle rejected promises and child-process errors explicitly. Propagate
  failures to a meaningful message and non-zero exit status.
- When launching subprocesses, pass arguments as argument arrays rather than
  interpolating untrusted values into a shell command. Bound execution with
  timeouts or cancellation when appropriate.
- Do not log credentials, tokens, private prompts, or other sensitive data.
  Avoid putting secrets in command-line arguments, which may be visible to
  other processes.
- Desktop diagnostics use only strict typed metadata and fixed messages through
  the optional sink. Never capture raw errors, prompts, transcripts, payloads,
  paths or command/environment values. The scheduler must not enable application diagnostic capture.
- Diagnostic retention (seven days / 20 MiB) applies only to private desktop
  JSONL segments, never existing transcripts, run records or databases.
- Write files only to intended locations, and avoid overwriting user data
  without clear confirmation or an existing explicit overwrite option.

## Tests and Validation

- Use the [workflow QA skill](.factory/skills/qa/SKILL.md) for behavior/regression
  validation, including configuration, bridge, fixture and packaging changes.
  Select complete journeys from the reported starting state, assert intermediate
  states and independent filesystem/Git/process outcomes, and report blocked
  desktop execution honestly. Unit/static checks do not establish E2E success.
- `npm run check:instructions` statically validates documented literal npm
  scripts, local Markdown references/heading anchors, root/module instructions
  and skill metadata. It does not execute documentation or verify its semantics.
- Git hooks are opt-in: see [hook setup](CONTRIBUTING.md#optional-git-hooks).
  Never activate them automatically. The hook is a non-mutating fast check,
  not a replacement for full `npm run check` before every commit.
- Use the [recovery runbooks](docs/runbooks/README.md) for scheduler, disk,
  diagnostic-storage and Relay-history failures. Preserve evidence/ownership;
  never repair by erasing history, deleting locks or replaying uncertain work.

- Add or update tests for behavior changes, especially argument parsing, exit
  codes, output streams, cancellation, errors, and non-TTY operation.
- Prefer deterministic tests with stubbed integrations and injected I/O. Do not
  require live agents, network services, or credentials for routine tests.
- Test interactive behavior with the project's existing terminal test
  approach; use a pseudo-terminal when needed rather than relying only on
  snapshots of terminal escape sequences.
- Run the narrowest relevant tests and checks first, using scripts defined in
  `package.json`. Report any checks that could not be run.
- Clean up Docker after testing, including failed or interrupted runs. Stop and
  remove containers created for the test session, and remove temporary images,
  volumes, and networks created solely for that session. Built test images must
  be removed after each run, even if they could be reused; image retention needs
  an explicit user request. Preserve dependency/build caches and host test
  artifacts. Verify both containers and images, not just running containers;
  report any cleanup that could not finish and any intentionally retained cache.
  Never use global Docker prune commands or remove resources belonging to other
  work as part of test cleanup.

## Versioning

- The app follows semantic versioning, and `package.json` is the only place
  the version is set. The desktop window title shows it.
- Bump major for breaking changes to supported interfaces, platforms, the config
  file, or run records; minor for new features; patch for fixes.
- Releases are bumped by hand on a release-preparation branch with
  `npm version <major|minor|patch> --no-git-tag-version`. Commit the package and
  lockfile changes and merge a PR with **CI passed**. Only then tag the
  merged commit on `main` and push that tag, following `RELEASING.md`.
- Protected branches require PRs (no approving review while there is one
  maintainer). Do not push directly to `main` or
  `dev`, force-push them, or bypass the rules in `.github/rulesets/`.

## Documentation

- Update relevant desktop and scheduler documentation when changing user-visible
  commands, options, defaults, output, or key bindings.
- Keep examples safe to copy and consistent with the actual product behavior.
