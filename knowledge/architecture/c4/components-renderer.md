---
id: KB-ARCH-004
title: "C4 Level 3: Browser SPA Components"
domain: architecture
kind: subsystem
status: active
summary: Internal React 19 and IBM Carbon UI components and typed HTTP/SSE client inside src/renderer/.
updated: 2026-11-27
code_refs:
  - architecture/structurizr/model/components-renderer.dsl
  - src/renderer/browser-client.ts
  - src/renderer/page-tabs.tsx
related:
  - KB-ARCH-002
  - KB-ARCH-003
tags:
  - c4
  - architecture
  - renderer
  - carbon
---

# C4 Level 3: Browser SPA Components

Structurizr view: `code60-renderer-components` ([components-renderer.dsl](../../../architecture/structurizr/model/components-renderer.dsl)).

## 1. Component Breakdown (`src/renderer/`)

| Component | Key modules | Responsibilities |
| --- | --- | --- |
| **Carbon App Shell & Navigation** | `app.tsx`, `browser-app.tsx`, `page-tabs.tsx` | Product header (Commands, Back/Forward, `auto-approve`, Workspace modal), top-level `Chat` button, 7 Carbon `SideNavMenu` groups (`Automate`, `Connect`, `Customize`, `Personalize`, `Manage`, `Contributor Tools`, `Experiments`), and Chat History panel. |
| **Chat & Orchestration Surface** | Carbon AI Chat wrappers, `activity-display.tsx`, prompt composer | Relay, Custom Assistants, project chats, and workers; inline activity progress, `/` and `$` command picker, Tactics selector, approval cards, and message Undo. |
| **Workspace Inspector Panels** | `panel-shell.tsx`, `file-panel.tsx`, `monaco-runtime.ts`, `monaco-diff.tsx`, `terminal-panel.tsx` | Per-session right-sidebar tabs hosting Headless Tree File Explorer, read-only Monaco file previews/diffs, Plans viewer, Memory Recall, and xterm.js terminals. |
| **Management & Configuration Views** | `mcp-workspace.tsx`, `mcp-servers.tsx`, `mcp-json-editor.tsx`, `system-manager.tsx`, `usage-page.tsx`, `web-server.tsx`, `logs.tsx`, `updates.tsx` | Scheduled Jobs, Workflows player, MCP Servers (`User`/`Project` tabs + `Edit JSON` modal), Providers setup/login, Health Check, Usage, Data Viewer/Logs, Settings, and Web Server (Beta). |
| **Browser Gateway Client** | `browser-client.ts` | Attaches typed `window.code60` `ApplicationClient`; manages per-tab `sessionStorage` token, single-controller lease (`/api/control`), SSE resync (`/api/events`), and server-driven interaction modals (`/api/interaction`, `/api/chooser`). |

## 2. UI Boundary Rules

- Standard UI controls, themes (`White` / `G100`), modals, tabs, and tables come from upstream `@carbon/react`, `@carbon/ai-chat`, and `@carbon/icons-react`.
- Specialist surfaces (Monaco, Headless Tree, xterm.js, transcript scrolling) keep focused wrappers while relying on Gateway for all persistence, file reads, and execution authority.
- No Node.js APIs, filesystem paths, or secrets enter the browser bundle; all host mutations flow through allowlisted `POST /api/operation` RPCs (`SEC-1.2.1`–`SEC-1.2.5`).
