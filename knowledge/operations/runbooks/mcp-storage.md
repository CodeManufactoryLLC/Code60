---
id: KB-OPS-005
title: MCP Configuration Storage and Transaction Recovery
domain: operations
kind: runbook
status: active
summary: Recover guarded User/Project mcp.json conflicts, malformed files, backups, resets, and interrupted transactions.
updated: 2026-11-27
code_refs:
  - src/application/mcp-configuration-store.ts
  - src/application/mcp-management.ts
  - src/contracts/mcp-recovery.ts
  - src/renderer/mcp-workspace.tsx
  - src/renderer/mcp-recovery.tsx
related:
  - KB-OPS-006
  - KB-OPS-002
tags:
  - runbook
  - mcp
  - storage
  - recovery
---

# MCP Configuration Storage and Transaction Recovery

User (`$XDG_CONFIG_HOME/code60/mcp.json`) and Project (`<project>/.code60/mcp.json`) definitions are managed in **Connect → MCP Servers** (or **Customize → MCP Servers**) using the **User** / **Project** tabs, guided forms, and **Edit JSON** modal. There is no CLI recovery command. See [MCP.md](../../../MCP.md) and `SEC-4.3.*` in [SECURITY.md](../../../SECURITY.md).

## 1. Symptoms

MCP configuration operations report invalid input, revision conflict, unsafe storage, quota exhaustion, cancellation, or `RECOVERY_REQUIRED`. A missing `mcp.json` means empty defaults; a malformed or oversized file is never replaced with defaults automatically.

## 2. Read-only diagnosis

1. Confirm the backend-owned target and source project (not sidebar selection or a worker worktree), canonical root identity, revision, and pending recovery metadata.
2. Separate syntax/schema issues from filesystem safety: project `mcp.json` may be `0644` (never world-writable); user files and private journals/backups must stay private. Never follow links or blindly `chmod` unsafe files.
3. Inspect only fixed error codes and safe field locations; `mcp.json`, backups, and journals remain private and must never be attached as diagnostic reports (`SEC-4.3.11`).
4. Check free space on config and state volumes ([low-disk.md](low-disk.md)). The store enforces a **100 MiB** total ceiling across receipts, backups (latest **20** verified unpinned per scope), and journals.

## 3. Supported recovery

1. **Interrupted moves and combined resets:** In **Connect → MCP Servers**, open the actions menu → **Configuration recovery**. Reopen any closed affected project first (replaced owners require a fresh review), then click **Review transaction** to inspect the recorded operation, publication order, scopes, and before/after validity/counts without exposing private bodies.
   - Moves publish destination first (a partially moved server may appear in both files; do not hand-delete either).
   - Combined resets publish User first, then the selected project, preserving inheritance guards.
   - Choose **Complete transaction** (writes only missing postimages / completes directory sync) or **Roll back transaction** (restores exact preimages, including a recorded malformed original), or Cancel.
   - Use **Check same recovery request** to inspect an uncertain accepted request by its durable ID; use **Refresh recovery evidence** to capture a fresh review. Startup and close never auto-complete pending journals.
2. **External edits and conflicts:** A save requires its observed revision (same-byte inode replacement still invalidates stale saves). On conflict, keep your draft in memory, inspect the warning banner, and explicitly **Reset** / reload before re-applying changes.
3. **Malformed text & backups:** Repair bounded malformed JSON in the **Edit JSON** modal (original bytes are retained privately), or restore a reviewed valid unpinned backup with a fresh expected revision (absent-file backups explicitly remove the dedicated file). Reset does not stop running sessions or delete credentials.

## 4. Verify

Re-read affected targets, confirm exact bytes/modes and fresh revisions, verify pending recovery metadata cleared, and verify owned staging files were removed. Configuration validity does not establish project approval, authentication, or connection health; moving or restoring never transfers credentials or approvals.

## 5. Stop and escalate

Stop when targets differ from all recorded before/after states, the canonical project was replaced, writer ownership is unverifiable, or evidence is corrupt. Never force recovery or delete foreign locks, journals, receipts, or pinned backups (`SEC-4.3.10`).
