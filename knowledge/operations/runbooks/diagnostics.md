---
id: KB-OPS-003
title: Diagnostic Log Storage Recovery
domain: operations
kind: runbook
status: active
summary: Diagnose and safely recover unavailable diagnostic log storage under $XDG_STATE_HOME/code60/logs.
updated: 2026-11-27
code_refs:
  - src/application/log-store.ts
  - src/renderer/logs.tsx
  - src/application/health-check.ts
related:
  - KB-OPS-002
tags:
  - runbook
  - diagnostics
  - logs
---

# Diagnostic Log Storage Recovery

## 1. Symptoms

**Apps → Data Viewer → Logs** shows unavailable/read errors, dropped records, or persistence failures. Diagnostic logs are optional; missing records do not prove agent failure or success, and **Pause viewing** does not pause capture.

## 2. Read-only diagnosis

1. Record Code60 version, platform, and the fixed error category.
2. Check free space on the state volume (see [low-disk.md](low-disk.md)) and verify `HOME`/`XDG_STATE_HOME` settings. Diagnostic JSONL segments live under `$XDG_STATE_HOME/code60/logs` (default `~/.local/state/code60/logs`).
3. Inspect metadata only (directory type, POSIX owner/mode `0700`/`0600`, and running backend ownership via `code60 service status`). Do not dump raw transcripts or blindly `chmod` unsafe directories; private POSIX modes and live/unverifiable writers are intentional safety gates (`SEC-3.2.7`).

## 3. Supported recovery (only after explicit consent)

1. For an expired/evicted cursor, click **Refresh logs** to load the latest page; for a transient read error, click **Retry logs**. Neither repairs unsafe storage.
2. Resolve [disk pressure](low-disk.md) first. If a stale or unexpected backend process owns the store, verify ownership via `code60 service status` and stop/restart only the owned backend with consent (`code60 service stop` / `code60 service start`). Never delete lock files; the store performs bounded dead-owner handling.
3. If ownership, permissions, or directory identity changed, stop and ask the host administrator to restore private storage. There is no blanket `chmod`, recursive deletion, or automatic adoption path.
4. **Clear logs** is a separately browser-confirmed destructive action for **diagnostic segments only**, not a default repair step. Explain data loss and get approval before confirming; it never clears Events, transcripts, databases, run records, or Relay history (`SEC-3.2.2`, `SEC-3.2.3`).

## 4. Verify

Click **Refresh logs** and verify a user-authorized synthetic operation records cleanly without drop or persistence errors. Diagnostic retention is **7 days / 20 MiB** for diagnostic JSONL only (`SEC-3.2.1`); empty history after retention or clearing does not indicate broken capture.

## 5. Stop and escalate

Escalate continuing storage, ownership, identity, or lock-owner errors. Keep original evidence and share only authorized, redacted diagnostic metadata privately. Never restart a successful agent task merely to generate a log row.
