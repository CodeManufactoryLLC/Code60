# Agent Instructions

Code60 is a local Node.js application with a React browser interface and unified backend for orchestrating coding agents in isolated Git worktrees on macOS and Linux.

Keep `AGENTS.md` optimized for progressive disclosure, serving as a concise guide that helps agents navigate to canonical project governance, architecture, and reference documentation rather than duplicating full specifications inline.

## Highest Authority

- [CONSTITUTION.md](CONSTITUTION.md) is the highest source of authority for agents working in this repository. Read and follow it first; whenever another document conflicts with it, `CONSTITUTION.md` takes precedence.

## Progressive-Disclosure Navigation

- [knowledge/INDEX.md](knowledge/INDEX.md) (nested domain `INDEX.md` tree, [knowledge/index.json](knowledge/index.json), and `npm run kb:find`) — start here to drill into small, bounded knowledge documents by domain, ID, or `code_refs`.
- [ARCHITECTURE.md](ARCHITECTURE.md), [knowledge/architecture/c4/INDEX.md](knowledge/architecture/c4/INDEX.md) (`KB-ARCH-001`–`KB-ARCH-006`), and [architecture/structurizr/workspace.dsl](architecture/structurizr/workspace.dsl) — C4 architecture model, 11-module boundary rules, and Structurizr viewer (`npm run c4:view`, `npm run c4:check`, `npm run c4:validate`).
- [knowledge/reference/capabilities/INDEX.md](knowledge/reference/capabilities/INDEX.md) (`KB-REF-001`–`KB-REF-008`) — semantic generated catalogs of shipped capabilities, access paths, prerequisites, limits, and agent tools. For capability-affecting changes, update `src/contracts/knowledge.ts` and run `npm run generate:capabilities && npm run kb:check`.
- [SECURITY.md](SECURITY.md) — security policy and trust boundaries (`SEC-*` stipulations).
- [.factory/skills/knowledge-base/SKILL.md](.factory/skills/knowledge-base/SKILL.md) — workflow for navigating nested indexes, staying within KB size/nesting limits, authoring docs, indexing (`npm run kb:index`), and validating (`npm run kb:check`).
- [.factory/skills/c4-architecture/SKILL.md](.factory/skills/c4-architecture/SKILL.md) — workflow for updating, validating, and viewing Code60's C4 Structurizr model and architecture KB pages.
