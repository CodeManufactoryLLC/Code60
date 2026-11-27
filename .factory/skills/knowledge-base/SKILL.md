---
name: knowledge-base
description: Read, author, index, and validate Code60's progressive-disclosure knowledge base under knowledge/ and the generated capability reference at knowledge/reference/capabilities.md. Use whenever looking up repository specs, adding or updating documentation, or modifying capabilities in src/contracts/knowledge.ts.
---

# Knowledge Base Workflow

Follow [CONSTITUTION.md](../../../CONSTITUTION.md) first, then [knowledge/README.md](../../../knowledge/README.md).

## 1. Progressive lookup (read least first)

1. Start with [knowledge/INDEX.md](../../../knowledge/INDEX.md), [knowledge/index.json](../../../knowledge/index.json), or `npm run kb:find -- <id-or-path-or-term>`.
2. Open only the specific document matching the task, and cite stable IDs (`KB-<DOMAIN>-<NNN>` or `<PREFIX>-<X.Y.Z>`) rather than copying prose across files.

## 2. Authoring or updating a knowledge document

1. Place the file in the single domain folder matching its `domain` frontmatter: `governance/`, `architecture/`, `subsystems/`, `operations/`, or `reference/`.
2. Start from the matching template under `knowledge/templates/` (`normative.md`, `adr.md`, `subsystem.md`, or `runbook.md`).
3. Fill required YAML frontmatter conforming to [knowledge/schema.json](../../../knowledge/schema.json) (`id`, `title`, `domain`, `kind`, `status`, `summary`, `updated`, plus `code_refs`, `related`, `tags`, and `rule_prefix` when applicable).
4. For normative documents (`rule_prefix` set), adhere strictly to RFC 2119: place every normative stipulation on its own single line with a unique sequential ID (`<PREFIX>-<section>.<subsection>.<number>`), use uppercase RFC 2119 keywords, and avoid ambiguous lowercase RFC 2119 words in prose.
5. Update canonical documents in place; never prepend "supersedes below" banners or leave completed plans beside live specifications.
6. Regenerate indexes and verify:

```sh
npm run kb:index
npm run kb:check
```

## 3. Maintaining the generated capability reference (`KB-REF-001`)

`knowledge/reference/capabilities.md` is generated from `src/contracts/knowledge.ts`.

1. Edit `src/contracts/knowledge.ts` (and `test/capabilities.test.ts` if assertions change) whenever adding, renaming, or changing pages, settings sections, MCP tools, prerequisites, confirmations, or limits.
2. Regenerate the reference and refresh the KB index:

```sh
npm run generate:capabilities
npm run kb:index
npm run kb:check
```

3. Never hand-edit `knowledge/reference/capabilities.md`, `knowledge/index.json`, or the generated table inside `knowledge/INDEX.md`, and never recreate the retired `docs/capabilities.md` path.
