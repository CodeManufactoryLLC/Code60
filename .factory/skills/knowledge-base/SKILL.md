---
name: knowledge-base
description: Read, author, split, index, and validate Code60's progressive-disclosure knowledge base under knowledge/ (nested INDEX.md tree, enforced size limits, and bounded semantic capability references). Use whenever looking up repository specs, adding or updating documentation, or modifying capabilities in src/contracts/knowledge.ts.
---

# Knowledge Base Workflow

Follow [CONSTITUTION.md](../../../CONSTITUTION.md) first, then [knowledge/README.md](../../../knowledge/README.md).

## 1. Progressive lookup (drill down, read least)

1. Start at [knowledge/INDEX.md](../../../knowledge/INDEX.md) to pick the domain index (`governance/INDEX.md`, `architecture/INDEX.md`, `subsystems/INDEX.md`, `operations/INDEX.md`, or `reference/INDEX.md`), or query directly via `npm run kb:find -- <id-or-path-or-term>` / [knowledge/index.json](../../../knowledge/index.json).
2. Follow nested `INDEX.md` files (for example, `knowledge/reference/capabilities/INDEX.md`) down to the single small leaf file needed.
3. Cite stable IDs (`KB-<DOMAIN>-<NNN>` or `<PREFIX>-<X.Y.Z>`) instead of copying prose across files.

## 2. Authoring, nesting, and enforced size limits

Every leaf document and index is checked automatically by `npm run kb:check`:

- **Leaf file ceiling:** max **150 lines** and **10,240 bytes (10 KiB)**.
- **Index ceiling:** max **100 lines** per `INDEX.md`.
- **Directory ceiling:** max **12 direct leaf docs** per directory and max **4 levels** beneath `knowledge/`.

Workflow:

1. Choose the domain folder matching `domain` (`governance/`, `architecture/`, `subsystems/`, `operations/`, or `reference/`). If a topic needs multiple files, create a semantic subfolder (for example, `knowledge/subsystems/mcp/`) and split cleanly so every leaf stays well below 150 lines / 10 KiB.
2. Start from `knowledge/templates/` (`normative.md`, `adr.md`, `subsystem.md`, or `runbook.md`) and fill YAML frontmatter conforming to [knowledge/schema.json](../../../knowledge/schema.json).
3. For normative docs (`rule_prefix` set), follow RFC 2119: one stipulation per line with sequential `<PREFIX>-<section>.<subsection>.<number>` IDs, uppercase RFC 2119 keywords, and zero lowercase RFC 2119 words in prose.
4. Update canonical files in place; never prepend override banners or dump large monolithic files into `knowledge/`.
5. Regenerate all nested `INDEX.md` files and `knowledge/index.json`, then verify:

```sh
npm run kb:index
npm run kb:check
```

## 3. Maintaining the generated capability references (`KB-REF-001`–`KB-REF-008`)

Capability specs are generated as bounded semantic files under [knowledge/reference/capabilities/INDEX.md](../../../knowledge/reference/capabilities/INDEX.md) from `src/contracts/knowledge.ts`.

1. Edit `src/contracts/knowledge.ts` (assigning any new capability to its semantic category in `CAPABILITY_CATEGORIES`) and update `test/capabilities.test.ts` if assertions change.
2. Regenerate the semantic files and all nested indexes, then verify:

```sh
npm run generate:capabilities
npm run kb:check
```

3. Never hand-edit generated files under `knowledge/reference/capabilities/`, any `INDEX.md` file, or `knowledge/index.json`, and never recreate a monolithic `docs/capabilities.md` or `knowledge/reference/capabilities.md`.
