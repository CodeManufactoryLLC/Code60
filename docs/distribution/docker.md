# Docker Hub distribution

Code60 distributes an optional `linux/amd64` Docker image (`mjholliday/code60`) built directly from the verified `linux-x64` release payload. It runs [Code60 Gateway](../../TERMINOLOGY.md#gateway) in the foreground on port `6060` under `tini` as the non-root `node` user with `/opt/code60` read-only.

## Quick start

```sh
docker run --rm -it \
  --name code60 \
  -p 127.0.0.1:6060:6060 \
  -v code60-home:/home/node \
  -v "$HOME/projects:/workspaces" \
  mjholliday/code60:latest
```

Open `http://127.0.0.1:6060` in a browser. A ready-to-use Compose file lives in [docker/compose.yaml](../../docker/compose.yaml) and the Docker Hub overview lives in [docker/README.md](../../docker/README.md).

## Runtime options and security boundaries

- **Default port (`6060`):** Non-privileged, outside the development-container reserved range (`40000–59999`), and avoids common `3000`/`4173`/`5173`/`8080` collisions.
- **Exact `Host` and `Origin` checks:** Binding `0.0.0.0:6060` inside the container enables host loopback port publishing (`-p 127.0.0.1:6060:6060`) without loosening `Host`/`Origin` enforcement. When remapping the host port (for example `-p 127.0.0.1:8080:6060`), set `CODE60_ORIGIN=http://127.0.0.1:8080`.
- **Mandatory pairing for non-loopback origins:** Setting `CODE60_ORIGIN` to a non-loopback host forces pairing on and refuses disabling pairing.
- **Loopback-only management:** `/management/*` routes require container loopback sockets plus the private `connection.json` token. External requests sent over the published port receive `403`.
- **In-container commands:**
  - `docker exec code60 code60 pairing on --yes` — enable pairing codes.
  - `docker exec code60 code60-gateway pair` — print the browser URL and a fresh 60-second pairing code.
  - `docker exec code60 code60-gateway health` — run the container loopback health check.
- **Persistence:** Mount a private named volume at `/home/node` (`0700`) so databases, Relay state, and provider logins survive container upgrades, and bind-mount project directories at `/workspaces` (or configure `CODE60_WORKSPACE_ROOTS`). On first startup, gateway initialization automatically creates `/home/node/.local/share/code60/databases/default.sqlite` inside `/home/node` when no selection exists yet. [docker/compose.yaml](../../docker/compose.yaml) pins `volumes.code60-home.name` to `${CODE60_HOME_VOLUME:-code60-home}` so Compose sessions share the same volume across directories without directory-based prefixing.
- **Upgrades:** Pull the newer image tag and recreate the container while keeping the `/home/node` volume. Host `code60 service` / `code60 update` commands do not manage Docker containers.

## Local build and acceptance test

Build the verified `linux-x64` payload in the pinned development container first, then build and test the Docker image on the host:

```sh
npm run devcontainer -- up
npm run devcontainer -- exec npm ci
npm run devcontainer -- exec npm run prepare:models
npm run devcontainer -- exec npm run package:payload
npm run devcontainer -- down
npm run package:docker -- release/payloads/linux-x64.json
npm run test:docker -- release/payloads/linux-x64.json
```

`npm run test:docker` builds a uniquely labeled temporary image, verifies non-root execution, read-only `/opt/code60`, executable `code60-pty`, real offline 768-dimensional embeddings (`--network none`), published loopback HTTP access, `Host`/`Origin` and external `/management/*` rejections, automatic default database initialization, in-container pairing, graceful `SIGTERM` exit, and database/settings persistence across container deletion and recreation against the same named volume, then removes all owned containers, images, and volumes. Evidence is written under `test-results/docker/<run-id>/report.json`.

## One-time Docker Hub and GitHub setup

1. Create the repository `mjholliday/code60` on Docker Hub.
2. Create a Docker Hub **Access Token** with **Read & Write** permissions scoped to `mjholliday/code60`.
3. In GitHub **Settings → Environments**, create a `dockerhub_release` environment restricted to the `main` branch and add:
   - Environment variable `DOCKERHUB_USERNAME`: your Docker Hub username (`mjholliday`)
   - Environment secret `DOCKERHUB_TOKEN`: the scoped Access Token
   - Optional repository variable `DOCKERHUB_REPOSITORY`: defaults to `mjholliday/code60` if unset.

## Publishing a release image

1. Tag the merged release commit on `main` (`vX.Y.Z` or `vX.Y.Z-beta.N`) following [RELEASING.md](../../RELEASING.md).
2. Run a dry run first (builds and tests without pushing):

```sh
gh workflow run publish-docker.yml --ref main -f tag=v0.4.1 -f push=false
```

3. Push the verified `linux/amd64` image with SBOM and provenance attestations:

```sh
gh workflow run publish-docker.yml --ref main -f tag=v0.4.1 -f push=true
```

Stable tags publish `:X.Y.Z`, `:X.Y`, `:X`, and `:latest`. Prerelease tags (`vX.Y.Z-beta.N`) publish only `:X.Y.Z-beta.N` and never move `:latest`.
