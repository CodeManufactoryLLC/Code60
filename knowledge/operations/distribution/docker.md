---
id: KB-OPS-012
title: Docker Hub Distribution
domain: operations
kind: runbook
status: active
summary: Run, configure, build, test, and publish the optional linux/amd64 Code60 Docker image (mjholliday/code60).
updated: 2026-11-27
code_refs:
  - docker/Dockerfile
  - docker/compose.yaml
  - src/gateway/container.ts
  - scripts/package-docker.mjs
related:
  - KB-OPS-007
  - KB-OPS-009
tags:
  - distribution
  - docker
  - container
  - release
---

# Docker Hub Distribution

Code60 distributes an optional `linux/amd64` Docker image (`mjholliday/code60`) built directly from the verified `linux-x64` release payload. It runs [Code60 Gateway](../../../TERMINOLOGY.md#gateway) in the foreground on port `6060` under `tini` as the non-root `node` user with `/opt/code60` read-only.

## Quick start

```sh
docker run --rm -it \
  --name code60 \
  -p 127.0.0.1:6060:6060 \
  -v code60-home:/home/node \
  -v "$HOME/projects:/workspaces" \
  mjholliday/code60:latest
```

Open `http://127.0.0.1:6060` in a browser. See [docker/compose.yaml](../../../docker/compose.yaml) for the ready-to-use Compose configuration and [docker/README.md](../../../docker/README.md) for the Docker Hub overview.

## Runtime options and security boundaries

- **Default port (`6060`):** Non-privileged, outside the dev-container reserved range (`40000–59999`), avoiding common `3000`/`4173`/`5173`/`8080` collisions.
- **Exact `Host` and `Origin` checks:** Binding `0.0.0.0:6060` (`CODE60_BIND`) inside the container enables host loopback publishing (`-p 127.0.0.1:6060:6060`) without loosening `Host`/`Origin` enforcement. When remapping the host port (for example `-p 127.0.0.1:8080:6060`), set `CODE60_ORIGIN=http://127.0.0.1:8080`.
- **Mandatory pairing for non-loopback origins:** Setting `CODE60_ORIGIN` to a non-loopback host forces pairing on and refuses disabling pairing.
- **Loopback-only management:** `/management/*` routes require container loopback sockets plus the private `connection.json` token; external requests over the published port receive `403`.
- **In-container commands:**
  - `docker exec code60 code60 pairing on --yes` — enable pairing codes.
  - `docker exec code60 code60-gateway pair` — print the browser URL and a fresh 60-second pairing code.
  - `docker exec code60 code60-gateway health` — run the container loopback health check.
- **Persistence and Compose variables:** Mount a private named volume at `/home/node` (`0700`) so databases, Relay state, and provider logins survive upgrades, and bind-mount project directories at `/workspaces` (or set `CODE60_WORKSPACE_ROOTS`). On first startup, gateway initialization automatically creates `/home/node/.local/share/code60/databases/default.sqlite` when no selection exists yet. [docker/compose.yaml](../../../docker/compose.yaml) parameterizes `CODE60_IMAGE_TAG` (`latest`), `CODE60_HOST_PORT` (`6060`), `CODE60_WORKSPACES` (`./workspaces`), and `CODE60_HOME_VOLUME` (`code60-home`) so sessions share one named volume across directories.
- **Upgrades:** Pull the newer image tag and recreate the container while keeping the `/home/node` volume. Host `code60 service` and `code60 update` commands do not manage Docker containers.

## Local build and acceptance test

Build the verified `linux-x64` payload in the pinned development container first, then build and test the image on the host:

```sh
npm run devcontainer -- up
npm run devcontainer -- exec npm ci
npm run devcontainer -- exec npm run prepare:models
npm run devcontainer -- exec npm run package:payload
npm run devcontainer -- down
npm run package:docker -- release/payloads/linux-x64.json
npm run test:docker -- release/payloads/linux-x64.json
```

`npm run test:docker` builds a uniquely labeled temporary image and verifies non-root execution, read-only `/opt/code60`, executable `code60-pty`, offline 768-dimensional embeddings (`--network none`), published loopback HTTP access, `Host`/`Origin` and external `/management/*` rejections, default database initialization, in-container pairing, graceful `SIGTERM` exit, and persistence across container recreation against the same named volume, then cleans up all owned resources. Evidence is written to `test-results/docker/<run-id>/report.json`.

## Docker Hub setup and publishing

One-time setup: create `mjholliday/code60` on Docker Hub with a scoped Read & Write Access Token, then configure GitHub's `dockerhub_release` environment (restricted to `main`) with variable `DOCKERHUB_USERNAME`, secret `DOCKERHUB_TOKEN`, and optional variable `DOCKERHUB_REPOSITORY` (defaults to `mjholliday/code60`).

To publish a release image:

1. Tag the merged release commit on `main` (`vX.Y.Z` or `vX.Y.Z-beta.N`) per [RELEASING.md](../../../RELEASING.md).
2. Run a dry run first (builds and tests without pushing):

```sh
gh workflow run publish-docker.yml --ref main -f tag=v0.5.0-beta -f push=false
```

3. Push the verified `linux/amd64` image with SBOM and provenance attestations:

```sh
gh workflow run publish-docker.yml --ref main -f tag=v0.5.0-beta -f push=true
```

Stable tags publish `:X.Y.Z`, `:X.Y`, `:X`, and `:latest`. Prerelease tags publish only `:X.Y.Z-beta.N` (or `:X.Y.Z-beta`) and never move `:latest`.
