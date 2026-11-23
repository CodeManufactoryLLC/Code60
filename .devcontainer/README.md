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

## Prepare on the host

From the checkout root, using Node 24:

```sh
npm ci
npm run devcontainer -- prepare
```

Preparation generates ignored machine-specific Compose configuration. It discovers
the canonical checkout and common Git directory, preserving absolute paths so
ordinary clones and linked worktrees work even when their paths contain spaces.
Open the canonical path printed by preparation if you reached it through a symlink.

Only the checkout and, for a linked worktree, its common Git directory are bound
into the container. Container dependencies, build output, npm cache, Chromium and
model assets use named Linux-only caches. Host `node_modules`, `dist` and models
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

The editor forwards gateway port **43160** and Vite/HMR port **43161**, preserving
the same local port numbers. Open `http://127.0.0.1:43160`, using `127.0.0.1`
rather than `localhost`. Approve no remapping to different ports: free an occupied
port and retry. Both servers retain their loopback bindings and existing
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
shell; host-browser forwarding is supplied by the editor, not by the standalone CLI.
Headless Playwright runs entirely inside the container.

The container sets Vitest's supported `VITEST_MAX_WORKERS=2` to limit contention,
especially under amd64 emulation on Apple Silicon. Test timeouts, retry defaults
and coverage gates remain unchanged. Browser artifacts live in
`test-results/browser`, separate from development state and QA evidence.

These commands run no live provider or per-user service. The existing development
backend uses isolated state under `test-results/dev`. For Git commits, supply a
synthetic identity locally in test repositories or perform commits on the host.

## Cleanup and failures

Run this on the host, including after failed or interrupted tests:

```sh
npm run devcontainer -- down
```

The helper stops and removes this checkout's labelled containers, removes its
exported build/UID-adjusted images and verifies both inventories. It never prunes
Docker globally or force-removes an image used elsewhere. npm, dependency,
Chromium, model and compiled-output cache volumes are intentionally retained;
BuildKit caches and host evidence are also retained. No custom network is created.

Failed startup attempts cleanup automatically. Cancelling a helper-driven `exec`
also attempts cleanup. Failed commands otherwise leave the container available
for inspection; finish with `down`. Cleanup failures produce a nonzero exit and
must be resolved before claiming a clean test session.

If Docker is unavailable, start it yourself and retry. Do not fall back to
installing a real user service. A container or fake-supervisor test cannot prove
launchd, systemd login lifecycle or native macOS behavior.
