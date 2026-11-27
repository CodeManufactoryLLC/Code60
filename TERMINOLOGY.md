# Code60 Terminology

> **Applies to:** Code60 `v0.5.0-beta` · **Last update:** `2026-11-26`
> Open **Manage → About** or run `code60 status` to check the local Code60 version. See [Code60 FAQ](knowledge/reference/faq/INDEX.md) for common questions.

## Terms

- [ACP](#acp)
- [Agent Provider](#agent-provider)
- [Computer Use](#computer-use)
- [Continuity Checkpoint](#continuity-checkpoint)
- [Gateway](#gateway)
- [Internal Prompts](#internal-prompts)
- [MCP](#mcp)
- [Memory Capture](#memory-capture)
- [Operating Contract](#operating-contract)
- [Orchestration](#orchestration)
- [Relay](#relay)
- [Scheduled Job](#scheduled-job)
- [Two-Layer Architecture](#two-layer-architecture)
- [Usage Monitoring](#usage-monitoring)
- [Workflow](#workflow)

## ACP

**ACP** (Agent Client Protocol) is the protocol Code60 uses to communicate with coding-agent providers.

Through ACP, Code60 opens agent sessions, sends prompts, receives live updates, switches provider models or modes, and answers permission requests.

## Agent Provider

An **Agent Provider** is an external coding-agent command-line interface (CLI) or harness that Code60 connects to through [ACP](#acp). Examples include **Antigravity**, **Claude**, **Codex**, **Copilot**, **Droid**, **Kiro**, and **OpenCode**.

Agent Providers supply the underlying coding agents for both layers of Code60's [Two-Layer Architecture](#two-layer-architecture). Each provider manages its own credentials, models, and harness modes, while a user manages provider connections under **Connect → Providers**.

## Computer Use

**Computer Use** is an artificial intelligence (AI) agent's ability to operate a computer through its graphical user interface. It includes reading the screen, moving the mouse, typing, and clicking across desktop applications.

Code60 does not provide native desktop Computer Use. For web tasks, Code60 provides browser automation (`code60_browser`), which controls web pages in Chrome without operating native desktop applications.

## Continuity Checkpoint

A **Continuity Checkpoint** is a concise summary of recent context that Code60 creates before rolling a long session into a fresh [ACP](#acp) session.

It carries recent context forward as evidence only, without restoring old permissions or task authority. Continuity Checkpoints stay session-local and work even when long-term **Memory** stays off.

## Gateway

**Code60 Gateway** is Code60's local Node.js 24 backend service. It serves the browser interface, enforces browser and network security boundaries, manages agent sessions, and runs **Scheduled Jobs** and **Workflows**.

Code60 Gateway runs in the background as a per-user service. Active agents, **Scheduled Jobs**, and **Workflows** continue running after closing or refreshing the browser.

## Internal Prompts

**Internal Prompts** are the 44 system prompts under **Customize → Internal Prompts** that guide orchestration, handoffs, plans, reviews, memory, and utilities in Code60. Each prompt uses a unique lowercase dot-path identifier across 11 domains.

A user can edit or reset 10 project and utility templates for the active database, including the **Operating Contract**. The other 34 entries stay read-only to protect safety wrappers, strict JSON schemas, tactics, default `$` commands, and **Relay**.

## MCP

**MCP** (Model Context Protocol) is the protocol that gives coding agents access to external tools and Code60 capabilities.

In Code60's [Two-Layer Architecture](#two-layer-architecture), Code60 exposes its orchestration MCP tools to the orchestration layer and omits them from the worker layer. Those tools cover worker control, planning, reviews, and browser automation. A user can also connect external MCP tool servers under **Connect → MCP Servers**.

## Memory Capture

**Memory Capture** is the optional background process that collects evidence from recent conversation turns and extracts long-term memory records when **Memory** stays on.

Turning **Memory** off stops Memory Capture immediately and discards pending capture data without affecting existing records or session-local [Continuity Checkpoints](#continuity-checkpoint).

## Operating Contract

The Operating Contract is the instruction set that defines how a project orchestrator behaves in Code60's [Two-Layer Architecture](#two-layer-architecture). Code60 sends it on every new turn to guide delegation, planning, worker control, tool use, and responses.

A user can edit its clauses under **Customize → Internal Prompts**. It guides assistant behavior and does not act as a security boundary.

## Orchestration

**Orchestration** is the high-level coordination work in the top layer of Code60's [Two-Layer Architecture](#two-layer-architecture). It covers planning, task delegation, worker supervision, and result review across **Relay**, **Custom Assistants**, and project chats.

An orchestrator breaks requests into standalone tasks, dispatches worker agents into separate Git worktrees, and tracks their progress with human oversight. Direct repository edits stay in the worker layer.

## Relay

**Relay** is Code60's always-on, application-wide assistant under **Chat → Relay**. It keeps its own persistent workspace and history, separate from any single project or database.

Relay operates in the orchestration layer of Code60's [Two-Layer Architecture](#two-layer-architecture) to coordinate worker agents across explicit targets, including Git repositories and direct folders. A user specifies the target and mode before Relay dispatches work.

## Scheduled Job

A **Scheduled Job** is a local recurring automation under **Automate → Scheduled Jobs** that [Code60 Gateway](#gateway) runs in a separate Git worktree.

Each job dispatches either a single-turn headless prompt under a deny-by-default tool allowlist or a multi-task [Workflow](#workflow) with `autoApprove` controls. Concurrency lanes and per-repository locks hold slots until each run ends, and Code60 leaves worktrees on disk for manual review.

## Two-Layer Architecture

**Two-Layer Architecture** is Code60's core technical design and orchestration philosophy. It separates high-level coordination from direct code execution.

- **Orchestration layer:** **Relay**, **Custom Assistants**, and project chats converse with the user, draft plans, delegate tasks, and review outcomes through Code60's orchestration tools. Orchestrators coordinate work and leave direct repository edits to workers.
- **Worker layer:** Coding-agent workers receive standalone tasks and edit code inside separate Git worktrees. Workers run without Code60's orchestration tools, keeping each worker's context narrow and allowing parallel execution.

## Usage Monitoring

**Usage Monitoring** is Code60's local, read-only system for tracking token burn rates and inspecting heavy chats and workflows across every [Agent Provider](#agent-provider).

[Code60 Gateway](#gateway) logs quantitative [ACP](#acp) turn metrics into `$XDG_STATE_HOME/code60/usage/usage.sqlite` without storing prompts, replies, file paths, or secrets. A user can inspect reports under **Manage → Usage** or run `code60 usage` in a terminal.

## Workflow

A **Workflow** is a sequence of coding tasks under **Automate → Workflows** that [Code60 Gateway](#gateway) runs in a separate Git worktree with any active [Agent Provider](#agent-provider). Each task specifies implementation instructions, independent verification criteria, and optional check and repair steps.

A workflow starts manually from current repository files or on a cadence through **Automate → Scheduled Jobs** from a local base branch. Execution runs without changing source files, `HEAD`, or the Git index.
