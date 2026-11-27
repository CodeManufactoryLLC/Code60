# Code60

Code60 runs coding agents in isolated Git worktrees, with a browser interface and a local Node backend. It supports macOS Apple Silicon and Linux x64 and requires Node 24, npm, Git and a supported coding-agent provider.

The opt-in per-user backend starts at login. Closing the browser keeps approved agents and scheduled jobs running. Stop all in Chat stops interactive work; Stop Code60 Backend stops interactive and scheduled work together. Your computer must be awake and logged in for scheduling.

For common questions and core concepts, see the [FAQ](FAQ.md) and [Terminology](TERMINOLOGY.md).

## Install and open

Install a downloaded Code60 npm tarball using Node 24. Code60 runs embeddings on the CPU. The install command skips the optional ONNX GPU download and uses the CPU runtime bundled in the npm package.

```sh
ONNXRUNTIME_NODE_INSTALL=skip npm install --global "./code60-<version>.tgz"
code60 service install
code60 open
```

Installation asks for confirmation before creating a launchd or user systemd service. Use `--yes` only for an explicitly authorized unattended service change. Provider CLIs keep their own authentication; Code60 never asks for their passwords. Standard Codex setup can install a pinned compatible CLI after you explicitly choose **Install Codex and sign in**. The other catalog harnesses also support explicit in-app installation and browser sign-in.

`code60 open` opens Code60 directly. Pairing codes are skipped by default. Each
browser still gets its own session, and **Take control** explicitly replaces the
current controlling window. Refresh reconnects the same tab.

To require a code, run `code60 pairing on`. Use `code60 pairing off` to skip it
again, or `code60 pairing status` to inspect the setting. Changes ask for local
confirmation; add `--yes` for an explicitly intended noninteractive change. The
setting works before service installation and takes effect immediately when the
backend is running. Browser sessions reconnect; approved agents keep running.

When pairing is enabled, `code60 open` prints a single-use code valid for sixty
seconds. Enter it in the browser. Restarting the backend requires a new code in
that mode. With pairing off, any browser on this computer can connect; enable
pairing when you want an explicit local authorization step.

Complete provider verification in the browser. Select **Codex** to connect an existing authenticated installation. If missing, choose **Install Codex and sign in**; otherwise choose **Sign in to Codex** when prompted. Copy the displayed device code, open the sign-in page in its separate tab, and authorize with your ChatGPT account. Device-code login must be enabled in your ChatGPT security settings. Keep setup open until the fresh connection check and automatic save finish. **Connected** confirms both succeeded.

Manage verified providers under **Connect → Providers**. The primary provider has **(Primary)** beside its name. Use a provider’s **More actions** menu to change the primary provider or disconnect it. Saved model defaults can be cleared in the same list.

The same dialog installs and signs in to **Antigravity, Claude, Copilot, Droid, Kiro and OpenCode**. Choose Claude subscription or Anthropic Console, or choose ChatGPT/GitHub Copilot for OpenCode. Some providers return an authorization code to paste into Code60; others display a device code to enter on their website. If Copilot cannot use a system keychain, Code60 asks before allowing its private-file credential fallback. Keep setup open until verification and saving finish.

Installations use fixed, integrity-verified releases in private versioned backend-user storage, preserving existing CLIs and configuration. Native archives and platform packages run without vendor install scripts; the Claude ACP adapter uses npm with lifecycle scripts disabled. Provider logins stay in each harness’s own backend-user storage and survive normal dev-container recreation. Custom launch commands, enterprise endpoint forms and API-key entry retain external setup.

Codex installation uses non-root npm with lifecycle scripts disabled and the official registry, pinned to `@openai/codex@0.171.0`. Code60 activates its private copy under `~/.local/share/code60/providers/codex/0.171.0` and prefers it for the standard Codex connector without changing configuration or replacing an existing CLI. Codex stores credentials in its normal backend-user home. Closing/cancelling setup, reloading, taking control in another tab or stopping the backend cancels the owned installation/login process; it does not log out an account or remove issued credentials. Retry requests a new attempt. Unsupported CLIs offer the compatible installation; custom launch commands retain manual setup. Account switching, logout and API-key entry are outside this setup flow.

After verification Code60 returns to your last available destination for that database and browser. If it is gone, Code60 opens Relay. Select the **relay animation** checkbox beside the Back and Forward buttons to show Relay activity above **Chat**. This setting starts off and is saved in your browser. Focus it or hover over it to read its state. An exclamation mark means Relay needs attention, and a brief checkmark marks a completed turn. Use **Workspace** in the header for database selection and theme. In the sidebar, **Chat** opens Relay and Custom Assistants, **Develop** opens Projects and Workflows, and **Automate** opens Scheduled Jobs. Use the **Code60** header link to open Home for Search and the Apps index.

Create or select a database and open a project through the host-side chooser. Project workers require Git with an initial commit. Relay can explicitly target a direct folder. Accept the displayed plan to dispatch work, inspect the automatically integrated changes, and use message Undo to restore covered files and return the request unsent. Undo does not reverse external website effects.

## LAN access (beta)

Before setting up a provider, close provider setup and choose **Web Server (Beta)**
on the start screen to open its settings directly. No database is required.

Open **Experiments → Web Server (Beta)** from Code60's localhost browser
and enable the switch. The page shows the current LAN URL, for example
`http://192.168.0.16:47994`, and a single-use six-digit pairing code valid for sixty seconds.
Codes appear as `123-456`; enter them with or without the hyphen.
Open that URL on the other device and enter the code. **New code** replaces the
previous code; **Take control** explicitly transfers control of the shared app.

Only the controlling localhost browser can enable/disable LAN access or generate
codes. LAN pairing is required even when localhost pairing is off. The enabled
preference survives restart; browser sessions and codes do not. The address follows
the current primary private IPv4 interface and uses the existing application port.
Missing networks or occupied ports show Unavailable; no alternate port is chosen.
Disabling access disconnects LAN views while approved agents and schedules continue.

Use a trusted LAN: HTTP traffic is unencrypted. File choosers show files on the
computer running Code60. There is no public hosting, TLS certificate setup or
router/firewall configuration. This works with native Code60 and the standalone
`npm run devcontainer -- start` launcher. Leave the localhost URL available for
server administration and recovery.

## Backend management

```sh
code60 service status
code60 service start
code60 service stop
code60 service repair
code60 service uninstall
```

Status is read-only. Stop, repair and uninstall require consent and preserve histories, databases, worktrees and settings. Repair refreshes the registered Node/application paths after an update or runtime move. Only one backend can own application state. An existing scheduler service is transferred only with installation consent and verified shutdown; uncertain work is never replayed.

For a managed installation, `code60 uninstall` also removes its owned application
releases and launcher after verifying idle ownership. It preserves user data.
Service/application consent and interactive profile approval are
separate; non-TTY removal requires `--yes` and retains profiles. Keep the printed
absolute recovery command if cleanup is interrupted. See [uninstall and recovery](knowledge/operations/distribution/uninstall.md).

Workspace chooser roots default to the user's home directory. To add another root, stop the backend and edit private `gateway/settings.json` under the Code60 state directory with `{"roots":["/absolute/workspace/root"]}`, then start it again. Use only directories you intend Code60 to access. The chooser lists the backend computer's files; it is not an upload dialog.

In the chooser, click a row to select it. Double-click or press Enter to open it, or select a folder and use **Open folder**. Back and Forward revisit locations; Up goes to the parent or the workspace roots. **Choose folder** accepts the selected folder or the current location. To create a database, navigate to its destination and enter the filename. **New folder** creates a directory inside the current location.

In the chat File Explorer, click a row to select it. Use the chevron or Left and Right to collapse or expand folders. Double-click or press Enter on a file to open its read-only preview tab.


## Manual updates

Stop the backend before replacing its package:

```sh
code60 service stop
ONNXRUNTIME_NODE_INSTALL=skip npm install --global "./code60-<new-version>.tgz"
code60 service repair
code60 service start
code60 open
```

There is no automatic updater, Electron shell, bundled Node runtime, DMG, DEB or AppImage installer. The public command handles local lifecycle only; it cannot submit prompts or run agents.

## Development

```sh
ONNXRUNTIME_NODE_INSTALL=skip npm ci
npm run prepare:models
npm run dev
```

Development uses isolated configuration/state under ignored `test-results/dev`, a foreground Node backend and Vite React Fast Refresh. It prints a browser address, plus a code only when pairing is enabled. UI edits preserve running agents; backend edits restart gracefully. Production login services and user data are untouched.

An optional [Linux development container](.devcontainer/README.md) provides an
isolated non-root x64 environment for development and headless browser tests.
Docker Desktop is optional; the container uses a local Linux Docker engine with
Compose v2. After installing the host dependencies above, run `npm run devcontainer -- start`
to prepare the container and open the printed browser URL without VS Code.
Ctrl+C stops it and cleans up its containers/images, retaining caches and each
worktree's private provider home. Provider tools and file-based logins persist
across container recreation; see the guide for installation and sign-in.
Native host development does not require Docker.

```sh
npm run check
npm run test:browser
npm run build
npm run package:app
npm run test:packaged
```

Browser tests run headlessly with fake providers and isolated state. Package checks install the npm tarball into a temporary prefix. Native service tests need an isolated, explicitly authorized supervisor environment; ordinary checks never register a real service.

See [FAQ](FAQ.md), [terminology](TERMINOLOGY.md), [architecture](ARCHITECTURE.md), [capabilities](knowledge/reference/capabilities/INDEX.md), [MCP integration](MCP.md), [security](SECURITY.md), [contributing](CONTRIBUTING.md), [releases](RELEASING.md), [roadmap](ROADMAP.md) and [recovery runbooks](knowledge/operations/runbooks/INDEX.md).

### Workflows

Apps → Workflows creates ordered coding workflows manually or with **Create with
prompt**, runs them natively inside Code60 Gateway with any verified ACP provider
in dedicated saved-file worktrees, and shows implementation, verification, repair
and decision status. Work continues after closing the browser while the backend
stays running. See [Scheduled Jobs and Workflows](knowledge/reference/capabilities/automation.md) for
prerequisites, approval defaults, pause/resume behavior and recovery details.


MCP servers can be configured under **Apps → MCP Servers** with guided forms or
validated JSON, scoped to User or an open project. The page includes activation,
project approval, connection tests, secure credentials/OAuth, backup/reset, reviewed
transaction recovery and safe troubleshooting reports. Configuration validity,
authentication and observed connection health are separate. See
[MCP configuration](MCP.md) and the [MCP recovery runbooks](knowledge/operations/runbooks/mcp-storage.md).

### Chat

Relay, project chats, custom assistants and interactive workers open their Code60 thread in IBM Carbon AI Chat. Enter sends and Shift+Enter adds a line. Stop acts on the current conversation. You can switch chats while a turn is running and return to its messages, draft and pending approvals.

In a project chat, type `/` or `$` to browse commands. Select a suggestion and add arguments, or type the full `$name` directly. Use the adjacent Files and Changes panels to attach code. Workflows → Create with prompt uses the same prompt line to draft editable fields.

### Scheduled Jobs Carbon trial

Apps → Scheduled Jobs opens on Schedules. Scan schedule status, next run and live run status. Expand a row to read the saved prompt and settings. Use Run or Stop directly, or open the row menu to edit, pause, enable, inspect history or delete the job. New scheduled job opens a dedicated form.

Execution history shows all schedules by default. View history on a job applies an explicit filter. Search the loaded page, sort its columns, or select an execution for Transcript and Changes. Older and Latest page through retained records. The Code60 header offers Commands and Workspace, including connection and appearance controls.

### Application-wide Carbon migration

Code60 uses upstream Carbon controls and White/G100 themes across its browser UI. Under **Personalize → Appearance**, use **Accent color** to change the default verdigris. The browser remembers your choice across themes. Home, Apps, Settings and project/provider homes
use destination rows with direct creation buttons. Backend operations, retained
conversations and saved appearance records are preserved.
