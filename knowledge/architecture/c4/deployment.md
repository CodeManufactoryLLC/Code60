---
id: KB-ARCH-006
title: "C4 Deployment Views: Native Host and Docker"
domain: architecture
kind: subsystem
status: active
summary: Production deployment topologies for native macOS/Linux login services and the mjholliday/code60 Docker image.
updated: 2026-11-27
code_refs:
  - architecture/structurizr/model/deployment.dsl
  - docker/Dockerfile
  - docker/compose.yaml
  - src/platform/user-service.ts
related:
  - KB-ARCH-001
  - KB-ARCH-002
tags:
  - c4
  - architecture
  - deployment
  - docker
---

# C4 Deployment Views: Native Host and Docker

Structurizr views: `deploy-native` and `deploy-docker` ([deployment.dsl](../../../architecture/structurizr/model/deployment.dsl)).

## 1. `NativeHost` — macOS arm64 & Linux x64 Login Service

- **Host requirements:** Node.js 24 (`>=24.22.0 <25` for managed `setup`/`update`/`uninstall`), npm, Git, and a supported ACP provider.
- **Supervision:** Opt-in per-user login service registered with macOS `launchd` (`com.codemanufactory.code60.backend`) or Linux `systemd --user` (`code60-backend.service`).
- **Process layout:** Gateway binds `127.0.0.1:0` (ephemeral loopback port) and spawns bounded child processes as needed (ACP harnesses, MCP sidecar/adapters, RAG/Memory IPC workers, `credential-helper`, `code60-pty`).
- **Private storage:** Mode `0700`/`0600` directories under `$XDG_CONFIG_HOME/code60`, `$XDG_DATA_HOME/code60`, and `$XDG_STATE_HOME/code60`, plus user-selected Git repos and SQLite databases.
- **Optional LAN ingress:** Localhost-only Web Server (Beta) binds a second HTTP listener on the host's primary RFC1918 IPv4 address using the same gateway port (`SEC-1.4.*`).

## 2. `DockerContainer` — `mjholliday/code60` (Linux x64)

- **Base image:** Digest-pinned `node:24.22.0-bookworm-slim` (`linux/amd64`, Debian glibc + `libgomp1` for bundled ONNX CPU embeddings), running as non-root user `node` under `/usr/bin/tini`.
- **Entrypoint & port:** `code60-gateway serve` (`dist/gateway/container.js`) listens on container port `6060` (`CODE60_BIND=0.0.0.0`, `CODE60_WORKSPACE_ROOTS=/workspaces`), published strictly to host loopback `127.0.0.1:${CODE60_HOST_PORT:-6060}:6060`.
- **Persistence:** Named volume `code60-home:/home/node` preserves databases, Relay state, MCP configs, and provider logins; host project folders bind-mount to `/workspaces`.
- **Health & pairing:** Container `HEALTHCHECK` runs `code60-gateway health`; operators enable/manage pairing via `docker exec ... code60 pairing ...`.
