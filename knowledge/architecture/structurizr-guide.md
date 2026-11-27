---
id: KB-ARCH-007
title: Structurizr C4 Workflow and Viewer Guide
domain: architecture
kind: reference
status: active
summary: Commands and conventions for validating, viewing locally, and exporting Code60's modular Structurizr C4 workspace.
updated: 2026-11-27
code_refs:
  - architecture/structurizr/workspace.dsl
  - scripts/c4.mjs
  - test/c4.test.mjs
related:
  - KB-ARCH-001
  - KB-ARCH-003
tags:
  - c4
  - structurizr
  - tooling
---

# Structurizr C4 Workflow and Viewer Guide

Code60 maintains its C4 architecture as modular Structurizr DSL under `architecture/structurizr/` ([workspace.dsl](../../architecture/structurizr/workspace.dsl)) and pairs it with bounded Markdown pages under [c4/INDEX.md](c4/INDEX.md).

## 1. Commands

| Command | Docker required? | Purpose |
| --- | :---: | --- |
| `npm run c4:check` | No | Static check: verifies `!include` tree, balanced braces, unique view keys, 1:1 `src/<module>` parity, and required C4 KB docs. Runs in `check:precommit`, `check`, and `check:instructions`. |
| `npm run c4:validate` | Yes | Runs the digest-pinned `structurizr/structurizr` container with `validate -workspace workspace.dsl` (read-only mount) for full upstream DSL grammar/semantic validation. |
| `npm run c4:view` | Yes | Starts the interactive Structurizr local web viewer bound strictly to `http://127.0.0.1:8080` (`-- --port <n>` to customize). Press `Ctrl+C` to stop and auto-remove the labeled container. |
| `npm run c4:export` | Yes | Exports diagrams (`-- --format mermaid\|plantuml\|plantuml/c4plantuml\|static\|json\|dot`) into gitignored `test-results/c4/` (never into tracked docs folders). |

## 2. Pinning & Safety

- Default image is digest-pinned in [scripts/c4.mjs](../../scripts/c4.mjs) (`structurizr/structurizr:2026.10.26@sha256:...`); override locally with `CODE60_STRUCTURIZR_IMAGE` when testing upgrades.
- Viewer containers bind only to `127.0.0.1`, carry `code60.role=c4-viewer` and `code60.worktree=<hash>` labels, and run with `--rm`.
- Structurizr's local layout cache (`architecture/structurizr/.structurizr/`) is gitignored so `workspace.dsl` remains the single source of truth.
