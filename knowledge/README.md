# Code60 Knowledge Base

Canonical repository knowledge base organized for **progressive disclosure**, **nested index navigation**, **enforced document size limits**, and **fine-grained addressability**.

> The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), as mandated by [CONSTITUTION.md](../CONSTITUTION.md). Each normative rule appears on its own line with a unique identifier (`KB-<section>.<subsection>.<number>`).

## Contents

1. [Progressive disclosure and size limits](#1-progressive-disclosure-and-size-limits)
2. [Directory taxonomy](#2-directory-taxonomy)
3. [Addressability and identifiers](#3-addressability-and-identifiers)
4. [Frontmatter and automated indexing](#4-frontmatter-and-automated-indexing)

## 1. Progressive disclosure and size limits

### 1.1 Disclosure tiers

- `KB-1.1.1` Agents and contributors SHOULD start at [INDEX.md](INDEX.md) (or machine-readable [index.json](index.json) / `npm run kb:find`) and drill down through nested `INDEX.md` files before opening leaf documents.
- `KB-1.1.2` Each knowledge document MUST cover one cohesive semantic topic and MUST NOT duplicate full specifications owned by another document; documents SHOULD cross-reference canonical IDs or links instead.
- `KB-1.1.3` Superseded or completed implementation plans MUST NOT be left alongside active specifications; authors MUST update canonical documents in place rather than prepending override banners or appending historical changelogs.

### 1.2 Enforced structural limits

Enforced automatically by `npm run kb:check` (`KB_LIMITS` in `scripts/kb.mjs`):

| Limit | Maximum | Purpose |
| --- | ---: | --- |
| `maxLines` | 150 lines | Keeps every leaf document compact and fast to load |
| `maxBytes` | 10,240 bytes (10 KiB) | Prevents dense single-line bloat |
| `maxIndexLines` | 100 lines | Keeps every root and nested `INDEX.md` scannable |
| `maxDirectDocsPerDir` | 12 docs | Forces semantic subfolder nesting before directories sprawl |
| `maxDepth` | 4 levels | Keeps navigation paths shallow beneath `knowledge/` |
| `maxSummaryChars` | 200 chars | Keeps index summaries concise and single-line |

- `KB-1.2.1` Every leaf knowledge document MUST stay within `maxLines` (150 lines) and `maxBytes` (10,240 bytes).
- `KB-1.2.2` When a topic outgrows a single bounded file or a directory exceeds `maxDirectDocsPerDir` (12 direct documents), authors MUST split it into smaller semantic files inside a nested subfolder with its own `INDEX.md`.

## 2. Directory taxonomy

### 2.1 Domain folders

| Folder | Domain code | Scope |
| --- | --- | --- |
| `governance/` | `GOV` | Normative policies, RFC 2119 standards, contributor/release/branch rules |
| `architecture/` | `ARCH` | System architecture, module boundaries, architectural decision records (ADRs) |
| `subsystems/` | `SUB` | Canonical specifications per runtime subsystem (gateway, MCP, workflows, UI, etc.) |
| `operations/` | `OPS` | Operational runbooks, installation, distribution, updates, and safe recovery |
| `reference/` | `REF` | Machine-synced or generated technical references (CLI, config, limits, capabilities) |
| `templates/` | — | Starter templates for new knowledge documents |

- `KB-2.1.1` Every knowledge document MUST reside in the single domain folder matching its frontmatter `domain` field (or a semantic subfolder within it).
- `KB-2.1.2` Every domain directory and nested subfolder containing knowledge documents MUST have an auto-generated `INDEX.md` linking its parent index, child sections, and direct documents.
- `KB-2.1.3` Templates under `templates/` MUST NOT be indexed as active knowledge documents in any `INDEX.md` or `index.json`.

## 3. Addressability and identifiers

### 3.1 Stable document, section, and stipulation IDs

- `KB-3.1.1` Every knowledge document MUST declare a unique, immutable document ID in frontmatter using the format `KB-<DOMAIN>-<NNN>` (for example, `KB-REF-001`).
- `KB-3.1.2` Normative documents MUST number top-level sections (`## 1.`) and subsections (`### 1.1`).
- `KB-3.1.3` Each normative stipulation in a normative document MUST appear on its own single line with a unique hierarchical identifier (`<PREFIX>-<section>.<subsection>.<number>`, for example `SEC-1.1.1`).
- `KB-3.1.4` Retired document IDs and stipulation IDs MUST NOT be reassigned to different semantics.

## 4. Frontmatter and automated indexing

### 4.1 Metadata and index synchronization

- `KB-4.1.1` Every knowledge document MUST begin with YAML frontmatter conforming to [schema.json](schema.json).
- `KB-4.1.2` Every `code_refs` path declared in frontmatter MUST resolve to an existing file or directory in the repository.
- `KB-4.1.3` [INDEX.md](INDEX.md), all nested `INDEX.md` files, and [index.json](index.json) MUST remain synchronized with document frontmatter via `npm run kb:index` and validated via `npm run kb:check`.
- `KB-4.1.4` Generated `INDEX.md` sections, nested `INDEX.md` files, and `index.json` MUST NOT be edited by hand.
- `KB-4.1.5` Generated capability references under [reference/capabilities/INDEX.md](reference/capabilities/INDEX.md) (`KB-REF-001`–`KB-REF-008`) MUST be regenerated from `src/contracts/knowledge.ts` via `npm run generate:capabilities` and MUST follow [.factory/skills/knowledge-base/SKILL.md](../.factory/skills/knowledge-base/SKILL.md).

Use `npm run kb:find -- <query>` to search indexed documents by ID, stipulation ID, tag, keyword, or `code_refs` path.
