---
id: KB-REF-005
title: "Capabilities: MCP Servers and Browser Automation"
domain: reference
kind: reference
status: active
summary: Generated capability specs for backend-owned MCP server management and conversational Playwright browser automation.
updated: 2026-11-27
code_refs:
  - src/contracts/knowledge.ts
  - src/contracts/navigation.ts
tags:
  - capabilities
  - mcp
  - browser
  - reference
---

# Capabilities: MCP Servers and Browser Automation

Generated from `src/contracts/knowledge.ts`. Do not edit by hand; run `npm run generate:capabilities`.

Schema version: 1

## MCP Servers

- ID: `mcp-servers`
- Status: shipped
- Purpose: Switch between the User and Project configuration tabs. Use Add server to open the guided form or Edit JSON to edit raw mcp.json in a modal with Save and Reset controls. Use each server row's Actions menu to edit, move, manage credentials or OAuth sign-in, enable or disable, test connection, or remove the server. Connections shows project approval and active session disconnect/reconnect controls. The MCP Servers actions menu groups reload, backup restoration, reset, interrupted transaction recovery, cleanup verification and the safe troubleshooting report.
- Access: Connect → MCP Servers or Customize → MCP Servers
- Prerequisite: none
- Agent access: human-only
- Confirmation: Review forms and Edit JSON changes before Save or Reset. Confirm removal, moves, backup restoration and reset after scope/inheritance review. Review exact project configuration before approval; confirm stdio tests and reviewed Disconnect/Reconnect effects. Explicitly choose persistent or temporary storage; review issuer, scopes, resource and registration before sign-in; confirm forgetting credentials or sign-out. Review captured revisions and effects before confirming Complete/Roll back; confirm owned cleanup verification. Review the safe report before copying.
- Limits: User configuration is database-independent. Project configuration requires an open project and captured runtime/database identity. Project definitions shadow user IDs, including disabled/unapproved entries. New definitions are disabled. Authentication and observed connection health are separate from configured enablement and project approval. Credential references are resolved only in the backend after explicit entry. No credentials or approvals move. Playwright/Context7 templates are opt-in. Invalid files block guided saves; bounded safe malformed files can be repaired in the Edit JSON modal or reset with private preimages. Pending recovery blocks affected writes. Save preserves exact valid text; formatting is explicit and Reset reloads the latest saved file. Restore requires a reviewed valid unpinned backup and fresh revisions; absent-file backups remove the dedicated file. Reset clears this configuration, or User and this project, preserving other project files, credentials, built-ins and running work. Clearing a project may reveal User definitions; clearing User affects other projects. Enablement and approval changes affect future connections. Existing connections retain their captured revisions until explicit Disconnect or idle Reconnect. Reconnect replaces all connectors in the owning ACP session and requires provider load/resume support; otherwise start a new session. Tests initialize/discover only, require project approval, and confirm stdio command launch. Unavailable connectors warn while other tools remain usable. Credentials use macOS Keychain or Linux Secret Service through a bounded helper. Locked/unavailable storage never falls back silently. Explicit temporary storage lasts until backend restart or sign-out. Security-relevant definition changes require new credential review; label/enablement changes do not. OAuth requires issuer/scope/registration review, S256 and a page/revision-bound single-use callback. Supply client information or use advertised per-installation registration; no shared Code60 client or hosted authentication is provided. Sign-out revokes affected connections immediately; uncertain removal remains visible. Tool calls are never replayed after authentication failure; uncertain refresh requires reauthorization. Configuration recovery reviews every affected live scope and exact recorded state before Complete/Roll back. Closed/replaced projects, newer edits or corrupt evidence block recovery; no force or lock deletion. Verify cleanup retries only retained revoked resources, without reconnecting. Troubleshooting reports are opt-in counts/fixed codes only, with no definitions, identifiers, paths, endpoints, references or secrets. Definitions and references are excluded from awareness and agent tools.
- Pages: `mcp-servers`
- Settings sections: none
- Tools: none

## Browser automation

- ID: `browser`
- Status: shipped
- Purpose: Use Headless, Visible or Existing Browser by stating a preference in chat.
- Access: Relay, Custom Assistant or project chat → ask for browser automation; code60_browser
- Prerequisite: provider
- Agent access: existing-tools
- Confirmation: Existing Browser uses the extension's connection approval; Code60 does not bypass it or provide an extension token.
- Limits: Default Headless. Each live conversation owns its mode and browser connection; no saved setting. status/set-mode never launch processes. list-tools/call lazily run pinned Playwright MCP through Node.js/npm; Chrome must be installed. Existing Browser requires the Playwright Chrome extension and connection approval. Switching modes closes the old connection and loses isolated state; errors never fall back. Calls are serialized, bounded to 100 seconds, and cancellation/Stop/Undo/provider replacement/shutdown close owned processes. External website changes are not undone by message Undo. Browser tools are unavailable to workers, setup probes, helpers and the scheduler. User-configured MCP servers stay independent. Only product-allowed browser tools; no host-code, install, upload or WebMCP tools. Private npm context; 32 MiB temporary automatic artifacts, explicit outputs directly in the owning conversation workspace. Only dispatched turns have browser authority. No native desktop control.
- Pages: none
- Settings sections: none
- Tools: `code60_browser`
