---
id: KB-ARCH-005
title: "C4 Dynamic Views: Core Runtime Flows"
domain: architecture
kind: subsystem
status: active
summary: End-to-end runtime interaction sequences modeled in Structurizr views/dynamic.dsl.
updated: 2026-11-27
code_refs:
  - architecture/structurizr/views/dynamic.dsl
  - src/gateway/server.ts
  - src/application/controller.ts
related:
  - KB-ARCH-002
  - KB-ARCH-003
tags:
  - c4
  - architecture
  - dynamic
  - flows
---

# C4 Dynamic Views: Core Runtime Flows

Structurizr views: [dynamic.dsl](../../../architecture/structurizr/views/dynamic.dsl).

## 1. `flow-browser-session` — Browser Auth, Single-Controller Lease & SSE
1. Browser opens `http://127.0.0.1:<port>`, checks `GET /api/connection`, and authenticates via `POST /api/connect` (local default) or `POST /api/pair` (when pairing is enabled).
2. Browser claims mutation authority with `POST /api/control` (detaching any prior controller with a `control-lost` SSE event).
3. Browser holds `GET /api/events` (SSE with 15s heartbeats and resync snapshots) and submits validated mutations to `POST /api/operation` with UUID idempotency receipts.

## 2. `flow-agent-orchestration` — Chat Dispatch, Worktree & MCP Sidecar
1. `ApplicationHost` creates an isolated Git worktree (`code60/*`) and pre-turn checkpoint snapshot, then starts loopback `mcp-gateway` (`127.0.0.1:<port>/v1/call`).
2. `Core` spawns the configured ACP harness over stdio with the `mcp-server.ts` sidecar descriptor and ephemeral Bearer token.
3. Agent tool calls (`code60_*`, including `code60_browser` -> Playwright MCP) round-trip through the loopback gateway; ACP updates stream to `events.jsonl`, `usage.sqlite`, and browser SSE.

## 3. `flow-mcp-oauth` — External MCP OAuth & Capability-Leased Adapter
1. Gateway opens an ephemeral loopback callback (`127.0.0.1:0/oauth/callback`, 5m TTL, PKCE S256); the user authorizes at the IdP.
2. Gateway persists tokens via short-lived `credential-helper` -> OS Keychain / Secret Service (or explicit RAM-only).
3. ACP sessions receive only fixed `mcp-adapter.ts` stdio proxies holding a streaming `/lease` against Gateway's `mcp-broker`; revoking the lease immediately aborts in-flight tool calls (`SEC-4.3.2`).

## 4. `flow-cli-lifecycle`, `flow-scheduled-job` & `flow-lan-pairing`
- **CLI lifecycle:** `code60` CLI verifies npm/GitHub SHA-256 payloads, checks idle ownership via `/management/*` (`connection.json` secret), updates atomic activation receipts, and manages `launchd` / `systemd --user`.
- **Scheduled jobs:** In-process 1s tick scheduler evaluates `automations/state.json`, acquires lane (`1` prompt / `2` workflow) and per-repo locks, branches an isolated worktree, and runs headless deny-by-default ACP turns or native `WorkflowEngine` steps.
- **LAN pairing:** Localhost enables Web Server (Beta) on primary RFC1918 IPv4 and generates a 60s 6-digit code; LAN browser exchanges it at `POST /api/pair` for a LAN-scoped session (`SEC-1.4.*`).
