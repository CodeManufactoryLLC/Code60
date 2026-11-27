---
id: KB-ARCH-003
title: "C4 Level 3: Backend Components and Module Boundaries"
domain: architecture
kind: subsystem
status: active
summary: Gateway internal components and the 11-module import dependency rules enforced by test/boundaries.test.ts.
updated: 2026-11-27
code_refs:
  - architecture/structurizr/model/components-gateway.dsl
  - test/boundaries.test.ts
related:
  - KB-ARCH-002
  - KB-ARCH-004
tags:
  - c4
  - architecture
  - components
  - boundaries
---

# C4 Level 3: Backend Components and Module Boundaries

Structurizr view: `code60-gateway-components` ([components-gateway.dsl](../../../architecture/structurizr/model/components-gateway.dsl)).

## 1. Enforced 11-Module Dependency Graph

[test/boundaries.test.ts](../../../test/boundaries.test.ts) statically enforces that every file under `src/` belongs to one of 11 modules, imports sibling modules exclusively through `../<module>/index.js`, never imports `electron`, keeps `renderer`/`bridge`/`contracts` free of `node:*` imports, and allows only the edges below:

| Module (`src/<name>`) | Allowed internal dependencies | Exclusive package ownership |
| --- | --- | --- |
| `gateway` | `application`, `automation`, `bridge`, `contracts`, `core`, `platform`, `agents` | — |
| `application` | `core`, `bridge`, `platform`, `automation` | — |
| `management` | `gateway`, `platform`, `core`, `contracts` | — |
| `automation` | `core`, `contracts`, `platform` | — |
| `renderer` | `bridge`, `core` *(type-only)* | `react`, `react-dom`, `react-markdown`, `remark-gfm`, `@carbon/react`, `@headless-tree/*`, `monaco-editor`, `@xterm/*` |
| `bridge` | `core` *(type-only)*, `contracts` | — |
| `core` | `agents`, `git`, `contracts`, `platform` | — |
| `agents` | `contracts`, `platform` | `@agentclientprotocol/sdk`, `@modelcontextprotocol/sdk` |
| `git` | `platform` | — |
| `contracts` | *(none)* | `zod` only (browser-safe) |
| `platform` | *(none)* | `@napi-rs/keyring` |

## 2. Key Architectural Invariants

- **Transport isolation:** `application` never imports `agents` directly; `gateway` composes upstream MCP transport connectors from `agents` and injects them into `application`.
- **Browser-safe contracts:** `contracts`, `bridge`, and `renderer` cannot import `node:*` built-ins; `renderer` and `bridge` may import `core` types only.
- **Zero Electron:** Importing `electron` or `electron-updater` anywhere in `src/` fails `test/boundaries.test.ts`.
- **C4 model parity:** `npm run c4:check` verifies every directory in `src/` maps 1:1 to a `src_module` property in `architecture/structurizr/model/`.
