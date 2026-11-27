---
id: KB-ARCH-001
title: "C4 Level 1: System Context"
domain: architecture
kind: subsystem
status: active
summary: Actors, external systems, and trust boundaries surrounding Code60 in Structurizr view code60-context.
updated: 2026-11-27
code_refs:
  - architecture/structurizr/model/people-and-external.dsl
  - architecture/structurizr/views/context-and-containers.dsl
  - SECURITY.md
related:
  - KB-ARCH-002
  - KB-ARCH-006
tags:
  - c4
  - architecture
  - context
---

# C4 Level 1: System Context

Structurizr view: `code60-context` ([people-and-external.dsl](../../../architecture/structurizr/model/people-and-external.dsl)).

## 1. System Boundary

Code60 is a local Node.js 24 backend and React/IBM Carbon browser application that orchestrates coding agents in isolated Git worktrees on macOS (`darwin-arm64`) and Linux (`linux-x64`). Browser controls protect the UI and gateway API; they do not OS-sandbox launched agent processes (see [SECURITY.md](../../../SECURITY.md), `SEC-1.3.1`–`SEC-1.3.7`).

## 2. Actors

| Actor | Access path | Authority |
| --- | --- | --- |
| **Developer / Local Operator** | Localhost browser (`127.0.0.1:<port>`) and local terminal `code60` CLI | Full application control, local service lifecycle, pairing policy, and Web Server (Beta) toggle. |
| **LAN Paired User** | Trusted RFC1918 IPv4 browser (`http://<lan-ip>:<port>`) with 60s single-use 6-digit code | Full application control after explicit takeover; cannot toggle LAN policy or call `/management/*` (`SEC-1.4.12`, `SEC-1.4.14`). |

## 3. External Systems

| External system | Protocol / boundary | Notes |
| --- | --- | --- |
| **ACP Coding-Agent Harnesses** | ACP JSON-RPC over stdio | 7 catalog providers (Antigravity, Claude, Codex, Copilot, Droid, Kiro, OpenCode) plus custom commands; authenticate externally or via scoped setup (`SEC-4.2.*`). |
| **External MCP Servers & OAuth IdPs** | Stdio / Streamable HTTP + OAuth 2.1 PKCE S256 | Backend-owned connectors; agents receive only capability-leased local stdio adapters (`SEC-4.3.*`). |
| **Chrome / Chromium (Playwright MCP)** | Pinned `@playwright/mcp@0.0.84` over stdio | Lazy per-conversation `code60_browser` tool in headless, visible isolated, or extension mode. |
| **OS Service Supervisor** | `launchctl` / `systemctl --user` | Opt-in per-user login service managed strictly via local CLI consent (`SEC-1.2.7`). |
| **OS Secret Store** | macOS Keychain / Linux Secret Service | Accessed only via short-lived isolated `credential-helper` process (`SEC-4.3.8`). |
| **Local Git & Workspaces** | `git` CLI & POSIX filesystem | Constrained to configured chooser `roots`; worktrees isolate repo edits (`code60/*`). |
| **Package & Release Registries** | HTTPS (npm, GitHub Releases, provider CDNs, Docker Hub) | Explicit SHA-256 verified payload/provider installs and `mjholliday/code60` image. |
