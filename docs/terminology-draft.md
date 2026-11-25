# Code60 Terminology (Draft)

## Two-Layer Architecture

**Two-Layer Architecture** is Code60's core technical design and orchestration philosophy. It separates high-level coordination from direct code execution.

- **Orchestration layer:** **Relay**, **Custom Assistants**, and project chats converse with the user, draft plans, delegate tasks, and review outcomes through Code60's orchestration tools. Orchestrators coordinate work and leave direct repository edits to workers.
- **Worker layer:** Coding-agent workers receive standalone tasks and edit code inside separate Git worktrees. Workers run without Code60's orchestration tools, keeping each worker's context narrow and allowing parallel execution.

## Operating Contract

The Operating Contract is the instruction set that defines how a project orchestrator behaves in Code60's [Two-Layer Architecture](#two-layer-architecture). Code60 sends it on every new turn to guide delegation, planning, worker control, tool use, and responses.

A user can edit its clauses under **Customize → Internal Prompts**. It guides assistant behavior and does not act as a security boundary.

## Relay

**Relay** is Code60's always-on, application-wide assistant under **Chat → Relay**. It keeps its own persistent workspace and history, separate from any single project or database.

Relay operates in the orchestration layer of Code60's [Two-Layer Architecture](#two-layer-architecture) to coordinate worker agents across explicit targets, including Git repositories and direct folders. A user specifies the target and mode before Relay dispatches work.

## Internal Prompts

**Internal Prompts** are the system prompt templates under **Customize → Internal Prompts** that guide project orchestration and session handoffs in Code60. They cover the **Operating Contract**, handoff summary, handoff turn, and worker-update templates.

A user can edit or reset these templates for the active database. **Relay** keeps its own separate application instructions.

## Workflow

A **Workflow** is a sequence of coding tasks under **Develop → Workflows** that runs in a separate Git worktree. Each task specifies implementation instructions, independent verification criteria, and optional check and repair steps.

A user reviews and starts a workflow manually. Execution runs without changing source files, `HEAD`, or the Git index.

## Transmission Server

**Transmission Server** is the local execution engine that runs **Workflow** tasks independently from the Code60 backend.

Because it operates as its own local process, active workflows continue running even after closing the browser or stopping the Code60 backend.

## ACP

**ACP** (Agent Client Protocol) is the protocol Code60 uses to communicate with coding-agent providers.

Through ACP, Code60 opens agent sessions, sends prompts, receives live updates, switches provider models or modes, and answers permission requests.

## MCP

**MCP** (Model Context Protocol) is the protocol that gives coding agents access to external tools and Code60 capabilities.

In Code60's [Two-Layer Architecture](#two-layer-architecture), Code60 exposes its orchestration MCP tools to the orchestration layer and omits them from the worker layer. Those tools cover worker control, planning, reviews, and browser automation. A user can also connect external MCP tool servers under **Connect → MCP Servers**.
