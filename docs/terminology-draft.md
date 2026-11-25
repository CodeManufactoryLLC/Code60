# Code60 Terminology (Draft)

## Operating Contract

The Operating Contract is the instruction set that defines how a project orchestration assistant behaves in Code60. Code60 sends it on every new turn to guide delegation, planning, worker control, tool use, and responses.

A user can edit its clauses under **Customize → Internal Prompts**. It guides assistant behavior and does not act as a security boundary.

## Relay

**Relay** is Code60's always-on, application-wide assistant under **Chat → Relay**. It keeps its own persistent workspace and history, separate from any single project or database.

Relay stays ready to coordinate agent work across explicit targets, including Git repositories and direct folders. A user specifies the target and mode before Relay dispatches work.

## Workflow

A **Workflow** is a sequence of coding tasks under **Develop → Workflows** that runs in a separate Git worktree. Each task specifies implementation instructions, independent verification criteria, and optional check and repair steps.

A user reviews and starts a workflow manually. Execution runs without changing source files, `HEAD`, or the Git index.

## Transmission Server

**Transmission Server** is the local execution engine that runs **Workflow** tasks independently from the Code60 backend.

Because it operates as its own local process, active workflows continue running even after closing the browser or stopping the Code60 backend.
