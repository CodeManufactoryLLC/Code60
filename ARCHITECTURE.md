# Code60 Architecture

Code60 is a local Node.js 24 backend and React 19 / IBM Carbon browser application for orchestrating coding agents in isolated Git worktrees on macOS (`darwin-arm64`) and Linux (`linux-x64`). There is no Electron runtime, preload bridge, or external workflow-engine daemon.

## C4 Architecture & Progressive Navigation

Code60's canonical architecture is modeled in modular Structurizr DSL at [architecture/structurizr/workspace.dsl](architecture/structurizr/workspace.dsl) and documented in bounded progressive-disclosure pages under [knowledge/architecture/c4/INDEX.md](knowledge/architecture/c4/INDEX.md):

- **Level 1 — System Context (`code60-context`):** [context.md](knowledge/architecture/c4/context.md) (`KB-ARCH-001`)
- **Level 2 — Containers & Data Stores (`code60-containers`):** [containers.md](knowledge/architecture/c4/containers.md) (`KB-ARCH-002`)
- **Level 3 — Backend Components & Module Boundaries (`code60-gateway-components`):** [components-backend.md](knowledge/architecture/c4/components-backend.md) (`KB-ARCH-003`)
- **Level 3 — Browser SPA Components (`code60-renderer-components`):** [components-renderer.md](knowledge/architecture/c4/components-renderer.md) (`KB-ARCH-004`)
- **Dynamic Views — Core Runtime Flows:** [runtime-flows.md](knowledge/architecture/c4/runtime-flows.md) (`KB-ARCH-005`)
- **Deployment Views — Native Host & Docker:** [deployment.md](knowledge/architecture/c4/deployment.md) (`KB-ARCH-006`)
- **Structurizr Tooling & Local Viewer Guide:** [structurizr-guide.md](knowledge/architecture/structurizr-guide.md) (`KB-ARCH-007`)

## Module Boundaries (`src/`)

All 11 modules under `src/` are enforced statically by [test/boundaries.test.ts](test/boundaries.test.ts) (cross-module imports must use `../<module>/index.js`; `renderer`, `bridge`, and `contracts` cannot import `node:*`; `electron` is forbidden):

| Module | Allowed internal dependencies | Role |
| --- | --- | --- |
| `gateway` | `application`, `automation`, `bridge`, `contracts`, `core`, `platform`, `agents` | HTTP/SSE server, pairing/sessions, LAN ingress, MCP broker, OAuth callback |
| `application` | `core`, `bridge`, `platform`, `automation` | `ApplicationHost`, Relay, projects, MCP, workflows facade, terminals, Memory/RAG |
| `management` | `gateway`, `platform`, `core`, `contracts` | `code60` CLI (`setup`, `status`, `open`, `service`, `pairing`, `usage`, `update`, `uninstall`) |
| `automation` | `core`, `contracts`, `platform` | In-process 1s scheduler, lanes, per-repo locks, headless prompt executor |
| `renderer` | `bridge`, `core` *(type-only)* | React 19 + Carbon SPA, Monaco, Headless Tree, xterm.js, `BrowserClient` |
| `bridge` | `core` *(type-only)*, `contracts` | Typed `ApplicationClient` RPC contract |
| `core` | `agents`, `git`, `contracts`, `platform` | Orchestrator, run lifecycle, policy, WorkflowEngine, UsageStore, config |
| `agents` | `contracts`, `platform` | `@agentclientprotocol/sdk` & `@modelcontextprotocol/sdk` adapters/transports |
| `git` | `platform` | Worktrees (`code60/*`), diffs, disposable-index snapshots, repo setup |
| `contracts` | *(none)* | Browser-safe Zod v4 schemas, capabilities catalog, prompt catalog, navigation |
| `platform` | *(none)* | Process groups, `launchd`/`systemd`, guarded writes, keyring helper, PTYs, payloads |

## Viewing & Validating the C4 Model

```sh
npm run c4:check      # Fast zero-Docker static check (DSL includes, braces, src/ parity, KB docs)
npm run c4:validate   # Full upstream Structurizr DSL validation via pinned Docker image
npm run c4:view       # Interactive Structurizr viewer on http://127.0.0.1:8080 (Ctrl+C cleans up)
npm run c4:export     # Export Mermaid/PlantUML/static diagrams to gitignored test-results/c4/
```

See [SECURITY.md](SECURITY.md) for trust boundaries (`SEC-*`) and [.factory/skills/c4-architecture/SKILL.md](.factory/skills/c4-architecture/SKILL.md) for updating the model.
