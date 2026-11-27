# Code60 Constitution

This document is the highest source of authority for agents working in this repository. Whenever another document conflicts with `CONSTITUTION.md`, this document takes precedence.

> The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document and in all other project governance documents are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). Each constitutional stipulation appears on its own line with a unique identifier (`CON-<section>.<subsection>.<number>`).

## 1. Governance and Normative Standards

### 1.1 Normative language

- `CON-1.1.1` All project governance documents MUST adhere to [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).
- `CON-1.1.2` Normative governance documents MUST place each stipulation on its own single line with a unique hierarchical identifier (`<PREFIX>-<section>.<subsection>.<number>`).

## 2. Knowledge Base and Generated References

### 2.1 Canonical knowledge base

- `CON-2.1.1` Canonical project knowledge MUST reside in the progressive-disclosure knowledge base under `knowledge/`, organized into small semantic files within nested directories navigated by auto-generated `INDEX.md` files and [knowledge/index.json](knowledge/index.json).
- `CON-2.1.2` Every knowledge base document MUST obey the structural size and nesting limits enforced by `npm run kb:check` (`maxLines: 150`, `maxBytes: 10240`, `maxIndexLines: 100`, `maxDirectDocsPerDir: 12`, `maxDepth: 4`) and MUST split into a nested semantic subfolder rather than growing into a monolith.
- `CON-2.1.3` Authors MUST keep all nested `INDEX.md` files and [knowledge/index.json](knowledge/index.json) synchronized with document frontmatter by running `npm run kb:index` whenever knowledge documents change.
- `CON-2.1.4` The generated capability reference MUST reside as bounded semantic files under [knowledge/reference/capabilities/INDEX.md](knowledge/reference/capabilities/INDEX.md) (`KB-REF-001`–`KB-REF-008`), MUST be generated from `src/contracts/knowledge.ts` via `npm run generate:capabilities`, and MUST NOT be edited by hand or consolidated back into a monolithic `capabilities.md` file.
- `CON-2.1.5` Every capability-affecting change (pages, settings sections, MCP tools, prerequisites, confirmations, or limits) MUST update `src/contracts/knowledge.ts` and regenerate the semantic files and indexes via `npm run generate:capabilities` and `npm run kb:check`, or explicitly state in the PR why no capability update is required.

## 3. Architecture and C4 Model

### 3.1 C4 model and Structurizr governance

- `CON-3.1.1` Code60's canonical architecture MUST be modeled using C4 (System Context, Containers, Components, Dynamic Flows, and Deployment) in modular Structurizr DSL under [architecture/structurizr/workspace.dsl](architecture/structurizr/workspace.dsl) and documented in bounded progressive-disclosure pages under [knowledge/architecture/c4/INDEX.md](knowledge/architecture/c4/INDEX.md).
- `CON-3.1.2` Changes that add, remove, or alter `src/` module boundaries, runtime containers or workers, persistent data stores, external integrations, or deployment topologies MUST update `architecture/structurizr/`, `test/boundaries.test.ts` (when module boundaries change), and affected `knowledge/architecture/c4/` documents, and MUST pass `npm run c4:check` and `npm run kb:check`.
- `CON-3.1.3` Local Structurizr viewer containers launched via `npm run c4:view` MUST bind exclusively to loopback (`127.0.0.1`), MUST use a pinned image by default (overridable via `CODE60_STRUCTURIZR_IMAGE`), and MUST clean up only their own labeled container on exit.
- `CON-3.1.4` Diagram exports from `npm run c4:export` MUST write only to gitignored `test-results/` and MUST NOT be committed as binary artifacts into tracked documentation folders.

## 4. Security Policy and Trust Boundaries

### 4.1 Binding security stipulations

- `CON-4.1.1` [SECURITY.md](SECURITY.md) is the canonical normative security policy for Code60; all `SEC-*` stipulations in [SECURITY.md](SECURITY.md) MUST be enforced as binding constitutional requirements across code, configuration, tooling, and documentation.
- `CON-4.1.2` Changes that affect runtime safeguards, authentication, pairing, permissions, process or filesystem boundaries, secrets, MCP connectors, provider setup, or application updates MUST preserve every applicable `SEC-*` stipulation in [SECURITY.md](SECURITY.md) and MUST include automated verification tests for any new or modified security boundary.
- `CON-4.1.3` Agents and contributors MUST NOT weaken, bypass, or silently alter a `SEC-*` trust boundary; any intentional change to a security requirement MUST explicitly update [SECURITY.md](SECURITY.md) with rationale and corresponding test coverage in the same pull request.
- `CON-4.1.4` [SECURITY.md](SECURITY.md) MUST maintain RFC 2119 single-line stipulations (`SEC-<section>.<subsection>.<number>`) in accordance with `CON-1.1.1` and `CON-1.1.2`.
