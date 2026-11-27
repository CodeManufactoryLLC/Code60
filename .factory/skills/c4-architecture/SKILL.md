---
name: c4-architecture
description: Navigate, update, validate, and view Code60's C4 software architecture (modular Structurizr DSL under architecture/structurizr/ and bounded KB docs under knowledge/architecture/c4/). Use whenever changing src/ module boundaries, runtime processes/workers, data stores, external integrations, or deployment topologies.
---

# C4 Architecture Workflow

Follow [CONSTITUTION.md](../../../CONSTITUTION.md) (`CON-3.1.1`–`CON-3.1.4`) and [.factory/skills/knowledge-base/SKILL.md](../knowledge-base/SKILL.md).

## 1. Progressive reading

1. Start at [ARCHITECTURE.md](../../../ARCHITECTURE.md) or [knowledge/architecture/c4/INDEX.md](../../../knowledge/architecture/c4/INDEX.md).
2. Open only the C4 level needed (`context.md`, `containers.md`, `components-backend.md`, `components-renderer.md`, `runtime-flows.md`, or `deployment.md`), or inspect the specific Structurizr include file under `architecture/structurizr/model/` or `views/`.

## 2. Keeping C4 model, boundaries, and KB synchronized

Update the C4 architecture in the same PR whenever a change:

- Adds, removes, or changes dependencies between `src/<module>` directories (update [test/boundaries.test.ts](../../../test/boundaries.test.ts), `architecture/structurizr/model/components-gateway.dsl` or `containers.dsl`, `ARCHITECTURE.md`, and `knowledge/architecture/c4/components-backend.md`).
- Adds or removes a runtime process, sidecar, worker, helper binary, persistent data store, or external system (update `architecture/structurizr/model/containers.dsl` / `people-and-external.dsl` and `knowledge/architecture/c4/containers.md` / `context.md`).
- Changes a core runtime flow or deployment topology (update `views/dynamic.dsl` or `model/deployment.dsl` and `runtime-flows.md` or `deployment.md`).

Keep every `knowledge/architecture/**` Markdown file within `KB_LIMITS` (`<= 150` lines and `<= 10,240` bytes) and every `src/<module>` mapped 1:1 via `src_module "<name>"` in `architecture/structurizr/model/`.

## 3. Validating and viewing

```sh
npm run kb:index      # Refresh nested knowledge/**/INDEX.md and knowledge/index.json
npm run kb:check      # Validate KB schema, size/nesting limits, and index sync
npm run c4:check      # Zero-Docker static check (DSL includes, braces, view keys, src/ parity)
npm run c4:validate   # Upstream Structurizr DSL parser validation (requires Docker)
npm run c4:view       # Interactive viewer on http://127.0.0.1:8080 (Ctrl+C removes container)
```

Never bind the viewer outside `127.0.0.1`, never commit `architecture/structurizr/.structurizr/`, and never commit exported diagrams from `npm run c4:export` (exports must stay inside gitignored `test-results/`).
