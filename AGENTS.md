# Agent Instructions

This project is a Node.js application for orchestrating agents, with an
Electron and React desktop app with an internal background scheduler. Keep
changes reliable in both the desktop app and automated, non-interactive
environments.

## Architecture and Module Rules

- Read `ARCHITECTURE.md` before changing behavior. It defines the modules
  (`desktop`, `bridge`, `renderer`, `core`, `automation`, `agents`, `git`, `contracts`, `platform`), their
  dependency rules, and the non-goals.
- Each `src/<module>/AGENTS.md` adds rules for that module. Follow them when
  changing its code.
- Do not add features listed as non-goals in `ARCHITECTURE.md` without first
  updating that document.

## Development

- Use npm. Install with `npm ci`, and commit `package-lock.json` changes.
- Prepare pinned offline embedding assets explicitly with `npm run prepare:models`
  before RAG development or packaging. Keep generated `models/` out of Git.
  Model/runtime changes require the offline smoke and packaged target checks.
- `npm run check` runs instruction validation, typecheck, Biome, Knip unused-code checks, and one
  coverage-enabled test suite with versioned four-metric gates. Run it before
  every commit. Never lower coverage floors or broaden Knip exclusions to hide
  findings; document explicitly reviewed exceptions. CI for PRs and pushes to main runs only on
  Linux with Node.js 22.12 and 24. macOS checks run with Node.js 24 only
  in the manually requested release workflow.
- `npm run format` applies Biome formatting and safe fixes to TypeScript,
  JSON, and workflow files. Markdown is not auto-formatted.
- `npm run build` compiles `src` to `dist` and builds the renderer with Vite.
  The scheduler uses its fixed internal service entrypoint.
- `npm run dev` builds and starts the desktop app, rebuilding and restarting it
  on changes. `npm start` starts the built app.
- Run desktop (Electron/Playwright, `test/desktop.e2e.ts`) tests locally only in
  the Linux container: `npm run test:desktop:container` (add
  `-- --grep "<name>"` to narrow). Do not run `npm run test:desktop` on the
  host; it opens windows on the user's machine. CI and native-platform
  validation (macOS, packaged and installer tests) are the only places
  it runs directly. If Docker is unavailable, stop and report it rather than
  falling back to the host. Unit tests and `npm run check` run on the host;
  `npm run check` does not run the desktop tests.
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
- Keep the renderer sandboxed. Expose new capabilities only as narrow preload
  methods, validated in `src/bridge` and checked in the main process.

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
  paths or command/environment values. The scheduler must not enable desktop capture.
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
