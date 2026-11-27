# Agent Instructions

Code60 is a local Node.js application with a React browser interface and unified backend for orchestrating coding agents in isolated Git worktrees on macOS and Linux.

Keep `AGENTS.md` optimized for progressive disclosure, serving as a concise guide that helps agents navigate to canonical project governance, architecture, and reference documentation rather than duplicating full specifications inline.

## Highest Authority

- [CONSTITUTION.md](CONSTITUTION.md) is the highest source of authority for agents working in this repository. Read and follow it first; whenever another document conflicts with it, `CONSTITUTION.md` takes precedence.

## Progressive-Disclosure Navigation

- [knowledge/INDEX.md](knowledge/INDEX.md) (and machine-readable [knowledge/index.json](knowledge/index.json) / `npm run kb:find`) — start here to locate canonical knowledge base documents by ID, domain, or `code_refs`.
- [knowledge/reference/capabilities.md](knowledge/reference/capabilities.md) (`KB-REF-001`) — generated catalog of shipped capabilities, access paths, prerequisites, limits, and agent tools. For capability-affecting changes, update `src/contracts/knowledge.ts` and run `npm run generate:capabilities && npm run kb:index`.
- [SECURITY.md](SECURITY.md) — security policy and trust boundaries (`SEC-*` stipulations).
- [ARCHITECTURE.md](ARCHITECTURE.md) — system architecture overview.
- [.factory/skills/knowledge-base/SKILL.md](.factory/skills/knowledge-base/SKILL.md) — workflow for reading, authoring, indexing (`npm run kb:index`), and validating (`npm run kb:check`) knowledge base documents.
