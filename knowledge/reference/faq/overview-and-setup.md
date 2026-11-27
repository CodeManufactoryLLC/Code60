---
id: KB-REF-009
title: "FAQ: Overview, Requirements, and Setup"
domain: reference
kind: reference
status: active
summary: Frequently asked questions on what Code60 is, supported platforms, system and software requirements, Docker, CLI, and app format.
updated: 2026-11-27
code_refs:
  - src/management/cli.ts
  - src/gateway/server.ts
  - src/platform/support.ts
related:
  - KB-REF-010
  - KB-OPS-009
  - KB-OPS-012
tags:
  - faq
  - setup
  - requirements
---

# FAQ: Overview, Requirements, and Setup

> **Applies to:** Code60 `v0.5.0-beta` · **Last update:** `2026-11-27`
> Open **Manage → About** or run `code60 status` to check the local Code60 version. See [Code60 Terminology](../../../TERMINOLOGY.md) for key terms.

## Overview

### Is Code60 an agent?

No. Code60 is a local [orchestration](../../../TERMINOLOGY.md#orchestration) application for coding agents. External [Agent Providers](../../../TERMINOLOGY.md#agent-provider) supply the underlying models and coding agents.

Code60 connects to those providers through [Agent Client Protocol (ACP)](../../../TERMINOLOGY.md#acp) and coordinates them using its [Two-Layer Architecture](../../../TERMINOLOGY.md#two-layer-architecture). Code60 provides the browser interface, [Code60 Gateway](../../../TERMINOLOGY.md#gateway), separate Git worktrees, plans, reviews, **Scheduled Jobs**, **Workflows**, and Model Context Protocol (MCP) management.

## Requirements and Setup

### Which platforms does Code60 support?

Code60 supports **macOS Apple Silicon** (`arm64`) and **Linux `x64`**.

- **macOS:** Requires Apple Silicon (`arm64`).
- **Linux:** Requires `x64` with `glibc` and `libgomp1`. Per-user background service setup also requires an active user `systemd` session. Alpine (`musl`) and Linux `arm64` remain outside current support.
- **Software prerequisites:** Requires Node.js 24 (`>=24.22.0 <25` for setup, updates, and uninstall), `npm`, Git, and at least one **Agent Provider**.
- **Browser access:** Runs in a modern browser on the host machine, or from another device on a private network through **Web Server (Beta)**.

### Does Code60 support Windows?

No. Code60 currently supports **macOS Apple Silicon** and **Linux `x64`** only and blocks startup on Windows hosts.

A Windows device can still open Code60's browser interface over a private local network through **Web Server (Beta)**. Code60 must still run on a macOS or Linux host for that setup.

### What are the system requirements for running Code60?

- **Operating system:** **macOS Apple Silicon** (`arm64`) or **Linux `x64`** with `glibc` and `libgomp1`. Linux service enrollment also requires an active user `systemd` session.
- **Runtime and tools:** Node.js 24 (`>=24.22.0 <25` for setup, updates, and uninstall), `npm`, Git, and at least one **Agent Provider**.
- **Hardware and power:** Code60 runs local embeddings on the CPU and requires no graphics card. Background scheduling requires an awake machine with an active user login session.
- **Browser and optional tools:** A modern desktop browser for the interface. Browser automation (`code60_browser`) also requires Chrome on the host machine, plus Microsoft's Playwright Chrome extension for existing-browser mode.

### What software do I need to run Code60?

- **Core software:** Node.js 24 (`>=24.22.0 <25` for setup, updates, and uninstall), `npm`, Git, and a modern web browser.
- **Agent Provider:** At least one [Agent Provider](../../../TERMINOLOGY.md#agent-provider). A user can connect an existing command-line interface (CLI) or install a private copy for catalog providers from **Connect → Providers**.
- **Optional software:** Chrome on the host machine for `code60_browser` web automation (plus Microsoft's Playwright Chrome extension for existing-browser mode). Docker with Compose v2 is only for optional contributor container workflows.

See [What are the system requirements for running Code60?](#what-are-the-system-requirements-for-running-code60) for operating-system and hardware details.

### Do I need Docker to run Code60?

No. Code60 installs, runs, and supports local development without Docker.

Code60 runs natively on macOS Apple Silicon and Linux x64. It uses [Code60 Gateway](../../../TERMINOLOGY.md#gateway) (a local Node.js 24 backend), a browser interface, and separate Git worktrees for coding agents.

Code60 also provides a Linux `x64` Docker image (`mjholliday/code60`) on port `6060` for container setups. See the [Docker distribution guide](../../operations/distribution/docker.md) for setup and security options.

Only optional contributor workflows require a local Linux Docker engine with Compose v2. Docker Desktop remains optional.

- **Linux development container:** Contributors run `npm run devcontainer -- start` for the optional [Linux development container](../../../.devcontainer/README.md).
- **Clean-install acceptance tests:** Contributors run `npm run test:packaged:clean` for the container acceptance test suite.

Optional Docker agent workers for stricter filesystem and network boundaries appear on the future roadmap. Code60 runs without them.

### Does Code60 have a CLI?

Yes, for local lifecycle management only. The `code60` CLI cannot submit prompts or run coding agents.

- **Opening and pairing:** `code60 open` opens the browser interface, and `code60 pairing on|off|status` controls local pairing codes.
- **Installation and backend service:** `code60 setup`, `code60 status`, `code60 update`, `code60 uninstall`, and `code60 service` manage installation and the per-user Code60 Gateway service.
- **Usage reports:** `code60 usage` prints local token-usage summaries and turn breakdowns in table, JSON, Markdown, or CSV format without running agents.

### Does Code60 have a native desktop app?

No. Code60 runs [Code60 Gateway](../../../TERMINOLOGY.md#gateway) (a local Node.js 24 backend) with a React browser interface.

There is no Electron wrapper, native window application, or DMG, DEB, or AppImage installer. Closing or refreshing the browser keeps active agents, **Scheduled Jobs**, and **Workflows** running in the background.

### Does Code60 have a native mobile app?

No. Code60 has no native iOS or Android app.

A phone or tablet on the same private local network can open Code60's browser interface through **Web Server (Beta)**. A user turns it on from the controlling localhost browser under **Experiments → Web Server (Beta)** and enters the single-use 60-second code. File choosers still browse files on the host machine running Code60.
