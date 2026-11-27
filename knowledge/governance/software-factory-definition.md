---
id: KB-GOV-001
title: Code60 Software Factory Definition V1.0
domain: governance
kind: reference
status: active
summary: Code60's V1.0 Software Factory definition, L0-L5 autonomy tracker, C/I/S/N capability gates, and anti-pattern guardrails.
updated: 2026-11-27
related:
  - KB-ARCH-001
  - KB-REF-004
tags:
  - software-factory
  - autonomy
  - governance
  - tracker
---

# Code60 Software Factory Definition V1.0

This document is **Code60's canonical Software Factory Definition (V1.0)**—the operational standard and capability checklist that Code60 tracks itself against as it evolves toward autonomous software delivery.

> **Note:** Condensed operational tracker. `L0–L5` follows Dan Shapiro's autonomy scale; `C`/`I`/`S`/`N` IDs are local shorthand for this checklist.

## 1. Autonomy Level Tracker (L0–L5)

**Current Level:** `[ ]` | **Target Level:** `[ ]` | **Current Bottleneck:** `_______________`

| Current | Level | Mode | You Are Here If... | Required Capabilities to Reach |
| --- | --- | --- | --- | --- |
| `[ ]` | `L0–L2` | Copilot / Pairing | Humans write or interactively steer code in chat/IDE; chat history holds the intent. | — *(Not a factory)* |
| `[ ]` | `L3` | Developer as PR Manager | Agents draft PRs, but humans must line-review diffs to trust correctness. | Partial `C1–C3`, missing `C4` *(Not a factory)* |
| `[ ]` | `L4` | Supervised Factory | Versioned specs drive non-interactive convergence in sandboxes; automated external checks establish correctness; humans approve outcomes or high-risk merges. | All `C1–C5` + production essentials (`I1–I8`, `S7`) |
| `[ ]` | `L5` | Dark Factory | Humans author specs, scenarios, and twins only; zero human code writing or code reading; automated holdout & satisfaction convergence gates shipping. | All `C1–C5` + `I1–I8` + automated release/rollback (`I8`, `S2`, `S3`) |

## 2. Capability Feature Tracker

> **Gate Rules:** Missing any **Core** item = not a Software Factory. Missing any **Important** item = works as a toy demo, breaks in real production.

### Tier 1 — Core (All 5 required for a Software Factory)

| Done | ID | Capability | Exit Criterion ("You have it when...") | Notes / Owner |
| --- | --- | --- | --- | --- |
| `[ ]` | `C1` | Spec Intake | Versioned specs/seeds—not ephemeral chat logs—are the source of truth for intent. | |
| `[ ]` | `C2` | Autonomous Convergence Loop | Harness plans, edits, runs checks, diagnoses failures, and iterates asynchronously to a bounded stop. | |
| `[ ]` | `C3` | Isolated Executable Sandbox | Every run executes in an ephemeral, reproducible container/VM/devbox without polluting host/prod state. | |
| `[ ]` | `C4` | Independent Verification Oracle | Externalized/holdout checks or a separate evaluator verify behavior and cannot be modified by the coding agent. | |
| `[ ]` | `C5` | Deterministic Artifact Emission | Passing runs emit clean, versioned commits/PRs/binaries/containers with zero manual hand-stitching. | |

### Tier 2 — Important (Required for real-world production)

| Done | ID | Capability | Exit Criterion ("You have it when...") | Notes / Owner |
| --- | --- | --- | --- | --- |
| `[ ]` | `I1` | Simulated Integration Env (DTU) | Ephemeral full-stack stacks and/or behavioral clones of external APIs test real integrations safely. | |
| `[ ]` | `I2` | Hybrid Deterministic Blueprints | Formatting, linting, typechecks, and retry caps run as deterministic harness code—not prompt instructions. | |
| `[ ]` | `I3` | Context Engineering & Resets | Scoped retrieval (`AGENTS.md`, MCP, summaries) and fresh-session state handoffs prevent context rot. | |
| `[ ]` | `I4` | Probabilistic / Multi-Agent Eval | Independent judge/QA agents verify UX, end-to-end journeys, and fuzzy intent beyond binary unit tests. | |
| `[ ]` | `I5` | Blast-Radius & Injection Security | Least-privilege agent IAM, brokered ephemeral secrets, egress locks, untrusted-input isolation, no self-merge. | |
| `[ ]` | `I6` | Architectural Fitness Guardrails | Automated boundary tests, schema/contract checks, and bloat/duplication budgets block long-term rot. | |
| `[ ]` | `I7` | Economic & Loop Circuit Breakers | Harness enforces hard per-run token/dollar caps, wall-clock timeouts, and retry limits outside model control. | |
| `[ ]` | `I8` | Release Gating & Fast Rollback | Progressive rollout (canary/flags) with automated regression detection and run-ID-linked rollback. | |

### Tier 3 — Supporting (High-impact for enterprise scale)

| Done | ID | Capability | Exit Criterion ("You have it when...") | Notes / Owner |
| --- | --- | --- | --- | --- |
| `[ ]` | `S1` | Durable Execution | Multi-hour runs checkpoint state and resume cleanly after crashes or rate limits. | |
| `[ ]` | `S2` | Agentic Observability | Every run emits a correlated trace (Spec → context → tool calls → evals → commit) tied to offline benchmarks. | |
| `[ ]` | `S3` | Pipeline Provenance & Compliance | Trusted pipeline—not the agent—emits SBOMs, SLSA/in-toto attestations, and immutable audit trails. | |
| `[ ]` | `S4` | Event-Driven Intake ("Shift Work") | Monitors, alerts, and tickets auto-trigger async runs for well-specified work and route vague items to humans. | |
| `[ ]` | `S5` | Multi-Repo Fleet Orchestration | Synchronized migrations/refactors dispatch, rate-limit, and land across dozens to thousands of repos. | |
| `[ ]` | `S6` | Model-Agnostic Tiered Routing | Harness swaps providers freely and routes routine subtasks to cheap/fast models, hard tasks to frontier models. | |
| `[ ]` | `S7` | Evidence-First Outcome Scorecards | Humans review scenario scorecards, visual diffs, and ambiguity prompts instead of raw code diffs. | |

### Tier 4 — Nice-to-Have (Frontier force multipliers)

| Done | ID | Capability | Exit Criterion ("You have it when...") | Notes / Owner |
| --- | --- | --- | --- | --- |
| `[ ]` | `N1` | Pattern Extraction ("Gene Transfusion") | Proven idioms/modules are harvested from reference repos and grafted cleanly into new targets. | |
| `[ ]` | `N2` | Parallel Best-of-N Exploration | Competing branches/models run in parallel sandboxes; best-scoring artifact wins automatically. | |
| `[ ]` | `N3` | Self-Improving Harness | Meta-agent turns recurring failure traces into PRs for tighter linters, mocks, or holdout scenarios. | |
| `[ ]` | `N4` | Upstream Discovery & Spec Sync | Feedback/telemetry agents draft candidate specs and keep repo specs reconciled with live behavior. | |
| `[ ]` | `N5` | Continuous Chaos & Red-Teaming | Background fuzzing, fault injection, and injection red-teaming mint new holdout scenarios proactively. | |
| `[ ]` | `N6` | Non-Engineer Self-Service Intake | PMs/designers/ops safely submit seeds/mockups and inspect preview builds inside constitutional bounds. | |

## 3. Anti-Pattern Guardrails

### Common Impostors & Immediate Fixes

| Red-Flag Symptom | Anti-Pattern Trap | Missing | Concrete Fix |
| --- | --- | --- | --- |
| Humans prompt turn-by-turn and paste/clean up code | Vibe Coding with Extra Steps | `C1`, `C2`, `C4` | Move intent into versioned specs; run unattended loops against external checks. |
| Hundreds of agent PRs overwhelm reviewers into rubber-stamping | PR-Flood / Approval-Fatigue Trap (stuck at `L3`) | `C4`, `I2`, `S7` | Replace line-by-line PR review with externalized behavioral oracles and outcome scorecards. |
| Tests turn green because assertions were weakened or mocked away | Self-Grading Reward-Hacking Loop | `C4`, `I4`, `I6` | Move acceptance scenarios outside the coding agent's writable workspace; add independent evaluator. |
| Agent reads public issues/PRs while holding prod/DB keys or merge rights | Uncontained "Lethal Trifecta" Bot | `C3` or `I5`, `I7` | Strip static secrets; enforce egress locks, untrusted-input isolation, and separate merge authority. |
| System prompt grows every week to stop repeated agent mistakes | Prompt-Only Harness | `I2`, `I3`, `I6` | Encode every repeated failure as a deterministic linter, structural test, or blueprint step. |
| Everything passes locally, then breaks on staging/prod APIs & schemas | Mocked-Out Toy Factory | `I1`, `I6`, `I8` | Stand up full-stack ephemeral sandboxes / Digital Twins plus contract checks and automated rollback. |

### 5-Question Tripwire Audit (Any "Yes" = Active Anti-Pattern)

- [ ] Can the coding agent edit or see the exact acceptance tests that decide whether it passes? → Fix `C4` immediately.
- [ ] Does a build/test failure stop work until a human reads the error and replies? → Fix `C2` immediately.
- [ ] Are humans reading >50% of generated diffs line-by-line before merging? → Stuck at `L3`; invest in `C4`, `I4`, `S7`.
- [ ] Did you fix the last two recurring agent mistakes by adding sentences to a prompt instead of adding a deterministic check? → Fix `I2`, `I6`.
- [ ] Could a malicious external issue/README cause an unattended run to exfiltrate a secret, mutate prod, or burn unlimited spend? → Fix `I5`, `I7` immediately.
