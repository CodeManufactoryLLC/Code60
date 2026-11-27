# Code60 Constitution

This document is the highest source of authority for agents working in this repository. Whenever another document conflicts with `CONSTITUTION.md`, this document takes precedence.

> The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document and in all other project governance documents are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). Each constitutional stipulation appears on its own line with a unique identifier (`CON-<section>.<subsection>.<number>`).

## 1. Governance and Normative Standards

### 1.1 Normative language

- `CON-1.1.1` All project governance documents MUST adhere to [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).
- `CON-1.1.2` Normative governance documents MUST place each stipulation on its own single line with a unique hierarchical identifier (`<PREFIX>-<section>.<subsection>.<number>`).

## 2. Knowledge Base and Generated References

### 2.1 Canonical knowledge base

- `CON-2.1.1` Canonical project knowledge MUST reside in the progressive-disclosure knowledge base under `knowledge/`, indexed by [knowledge/INDEX.md](knowledge/INDEX.md) and [knowledge/index.json](knowledge/index.json), and validated via `npm run kb:check`.
- `CON-2.1.2` Authors MUST keep [knowledge/INDEX.md](knowledge/INDEX.md) and [knowledge/index.json](knowledge/index.json) synchronized with document frontmatter by running `npm run kb:index` whenever knowledge documents change.
- `CON-2.1.3` The generated capability reference MUST reside at [knowledge/reference/capabilities.md](knowledge/reference/capabilities.md) (`KB-REF-001`), MUST be generated from `src/contracts/knowledge.ts` via `npm run generate:capabilities`, and MUST NOT be edited by hand or restored at `docs/capabilities.md`.
- `CON-2.1.4` Every capability-affecting change (pages, settings sections, MCP tools, prerequisites, confirmations, or limits) MUST update `src/contracts/knowledge.ts` and regenerate [knowledge/reference/capabilities.md](knowledge/reference/capabilities.md) via `npm run generate:capabilities` and `npm run kb:index`, or explicitly state in the PR why no capability update is required.
