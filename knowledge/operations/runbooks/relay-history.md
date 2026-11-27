---
id: KB-OPS-004
title: Damaged Relay History Recovery
domain: operations
kind: runbook
status: active
summary: Diagnose and safely recover damaged or blocked Relay storage under $XDG_STATE_HOME/code60/relay.
updated: 2026-11-27
code_refs:
  - src/application/relay-store.ts
  - src/application/relay-storage.ts
  - src/application/health-check.ts
related:
  - KB-OPS-002
  - KB-OPS-003
tags:
  - runbook
  - relay
  - history
---

# Damaged Relay History Recovery

## 1. Symptoms

Relay cannot connect or reconnect because private storage fails validation, **Manage → Health Check** reports Relay history issues, or the live conversation warns that history saving failed. A recorded history gap is distinct from malformed frames or changed journal identity.

## 2. Read-only diagnosis

1. Record Code60 version, platform, and fixed error category.
2. Check [low-disk.md](low-disk.md) and **Apps → Data Viewer → Logs** ([diagnostics.md](diagnostics.md)).
3. Relay private state lives under `$XDG_STATE_HOME/code60/relay` (default `~/.local/state/code60/relay`), with state metadata outside its `workspace/` directory.
4. Inspect storage metadata and backend ownership (`code60 service status`) only. Never copy prompts, transcripts, tokens, or journal contents into diagnostics.

## 3. Supported recovery (only after explicit consent)

1. Preserve original state, `workspace/`, journals, and saved reviews. Never delete, truncate, replace, migrate, or hand-edit them; switching or creating a project database does not repair application-owned Relay state.
2. For a transient storage failure, restore storage health first, then request permission to use the offered reconnect/Retry control. Reconnection revalidates storage before creating a writer; Retry clears a transient write-failure latch only after validation passes.
3. A recorded history gap alone permits a fresh connection once the journal validates (it does not reconstruct missing messages or authorize replay). Damaged frames, missing workspace data, unsafe paths, or changed journal identity remain blocked; there is no general history-repair CLI.
4. If a clean backend restart is needed, explain the full interruption first: stopping the Code60 Gateway (`Stop Code60 Backend` or `code60 service stop`) stops **interactive agents, scheduled jobs, and active workflows together** because the scheduler runs in-process (`SEC-1.2.9`). Restart restores persisted evidence without restoring provider context, pending plans, live workers, or feedback authority.

## 4. Verify

Confirm Relay connection state and history-saving status separately. With explicit permission, verify saving with a synthetic new message rather than replaying an uncertain request. Confirm saved reviews remain readable and no prior worker was redispatched. An existing history gap may stay recorded; do not report missing history as recovered.

## 5. Stop and escalate

Stop if validation continues to fail or writer identity is live/unknown. Preserve all evidence for private support; never remove locks, erase the journal, replace state with an empty file, or repeatedly retry corrupted history.
