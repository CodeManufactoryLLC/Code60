# Contributing to Code60

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
