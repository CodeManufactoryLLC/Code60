---
id: KB-REF-013
title: "FAQ: Licensing, Pricing, and Token Usage"
domain: reference
kind: reference
status: active
summary: Frequently asked questions on Apache-2.0 commercial use, cost, token usage impact, and local usage monitoring.
updated: 2026-11-27
code_refs:
  - src/contracts/usage.ts
  - src/core/usage-store.ts
  - src/management/cli.ts
related:
  - KB-REF-010
  - KB-REF-014
tags:
  - faq
  - licensing
  - usage
---

# FAQ: Licensing, Pricing, and Token Usage

> **Applies to:** Code60 `v1.0.0-alpha.1` · **Last update:** `2026-11-27`
> Open **Manage → About** or run `code60 status` to check the local Code60 version.

## Licensing and Pricing

### Can I use Code60 for commercial purposes?

Yes. Code60 ships under the [Apache License, Version 2.0](../../../LICENSE), which permits commercial use, modification, and distribution under its terms.

- **Notices:** Redistributions must keep the license and attribution notices in [LICENSE](../../../LICENSE) and [NOTICE](../../../NOTICE).
- **Trademarks:** "Code60" and the Code60 logo belong to Code Manufactory LLC. The Apache License grants no trademark rights, so forks and commercial offerings must follow the [Trademark Policy](../../../TRADEMARKS.md).
- **Provider terms:** Commercial use of external coding-agent providers also depends on each provider's own terms of service.

### How much does Code60 cost to use?

Code60 is free and open-source under the [Apache License, Version 2.0](../../../LICENSE). Code60 uses your existing third-party coding agents and tools and is subject to their cost structure.

## Token Usage Monitoring

### How does Code60 affect token usage?

Code60 does not bill for tokens, and actual usage depends on the active **Agent Provider** and models. Total token usage balances extra upfront coordination against potential net savings on complex, multi-step tasks.

- **Upfront cost versus net savings:** Running an orchestrator alongside workers in Code60's Two-Layer Architecture adds upfront tokens for instructions, tools, and updates. On complex, long-trajectory tasks, narrow worker contexts, plan review, and independent verification can reduce drift and rework. That higher reliability may reduce net token usage across the full task.
- **Parallel runs and workflows:** Running multiple workers in parallel increases immediate token usage. **Workflows** also spend tokens on independent verification, repair passes, and fresh-session retries.
- **Optional helper features:** Active **Memory** extraction, **Search** overviews, **Create with prompt** drafting, and automatic context handoffs send relevant context to the active provider. Turning **Memory** off stops memory extraction and recall.
- **Cost control and visibility:** The composer footer displays live context fill whenever the provider sends it. **Manage → Usage** and `code60 usage` display per-provider totals, heavy sessions, and turn details. The **Model** picker sets separate defaults for orchestrators and workers.

### How does Code60 monitor token usage?

Code60 Gateway logs quantitative metrics for every ACP turn across **Relay**, **Custom Assistants**, project chats, workers, **Scheduled Jobs**, **Workflows**, and background helpers. A user can inspect totals under **Manage → Usage** or run `code60 usage` in a terminal.

- **Three measurement tiers:** Each turn carries a confidence label. Labels cover exact ACP usage, context-model math from `usage_update` waves, or lower-bound counts from visible ACP text.
- **Burn rate and context growth:** Reports separate cumulative turn totals from net context growth, tool waves, and context compactions. Those signals help identify heavy chats, loops, and workflow steps.
- **ACP visibility limits:** When a provider omits ACP usage metadata, Code60 cannot inspect internal harness system prompts or local tool output outside ACP.
- **Reports and exports:** Both **Manage → Usage** and `code60 usage` support JSON, CSV, and Markdown output with turn-level inputs and formulas.

### Does Code60 enforce token budgets or calculate dollar bills?

No. Usage Monitoring is read-only. Code60 never enforces spend caps, blocks turns, or guesses dollar bills from rate tables.

When an Agent Provider emits an ACP `cost` field inside `usage_update`, Code60 shows that provider's session cost deltas directly.

### What data does Usage Monitoring store, and how can I clear it?

Code60 stores local usage data in `$XDG_STATE_HOME/code60/usage/usage.sqlite` with private file permissions (`0600`). Rows contain timestamps, provider IDs, model IDs, surface roles, opaque IDs, and numeric counts only.

Usage records and exports omit prompts, assistant replies, source code, file paths, and secrets. Open **Manage → Usage** and choose **Clear usage history** to remove all usage rows after confirmation. Clearing usage history keeps transcripts, databases, and Git worktrees intact.
