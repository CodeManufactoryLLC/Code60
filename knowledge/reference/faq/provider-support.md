---
id: KB-REF-018
title: "FAQ: Provider Support, Local Models, and Skills"
domain: reference
kind: reference
status: active
summary: Frequently asked questions on Code60's standard Agent Provider catalog, local model harnesses, and repository or user-level skills.
updated: 2026-11-27
code_refs:
  - src/application/provider-catalog.ts
  - src/application/provider-setup-policy.ts
related:
  - KB-REF-019
  - KB-REF-006
tags:
  - faq
  - providers
  - skills
---

# FAQ: Provider Support, Local Models, and Skills

> **Applies to:** Code60 `v0.5.0-beta` · **Last update:** `2026-11-27`
> Open **Manage → About** or run `code60 status` to check the local Code60 version.

## Provider Support

Code60 connects both layers of its Two-Layer Architecture to coding-agent providers through ACP. It never asks for provider passwords and never stores API keys. Each provider keeps its own credentials in the backend user's storage.

The standard provider catalog covers **Antigravity, Claude, Codex, Copilot, Droid, Kiro, and OpenCode**. Under **Connect → Providers**, a user can verify a CLI that already holds an active login. A user can also run Code60's in-app installation and browser sign-in flow.

In-app setup verifies release integrity before placing exact versions into private backend-user storage. It leaves existing CLIs and configuration intact. Users manage API keys, account switching, logout, enterprise endpoints, and custom launch commands outside Code60.

See [FAQ: Provider Authentication](provider-authentication.md) for per-provider login steps covering Antigravity, Claude, Codex, Copilot, Droid, Kiro, OpenCode, and Cursor.

### Does Code60 work with local models?

Yes, through any agent that supports local models. Code60 does not run local language models directly and connects to coding-agent harnesses through ACP.

- **Through a harness:** A user can run local models when an ACP harness, such as **OpenCode**, points to a local model server. Code60's **Model** picker shows the models that active harness reports.
- **External setup:** Code60's in-app setup flows cover official cloud sign-ins only. Configuring a harness to call a local model server happens outside Code60 in that harness's own configuration.
- **Workflows:** **Workflows** support any active **Agent Provider** from **Connect → Providers**, including harnesses that call local model servers.
- **Local embeddings:** Separately from coding agents, Code60 runs its own embedding model offline on the CPU without a graphics card or external service.

### Does Code60 use my Agent Provider's existing repository skills?

Yes in the worker layer, **Scheduled Jobs**, and **Workflows**, where each **Agent Provider** discovers skills from the repository working directory.

- **Worker layer, Scheduled Jobs, and Workflows:** Code60 starts project workers, **Scheduled Jobs**, and **Workflows** inside the repository's Git worktree (or direct target folder). Each **Agent Provider** discovers repository skills and instruction files there according to its own rules.
- **Orchestration layer:** In Code60's Two-Layer Architecture, **Relay**, **Custom Assistants**, and project orchestrators run in private Code60 workspace folders outside the Git checkout. Provider harnesses generally do not auto-discover repository skills for the orchestrator.

### Does Code60 use my Agent Provider's existing user-level skills?

Yes, through each **Agent Provider**. Code60 does not read provider skill files directly, and it does not disable user-level skills during normal sessions.

- **Host environment:** Code60 launches **Agent Providers** with the backend user's normal home directory (`HOME`). Both orchestrators and workers receive whatever user-level skills and configuration that provider normally loads from the user's home directory.
- **Containers and custom paths:** The optional Linux development container gives each worktree its own private provider home volume separate from the host home directory. **Workflows** use the same provider environment as interactive sessions.
