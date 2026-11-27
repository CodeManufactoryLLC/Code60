---
id: KB-OPS-000
title: Template Operational Runbook
domain: operations
kind: runbook
status: draft
summary: One-sentence summary of the failure mode or operational task covered.
updated: 2026-11-27
rule_prefix: OPS
code_refs: []
related: []
tags: []
---

# Template Operational Runbook

## 1. Symptoms and scope

Describe observable failure signals and what this runbook does and does not cover.

## 2. Safe diagnosis

1. Read-only inspection commands and what evidence to capture first.

## 3. Recovery rules

### 3.1 Safety invariants

- `OPS-3.1.1` Recovery procedures MUST preserve evidence and ownership and MUST NOT erase history, delete foreign locks, or replay uncertain work.

### 3.2 Recovery procedure

1. Step-by-step verified recovery steps.

## 4. Post-recovery verification

Confirm healthy state with explicit read-only checks.
