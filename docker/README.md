# Code60

Code60 is a local browser application for orchestrating coding agents in parallel with Git worktrees, plans, reviews, local offline embeddings, scheduled jobs, and MCP server management.

- Source repository: https://github.com/CodeManufactoryLLC/code60
- License: Apache-2.0
- Architecture: `linux/amd64` (Debian 12 / Node 24 with bundled offline Jina INT8 CPU embeddings)

## Quick start

Run Code60 bound to your machine's loopback interface on port `6060`:

```sh
docker run --rm -it \
  --name code60 \
  -p 127.0.0.1:6060:6060 \
  -v code60-home:/home/node \
  -v "$HOME/projects:/workspaces" \
  mjholliday/code60:latest
```

Open `http://127.0.0.1:6060` in your browser. On first startup, Code60 automatically initializes its default SQLite database at `/home/node/.local/share/code60/databases/default.sqlite` inside the `code60-home` volume (preserving any existing database selection on restarts). Install and sign in to coding-agent providers directly from Code60's UI; databases, provider tools, and logins persist in the `code60-home` volume.

## Docker Compose

```yaml
services:
  code60:
    image: mjholliday/code60:latest
    platform: linux/amd64
    restart: unless-stopped
    ports:
      - "127.0.0.1:6060:6060"
    volumes:
      - code60-home:/home/node
      - "$HOME/projects:/workspaces"

volumes:
  code60-home:
    name: code60-home
```

## Configuration

| Environment variable | Default | Description |
| --- | --- | --- |
| `CODE60_PORT` | `6060` | Listening port inside the container (`1`–`65535`). |
| `CODE60_BIND` | `0.0.0.0` | Container bind address (`0.0.0.0` or `127.0.0.1`). |
| `CODE60_ORIGIN` | `http://127.0.0.1:<CODE60_PORT>` | Exact browser origin allowed by strict `Host`/`Origin` checks. Set this if you map a different host port (for example `-p 127.0.0.1:8080:6060` with `CODE60_ORIGIN=http://127.0.0.1:8080`). |
| `CODE60_WORKSPACE_ROOTS` | `/workspaces` | Colon-separated absolute paths exposed to the browser workspace chooser. |
| `CODE60_HOME_VOLUME` | `code60-home` | *(Compose only)* Named Docker volume mounted at `/home/node`. Pinning `name: code60-home` ensures `docker compose` sessions share the same SQLite database and settings across folders and container recreations (including `docker compose down`). |

## Security and pairing

- Always publish the port to host loopback (`-p 127.0.0.1:6060:6060`) unless you intentionally place Code60 behind TLS on a trusted private network.
- Non-loopback `CODE60_ORIGIN` values automatically require a 60-second single-use pairing code and cannot turn pairing off.
- Enable or inspect pairing inside a running container:

```sh
docker exec code60 code60 pairing on --yes
docker exec code60 code60-gateway pair
```

- Private management routes (`/management/*`) accept container loopback connections only.
- The `/opt/code60` application directory is read-only at runtime; the container runs as the non-root `node` user under `tini`.

## Upgrading

Pull the newer image tag and recreate the container while keeping the `code60-home` volume:

```sh
docker pull mjholliday/code60:latest
docker stop code60 && docker rm code60
```

Then start the new container with the same `-v code60-home:/home/node` volume.
