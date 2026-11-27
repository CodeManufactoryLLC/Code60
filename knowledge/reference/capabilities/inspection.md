---
id: KB-REF-008
title: "Capabilities: Data, Search, Self-Knowledge, and Experiments"
domain: reference
kind: reference
status: active
summary: Generated capability specs for Data Viewer, Search, Vector Codebase Search, Diagnostic Logs, Self-Knowledge, Retrieval Tests, and Memory Tester.
updated: 2026-11-27
code_refs:
  - src/contracts/knowledge.ts
  - src/contracts/navigation.ts
tags:
  - capabilities
  - inspection
  - experiments
  - reference
---

# Capabilities: Data, Search, Self-Knowledge, and Experiments

Generated from `src/contracts/knowledge.ts`. Do not edit by hand; run `npm run generate:capabilities`.

Schema version: 1

## Data Viewer

- ID: `data`
- Status: shipped
- Purpose: Inspect saved application data.
- Access: Apps → Data Viewer
- Prerequisite: database
- Agent access: read
- Confirmation: Existing permissions apply.
- Limits: Carbon tables retain saved filters, column filters and backend paging scopes. Search filters the loaded rows; retained-log searches submit to the backend. Sortable headers, single-row selection and loaded-row pagination use Carbon controls. Retained logs use backend cursor paging without a second loaded-row pager. Table settings preview density, lines, visible columns and charts; named Earlier/Later and width controls replace canvas dragging. New configuration/session actions are visible toolbar buttons. Diagnostic logs and memory records are not agent-readable.
- Pages: `tables`, `sessions`, `messages`, `events`, `worktrees`, `polling`
- Settings sections: none
- Tools: `code60_read_sessions`, `code60_search_sessions`, `code60_read_messages`, `code60_search_messages`, `code60_read_events`, `code60_search_events`, `code60_read_worktrees`, `code60_search_worktrees`, `code60_read_polling`, `code60_search_polling`

## Search

- ID: `search`
- Status: shipped
- Purpose: Search all projects saved in the connected database, open or closed, with an optional cited overview.
- Access: Home → Search
- Prerequisite: database
- Agent access: human-only
- Confirmation: Opening a closed project source asks for Open project or Cancel in the controlling browser. Archived conversations remain read-only.
- Limits: Select a result to read its record alongside the query and results. Open source navigates to the original evidence. Search needs no selected project. Includes project identity, saved project sessions/transcripts and bounded documentation/source evidence; excludes other databases, Relay and Custom Assistant histories. Results have project provenance and Load more pages of 100. Submitted results stay stable across project/page selection; new projects enter the next search. Missing/corrupt sources show partial results. Overview helpers use captured evidence, denied permissions and no gateway; failures preserve literal results. Agents cannot request Search.
- Pages: `search`
- Settings sections: none
- Tools: none

## Vector Search

- ID: `codebase-search`
- Status: shipped
- Purpose: Automatically index the latest main branch of Git repositories with Code60's bundled offline ONNX embedding engine, inspect indexed repositories and storage sizes under Context → Vector Search, and run hybrid semantic and lexical code search.
- Access: Context → Vector Search (also Apps → Vector Search); Relay, Custom Assistants, project chats, subagents, Workflow Engine, and Scheduled Agents → code60_search_codebase and code60_codebase_index_status
- Prerequisite: git
- Agent access: read
- Confirmation: Read-only for agents; removing a repository index from Context → Vector Search requires browser confirmation and deletes only derived index rows while preserving source files and Git history.
- Limits: No database is required for the Vector Search page. Indexes tracked text files on main (non-mutating origin fetch when configured, falling back to local main or default branch) without modifying the working tree or branches. Shared across linked worktrees via git-common-dir. Private SQLite + FTS5 index under application state; runs ONNX inference in a dedicated lazy Node sidecar. Relay and Custom Assistants require an explicit cwd; project chats, subagents, Workflow Engine, and Scheduled Agents are strictly bound to their target repository. Retrieved code is untrusted data.
- Pages: `vector-search`
- Settings sections: none
- Tools: `code60_search_codebase`, `code60_codebase_index_status`

## Diagnostic logs

- ID: `logs`
- Status: shipped
- Purpose: Inspect private, typed application diagnostics.
- Access: Apps → Data Viewer → Logs; title actions → Pause/Resume viewing, Refresh logs or Clear logs
- Prerequisite: none
- Agent access: human-only
- Confirmation: Choose Clear logs to remove retained diagnostics. Cancel keeps them.
- Limits: Never exposed to agents, MCP or awareness.
- Pages: `logs`
- Settings sections: none
- Tools: none

## Self-knowledge

- ID: `knowledge`
- Status: shipped
- Purpose: Discover capabilities, open-state metadata and effective customizations.
- Access: Relay/project chat → read-only Code60 tools
- Prerequisite: none
- Agent access: read
- Confirmation: Existing permissions apply.
- Limits: No new action authority, workers, drafts, transcripts, diagnostic logs or credentials.
- Pages: `home`
- Settings sections: none
- Tools: `code60_get_capabilities`, `code60_get_app_state`, `code60_list_customizations`, `code60_read_customization`, `code60_read_view`

## Retrieval Tests

- ID: `rag`
- Status: experimental
- Purpose: Manually index database-associated chat history.
- Access: Contributor Tools → Retrieval Tests
- Prerequisite: database
- Agent access: human-only
- Confirmation: Choose Clear index to remove the derived index. Cancel keeps it.
- Limits: Excludes Relay; no automatic indexing or agent retrieval.
- Pages: `rag`
- Settings sections: none
- Tools: none

## Memory Tester

- ID: `episodic-memory`
- Status: experimental
- Purpose: Inspect experimental episodic extraction.
- Access: Contributor Tools → Memory Tester
- Prerequisite: database
- Agent access: human-only
- Confirmation: Existing experiment controls.
- Limits: Separate from application Memory.
- Pages: `episodic-memory`
- Settings sections: none
- Tools: none

## Contributor Tools

- ID: `contributor-tools`
- Status: placeholder
- Purpose: Reserved contributor destination.
- Access: Contributor Tools
- Prerequisite: none
- Agent access: human-only
- Confirmation: None.
- Limits: Placeholder, not an implemented tool.
- Pages: `contributor-tools`
- Settings sections: none
- Tools: none
