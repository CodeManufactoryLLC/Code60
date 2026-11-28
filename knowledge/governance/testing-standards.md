---
id: KB-GOV-002
title: Testing and Verification Standards
domain: governance
kind: normative
status: active
summary: Normative rules for collaborator mock discipline, post-recovery liveness, multi-cycle maintenance tests, cross-subsystem seams, and fault-injected E2E journeys.
updated: 2026-11-27
rule_prefix: TEST
code_refs:
  - src/application/controller.ts
  - src/application/heartbeat.ts
  - src/application/memory-service.ts
  - src/application/health-check.ts
  - src/gateway/server.ts
related:
  - KB-GOV-001
tags:
  - testing
  - verification
  - governance
  - self-healing
  - qa
---

# Testing and Verification Standards

This policy governs automated unit, integration, seam, and browser end-to-end verification across Code60. Performance benchmarks and manual native-platform release checklists remain out of scope.

> The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), as mandated by [CONSTITUTION.md](../../CONSTITUTION.md). Each normative stipulation appears on its own line with a unique identifier (`TEST-<section>.<subsection>.<number>`).

## 1. Automated Verification Rules

### 1.1 Collaborator boundaries and mock discipline

- `TEST-1.1.1` Tests MUST restrict mocking to external boundaries (agent binaries, native service supervisors, network or registry transports, clocks, or process-spawn boundaries such as `fork()`) rather than replacing internal domain state machines.
- `TEST-1.1.2` Tests for lifecycle, teardown, or recovery paths MUST NOT stub or spy-replace an internal collaborator's lifecycle method (such as `close()`, `stop()`, `retireSidecar()`, or `restart()`) and assert call counts as proof of correctness.
- `TEST-1.1.3` Healthy baseline assertions MUST explicitly verify empty issue and error collections (such as `sidecarIssues: []`) rather than checking only that zero remediations occurred.

### 1.2 Recovery, self-healing, and multi-cycle invariants

- `TEST-1.2.1` Every recovery, retry, or self-healing mechanism MUST include a post-recovery liveness assertion proving that follow-up operations succeed against the real collaborator state machine.
- `TEST-1.2.2` Autonomous or periodic maintenance loops (such as Heartbeat sweeps) MUST be verified across at least two consecutive cycles (fault injection, recovery, post-heal liveness, and subsequent steady-state or cap enforcement) to catch second-order latch or loop regressions.
- `TEST-1.2.3` Fault-injection tests MUST reproduce failure shapes actually emitted by the real collaborator (such as rejected IPC promises for unresponsive sidecars) rather than synthetic payloads that the collaborator never produces.

### 1.3 Cross-subsystem seam integration

- `TEST-1.3.1` Changes that compose two or more internal runtime services (such as Heartbeat, ApplicationHost, MemoryService, and HealthCheckService in `src/gateway/server.ts`) MUST include at least one seam integration test exercising the real wiring without mocking internal methods across the seam.
- `TEST-1.3.2` Passing line or branch coverage gates (`npm run test:coverage`) MUST NOT be treated as evidence of seam or recovery correctness when mocks drive the covered branches.

### 1.4 End-to-end and fault-injection journeys

- `TEST-1.4.1` Features whose purpose includes fault detection, graceful degradation, or self-healing MUST include fault-injected verification in addition to happy-path browser E2E coverage.
- `TEST-1.4.2` Browser E2E tests MUST NOT wrap expected outcome assertions in conditional guards (such as `if (await element.isVisible())`) that allow regressions to pass silently.
