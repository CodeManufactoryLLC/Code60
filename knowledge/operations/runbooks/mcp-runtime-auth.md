---
id: KB-OPS-006
title: MCP Connection, Authentication, and Troubleshooting Recovery
domain: operations
kind: runbook
status: active
summary: Diagnose MCP connection failures, Keychain/OAuth auth issues, cleanup verification, and safe troubleshooting reports.
updated: 2026-11-27
code_refs:
  - src/application/mcp-runtime.ts
  - src/application/mcp-authentication.ts
  - src/renderer/mcp-servers.tsx
  - src/renderer/mcp-troubleshooting.tsx
related:
  - KB-OPS-005
tags:
  - runbook
  - mcp
  - oauth
  - credentials
---

# MCP Connection, Authentication, and Troubleshooting Recovery

A failed MCP connector leaves the agent session and other tools usable. Keep configuration validity, project approval, credential storage availability, authentication, and observed connection health separate.

## 1. Connection & cleanup recovery

1. In **Connect → MCP Servers** (or **Customize → MCP Servers**), check captured target identity, revision, enabled state, and project approval independently of health. Invalid, unsafe, or recovery-blocked project files do not fall back to shadowed User definitions.
2. **Test connection** initializes and discovers tools only (requiring project approval and confirming stdio launch); cancelling or detaching stops its owned process group without interrupting approved chat sessions.
3. **Reconnect** applies only to idle sessions with provider load/resume support and replaces all connectors in that session; otherwise start a new session. **Disconnect** revokes selected instances without altering enablement.
4. For unresolved cleanup (`MCP_CLEANUP`), open the MCP Servers actions menu → **Verify cleanup** and confirm. It retries only retained revoked handles without starting connectors, replaying calls, searching process names, or deleting locks (`SEC-4.3.13`). Remote HTTP cleanup can remain unverifiable after local transport closure.

## 2. Credential & OAuth recovery

1. Open the server row's Actions menu → **Manage authentication**. Never store secrets in `mcp.json`, command arguments, environment literals, journals, or reports.
2. Persistent storage requires unlocked macOS Keychain or Linux Secret Service; locked/unavailable stores never fall back silently to keyutils or RAM (`SEC-4.3.8`). Unlock the OS store separately or explicitly choose temporary RAM (cleared on backend restart or sign-out).
3. Security-relevant edits or moves require re-review in the new namespace (label/enablement changes do not). Failed credential writes/deletes keep non-secret pending/tombstone metadata; sign-out revokes active connections even if persistent deletion fails — unlock the store and run **Sign out** again to finish cleanup.
4. OAuth requires advertised issuer selection, scope/resource/registration review, and PKCE S256 within a 5-minute callback window. Cancellation, detach, owner replacement, or shutdown expires the attempt; start a fresh reviewed sign-in and never replay an old callback or uncertain business tool call (`SEC-4.3.6`, `SEC-4.3.9`). Configuration recovery never restores credential or session authority.

## 3. Safe troubleshooting reports & error codes

Choose **Review troubleshooting report** from the MCP Servers actions menu, inspect it locally, and click **Copy safe report** only if sharing. Nothing is uploaded; reports include only counts, states, and fixed error codes — never labels, paths, endpoints, definitions, references, secrets, or raw server output (`SEC-4.3.12`).

| Code | Recommended action |
| --- | --- |
| `MCP_LAUNCH`, `MCP_ARGUMENTS` | Verify command, prerequisites, argument rows, and permissions; re-run **Test connection**. |
| `MCP_PROVIDER` | Reconnect requires idle ACP load/resume support; start a new session or switch provider. |
| `MCP_AUTHENTICATION`, `MCP_SCOPE` | Re-enter credentials or **Sign in** after reviewing scopes; never auto-replay failed calls. |
| `MCP_NETWORK`, `MCP_TLS`, `MCP_TIMEOUT`, `MCP_PROTOCOL` | Fix endpoint, network, certificate, or protocol issue (never disable TLS validation), then re-test. |
| `MCP_LIMIT`, `MCP_CLEANUP` | Disconnect unused connectors or run **Verify cleanup**; limits never evict healthy connections. |
| `MCP_RECOVERY_BLOCKED`, `MCP_RECOVERY_CONFLICT` | Preserve drafts/evidence and follow [mcp-storage.md](mcp-storage.md) without deleting locks or journals. |
