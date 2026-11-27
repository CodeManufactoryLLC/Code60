---
id: KB-ARCH-002
title: "C4 Level 2: Containers and Data Stores"
domain: architecture
kind: subsystem
status: active
summary: Executable runtime processes, sidecars, helpers, and persistent data stores in Structurizr view code60-containers.
updated: 2026-11-27
code_refs:
  - architecture/structurizr/model/containers.dsl
  - src/gateway/main.ts
  - src/management/cli.ts
related:
  - KB-ARCH-001
  - KB-ARCH-003
  - KB-ARCH-004
tags:
  - c4
  - architecture
  - containers
---

# C4 Level 2: Containers and Data Stores

Structurizr view: `code60-containers` ([containers.dsl](../../../architecture/structurizr/model/containers.dsl)).

## 1. Executable Containers

| Container | Runtime / Entrypoint | Ownership |
| --- | --- | --- |
| **Browser SPA** | React 19 + Carbon bundle (`dist/renderer/`, `src/renderer/main.tsx`) | Interactive UI; talks only to Gateway over same-origin HTTP + SSE. |
| **Code60 Gateway** | Node.js 24 (`src/gateway/main.ts`, `src/gateway/container.ts`) | Serves SPA, HTTP/SSE RPCs, single-controller sessions, LAN ingress, `ApplicationHost`, in-process Scheduler, MCP Gateway/Broker, and OAuth callbacks. |
| **Management CLI (`code60`)** | Node.js 24 CLI (`src/management/cli.ts`) | `setup`, `status`, `open`, `service`, `pairing`, `usage`, `update`, `uninstall`; talks to `/management/*` via `connection.json` secret. |
| **Orchestration MCP Sidecar** | Node.js stdio (`src/application/mcp-server.ts`) | Spawned by ACP orchestrators; forwards `code60_*` tool calls to loopback `POST /v1/call` with Bearer token. |
| **External MCP Stdio Adapter** | Node.js stdio (`src/agents/mcp-adapter.ts`) | Capability-leased per-session proxy to Gateway's loopback `mcp-broker`; never receives upstream configs or secrets. |
| **RAG Worker** | Forked Node IPC (`src/application/rag-worker.ts`) | Single-flight conversation indexing and retrieval via local ONNX embeddings. |
| **Memory Worker** | Forked Node IPC (`src/application/memory-worker.ts`) | Owns `memory.sqlite` (FTS5 + 768-dim vectors); auto-retires after 60s idle. |
| **Credential Helper** | Isolated Node child (`src/platform/credential-helper.ts`) | Runs `@napi-rs/keyring` over stdin/stdout pipes for Keychain / Secret Service (`SEC-4.3.8`). |
| **POSIX PTY Helper** | Native C binary (`native/posix/code60-pty.c` -> `dist/platform/code60-pty`) | Allocates PTYs for up to 16 interactive browser xterm.js shells. |

## 2. Persistent Data Stores

| Store | Primary paths | Format & retention |
| --- | --- | --- |
| **Project DB & Sidecar** | User `.sqlite` or `$XDG_DATA_HOME/code60/databases/default.sqlite` + `.code60_workspace/` | SQLite `SCHEMA = 6` (projects, configs, prompts, commands) + JSON chats, plans, reviews, checkpoints, RAG index. |
| **Memory Database** | `$XDG_STATE_HOME/code60/memory/memory.sqlite` | SQLite `user_version = 2` (FTS5 + 768-dim vector blobs). |
| **Operational Stores** | `$XDG_STATE_HOME/code60/{workflows/workflows.sqlite,usage/usage.sqlite,automations/state.json,relay/state.json,custom-agents/}` | SQLite (`usage.sqlite` 90d / 500k turns; `workflows.sqlite` 1,000 / 16 MiB) and private CAS JSON. |
| **Run Records & Logs** | `<gitCommonDir>/code60/runs/<id>/` (or `$XDG_STATE_HOME/code60/dirs/<key>/runs/`) & `$XDG_STATE_HOME/code60/logs/` | Private `0700`/`0600` `run.json` + `events.jsonl` (unexpired) and typed diagnostic JSONL (7d / 20 MiB cap, `SEC-3.2.1`). |
| **Config, MCP & Install State** | `$XDG_CONFIG_HOME/code60/{config.json,mcp.json}`, `<project>/.code60/mcp.json`, `$XDG_STATE_HOME/code60/{gateway,mcp-*}/`, `$XDG_DATA_HOME/code60/{activations,providers}/` | Guarded atomic JSON, transactional journals/backups, service metadata, and versioned activations. |
| **Offline Embedding Model** | `models/jinaai/jina-embeddings-v2-base-code` | Bundled read-only INT8 ONNX model (`allowRemoteModels = false`). |
