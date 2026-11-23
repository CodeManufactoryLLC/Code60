# Linux development container

This environment targets Linux x64, including emulation on Apple Silicon. It
does not validate macOS, Transmission's native helpers or real login services.
Docker must already be running; the helper never starts Docker Desktop.

Docker Desktop is optional. Linux can use Docker Engine with Compose v2 directly;
macOS can use Docker Desktop or Colima's Docker runtime with the Docker CLI,
Compose v2 and Buildx installed. The helper uses the active Docker context and
requires a local Linux engine with access to the checkout's absolute paths.
On Apple Silicon, that engine must support amd64 emulation or run in an x86_64 VM.
Native host development remains available without any container runtime.

## Start Code60 in your browser

With Docker running and host dependencies installed (`npm ci` once, using Node 24), run:

```sh
npm run devcontainer -- start
```

This prepares and starts this worktree's container, runs `npm ci` and
`npm run prepare:models` inside it, forwards the gateway and Vite/HMR ports to
host loopback, and runs the development servers in the foreground. The first run needs
network access to download dependencies and pinned models. Startup uses the bundled
CPU inference runtime and skips the optional GPU binary download. Open the printed
`http://127.0.0.1:…` gateway URL when **Development Code60** reports ready.
No editor or VS Code extension is required. Provider setup remains inside the
isolated development environment; host credentials are not copied. Provider tools
and file-based logins persist in this worktree's private home volume.

Keep the command running while using the app. Ctrl+C stops development, closes
both forwards and gracefully stops the backend before removing this worktree's
containers and exported images, even
if startup fails. The private provider home, named caches and `test-results`
evidence are retained.
`start` refuses to reuse existing worktree containers or occupied saved ports.
If you own an earlier terminal/editor session, stop it and run
`npm run devcontainer -- down` before starting again; never stop another task's
container or forwarding session. A `start.lock` in `.devcontainer/local` prevents
concurrent startup; preserve it after a forced kill until ownership is checked.

Default forwarding carries raw TCP over Docker exec stdio, bound to `127.0.0.1` on the
host and connected to `127.0.0.1` in the container. The existing exact Host/Origin,
browser authentication, event streams and Fast Refresh WebSockets are preserved.
No container ports are published and no app listener binds to a LAN interface.
There is a shared limit of 64 forwarded connections for this command.

## Optional LAN access

With the standalone `start` command running, open **Settings → Advanced → Web
Server Beta** through localhost. Enable it and use the displayed host LAN URL
and single-use pairing code from the other device. LAN always requires pairing;
only the controlling localhost browser manages the switch or creates codes.
The preference persists with development state. Backend restart requires fresh
pairing, while disabling access leaves approved work running.

The host launcher owns an additional listener on the primary private IPv4 address,
using this worktree's existing gateway port. It forwards only to a separate private
gateway ingress; Docker ports remain unpublished. Its private control channel has
bounded messages/deadlines and a renewable fifteen-second lease. Backend reload,
launcher exit and lost leases withdraw forwarding. Local forwards are unchanged.
Normal `up`/`exec` and editor sessions without the standalone controller report LAN
unavailable rather than advertising a container address.

LAN uses a bundled app built at development startup; it never exposes Vite/HMR,
source maps or development filesystem routes. Restart the development command to
rebuild renderer changes for LAN. The localhost browser keeps Fast Refresh.
HTTP traffic is unencrypted; use a trusted network. No firewall/router settings
are changed. If another listener owns the selected port, preserve it and resolve
ownership before retrying; the helper will not silently remap ports.

For isolated QA, a Node-only `CODE60_DEV_DATA_ROOT` absolute directory replaces
the default ignored `test-results/dev` config/state root. It is not a browser
operation. Use synthetic HOME/provider configuration and never point it at normal
user state. No service is installed.

## Persistent providers

Each worktree mounts its own named volume at `/home/node`, private to the container
user (mode `0700`). It retains provider login files, configuration, shell profiles
and tools installed in the home directory through `start`, `down` and recreation.
This includes directories such as `.codex`, `.claude`, `.config` and `.local`, plus
home-level files such as `.claude.json`. This volume is labelled `provider-state`,
separately from disposable container images and rebuildable caches.

Choose **Codex** in Code60's setup or **Providers → Add Provider**. Use
**Install Codex and sign in** when missing, or **Sign in to Codex** when authentication
is required. Copy the displayed code and open the official sign-in page in its
separate browser tab. Keep setup open until **Connected** appears. Device-code
login must be enabled in ChatGPT security settings. No terminal or VS Code is needed.

Code60 installs pinned `@openai/codex@0.171.0` privately under
`/home/node/.local/share/code60/providers/codex/0.171.0`, using non-root npm,
the official registry and disabled lifecycle scripts. It prefers this copy for
the standard connector without replacing existing installations. Codex credentials
remain in `/home/node/.codex`; both directories persist across container recreation.

Other providers and custom Codex commands retain manual installation/sign-in.
Global npm installs default to `/home/node/.local`; its `bin` directory is on PATH.
Install tools under `/home/node` so they persist. Root installs outside that home
remain part of the disposable container. Project `npm ci` does not remove these
separately installed provider tools. Cancelling setup does not delete credentials
or log out an account.

Sign in inside the container; no host home, credential files or authentication
sockets are mounted or imported. Each worktree's provider home is independent.
Normal `down` and test cleanup retain it. Removing that named volume explicitly
also removes its stored provider tools and logins; it is private state, not a
rebuildable dependency cache. Development Code60 settings/history remain under
this checkout's ignored `test-results/dev` directory.

When upgrading an older container that has no home volume, preserve any provider
files from that container before running `down`; a new mount cannot recover files
already removed with the old container.

## Prepare on the host

From the checkout root, using Node 24:

```sh
npm ci
npm run devcontainer -- prepare
```

Preparation generates ignored machine-specific Compose and `devcontainer.json`
configuration from the tracked `template.json`. Run it before reopening the editor;
the editor and terminal CLI use the same generated configuration. It discovers
the canonical checkout and common Git directory, preserving absolute paths so
ordinary clones and linked worktrees work even when their paths contain spaces.
Open the canonical path printed by preparation if you reached it through a symlink.
When upgrading an existing fixed-port container, run `npm run devcontainer -- down`
first, then prepare and start it again.

Only the checkout and, for a linked worktree, its common Git directory are bound
into the container. The container home uses a private named volume. Dependencies, build output,
npm cache, Chromium and model assets use separate named Linux-only caches. Host `node_modules`, `dist` and models
are hidden by those mounts and remain untouched. Test evidence under
`test-results` stays visible on the host.

The root cache-initialization service sees only those named volumes. The
development service and editor run as the non-root `node` user, with Linux host
UID/GID adjustment. Neither service has a Docker socket or privileged mode.

## Editor workflow

Use a separate unsigned-in VS Code instance with the generated user profile:

```sh
env -u SSH_AUTH_SOCK -u GPG_AGENT_INFO -u GIT_ASKPASS \
  code --user-data-dir "$PWD/.devcontainer/local/editor-profile" "$PWD"
```

Install the Dev Containers extension in that profile if necessary, then choose
**Dev Containers: Reopen in Container**. The generated profile disables Git
configuration/credential-helper copying; the container disables Git prompts and
global Git configuration. Do not import a signed-in profile, dotfiles or provider
credentials into this instance. Perform authenticated Git operations on the host.

Launching without the host agent environment is necessary: upstream reports that
an empty container `SSH_AUTH_SOCK` alone does not prevent the editor from creating
a forwarding socket ([Dev Containers issue](https://github.com/microsoft/vscode-remote-release/issues/11413)).
This workflow does not change settings in your normal editor profile.

Inside the container, install and prepare assets explicitly:

```sh
npm ci
npx --no-install playwright install chromium
npm run prepare:models
npm run dev
```

Preparation prints this worktree's gateway and Vite/HMR URLs. The editor forwards
its assigned pair, preserving the same local port numbers. Open the printed gateway
URL using `127.0.0.1` rather than `localhost`. Approve no remapping to different
ports: identify an occupied port's owner and stop only your own listener/forwarding,
or coordinate with its owner before retrying. Both servers retain their loopback bindings and existing
Host/Origin checks. No Docker ports are published to the LAN.

React Fast Refresh preserves the backend; compiled backend changes restart only
that backend. Closing the editor leaves this development container available.
Use the explicit cleanup command below when finished.

## Terminal workflow

The pinned official Dev Container CLI is installed by the host's `npm ci`:

```sh
npm run devcontainer -- up
npm run devcontainer -- exec npm ci
npm run devcontainer -- exec npx --no-install playwright install chromium
npm run devcontainer -- exec npm run prepare:models
npm run devcontainer -- exec npm run check
npm run devcontainer -- exec npm run test:browser -- --grep "browser: first use"
```

`exec` accepts an executable followed by arguments, without shell interpolation.
Use `exec bash` for an interactive shell. `npm run dev` also works inside this
shell. For host-browser access without an editor, use `start` above; `up` and
`exec` alone do not forward ports.
Headless Playwright runs entirely inside the container.

The container sets Vitest's supported `VITEST_MAX_WORKERS=2` to limit contention,
especially under amd64 emulation on Apple Silicon. Test timeouts, retry defaults
and coverage gates remain unchanged. Browser artifacts live in
`test-results/browser`, separate from development state and QA evidence.

These commands run no live provider or per-user service. The existing development
backend uses isolated state under `test-results/dev`. For Git commits, supply a
synthetic identity locally in test repositories or perform commits on the host.

## Concurrent agents

Read the [shared-host agent rules](../AGENTS.md#concurrent-work-on-a-shared-host)
and [host/container command guide](../CONTRIBUTING.md#shared-host-development).
Confirm your assigned checkout/branch and record its labels, ports, owned processes
and evidence paths. An idle worktree or stopped container may still belong to
another task; availability is not proof of ownership.

Give each agent a separate Git worktree and run the same host preparation/startup
commands from each worktree. Containers, images, dependency/build/model/browser
caches, development state and test evidence are separate. Agents can remain on
the host and use `exec`; provider credentials need not enter the container.

Port pairs are reserved in the common Git directory's `code60-devcontainers`
metadata, shared by linked worktrees. Allocation uses an exclusive, bounded lock
so simultaneous preparation cannot claim the same pair, including hash collisions.
Pairs are drawn from 40000–59999 and persist across `down`/`up`; preparation prints
both URLs and writes matching container and editor ports. Unrelated listeners are
skipped for a new reservation. An occupied saved port produces an error instead
of silently changing the origin. Close existing forwarding before rerunning
preparation/startup only when you own that forwarding session. If an unrelated
listener owns a saved port, coordinate with its owner/user instead of killing it
or changing the saved pair. The editor also requires the exact local ports, covering
listeners that appear after preparation. Independent repositories have separate
registries; occupied host ports are still checked, but reservations between
unrelated repositories are not coordinated.

Both worktrees can run development servers, headless browser journeys and editor
forwarding concurrently. Stop a foreground development server before running its
development browser journey, which tests that worktree's selected port pair.
Docker CPU/memory remains shared; each container limits Vitest to two workers.
Avoid competing full host checks during emulated container checks. Preserve
resource-related failures, then coordinate load before rerunning; keep existing
timeouts, retry policy and coverage gates.

`start` exit, `down` or a cancelled `exec` removes only that worktree's containers/images and
leaves another worktree running. Multiple agents sharing one worktree also share
its files and container lifecycle: a worktree label does not establish session
ownership. Coordinate an explicit handoff before reusing or stopping its container.
Do not restart Docker, switch its shared context or kill processes by executable name as
task cleanup. Port reservations are retained with caches;
never delete a preparation lock while another preparation process owns it.

## Cleanup and failures

Run this on the host, including after failed or interrupted tests:

```sh
npm run devcontainer -- down
```

The helper stops and removes this checkout's labelled containers, removes its
exported build/UID-adjusted images and verifies both inventories. It never prunes
Docker globally or force-removes an image used elsewhere. The private provider-home volume and npm, dependency,
Chromium, model and compiled-output cache volumes are intentionally retained;
BuildKit caches and host evidence are also retained. No custom network is created.

Failed startup attempts cleanup automatically. Cancelling a helper-driven `exec`
also attempts cleanup. Failed commands otherwise leave the container available
for inspection; finish with `down`. Cleanup failures produce a nonzero exit and
must be resolved before claiming a clean test session.

If Docker is unavailable, start it yourself and retry. Do not fall back to
installing a real user service. A container or fake-supervisor test cannot prove
launchd, systemd login lifecycle or native macOS behavior.
