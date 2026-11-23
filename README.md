# Code60

Code60 runs coding agents in isolated Git worktrees, with a browser interface and a local Node backend. It supports macOS Apple Silicon and Linux x64 and requires Node 24, npm, Git and a supported coding-agent provider.

The opt-in per-user backend starts at login. Closing the browser keeps approved agents and scheduled jobs running. Stop all in Chat stops interactive work; Stop Code60 Backend stops interactive and scheduled work together. Your computer must be awake and logged in for scheduling.

## Install and open

Install a downloaded Code60 npm tarball using Node 24:

```sh
npm install --global ./code60-<version>.tgz
code60 service install
code60 open
```

Installation asks for confirmation before creating a launchd or user systemd service. Use `--yes` only for an explicitly authorized unattended service change. Provider CLIs keep their own authentication; Code60 never installs providers or asks for their passwords.

`code60 open` prints a single-use pairing code, valid for sixty seconds, and opens a token-free localhost address. Enter the code in that browser. Refresh reconnects the same tab; restarting the backend requires pairing again. Only one browser controls Code60 at a time; Take control explicitly replaces the previous controller.

Complete provider verification in the browser. Create or select a database and open a project through the host-side chooser. Project workers require Git with an initial commit. Relay can explicitly target a direct folder. Accept the displayed plan to dispatch work, inspect the automatically integrated changes, and use message Undo to restore covered files and return the request unsent. Undo does not reverse external website effects.

## Backend management

```sh
code60 service status
code60 service start
code60 service stop
code60 service repair
code60 service uninstall
```

Status is read-only. Stop, repair and uninstall require consent and preserve histories, databases, worktrees and settings. Repair refreshes the registered Node/application paths after an update or runtime move. Only one backend can own application state. An existing scheduler service is transferred only with installation consent and verified shutdown; uncertain work is never replayed.

Workspace chooser roots default to the user's home directory. To add another root, stop the backend and edit private `gateway/settings.json` under the Code60 state directory with `{"roots":["/absolute/workspace/root"]}`, then start it again. Use only directories you intend Code60 to access. The chooser lists the backend computer's files; it is not an upload dialog.

## Manual updates

Stop the backend before replacing its package:

```sh
code60 service stop
npm install --global ./code60-<new-version>.tgz
code60 service repair
code60 service start
code60 open
```

There is no automatic updater, Electron shell, bundled Node runtime, DMG, DEB or AppImage installer. The public command handles local lifecycle only; it cannot submit prompts or run agents.

## Development

```sh
npm ci
npm run prepare:models
npm run dev
```

Development uses isolated configuration/state under ignored `test-results/dev`, a foreground Node backend and Vite React Fast Refresh. It prints a browser address and pairing code. UI edits preserve running agents; backend edits restart gracefully. Production login services and user data are untouched.

```sh
npm run check
npm run test:browser
npm run build
npm run package:app
npm run test:packaged
```

Browser tests run headlessly with fake providers and isolated state. Package checks install the npm tarball into a temporary prefix. Native service tests need an isolated, explicitly authorized supervisor environment; ordinary checks never register a real service.

See [architecture](ARCHITECTURE.md), [capabilities](docs/capabilities.md), [MCP integration](MCP.md), [security](SECURITY.md), [contributing](CONTRIBUTING.md), [releases](RELEASING.md), [roadmap](ROADMAP.md) and [recovery runbooks](docs/runbooks/README.md).
