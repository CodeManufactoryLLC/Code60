# Architectural View: MCP Connector Ownership

## Motivation

### Goal

Give users predictable MCP configuration, authentication, connection status and
recovery while keeping upstream credentials in the local Code60 backend.

### Problem

The current runtime forwards definitions to ACP providers, which own connections
and authentication. That boundary cannot establish uniform Code60-managed health,
credential refresh or teardown. Project configuration also needs explicit review
and deterministic precedence independent of sidebar selection.

## Description

### Approach

Use one versioned schema for dedicated user/project MCP documents. Project entries
always shadow matching user IDs, even when disabled or awaiting approval. Resolve
only captured execution targets; private approval binds project identity and
document revision. Configuration eligibility never implies authentication or health.

The target runtime owns one upstream connection per session/connector and presents
both stdio and Streamable HTTP through a local stdio adapter. Providers receive an
ephemeral capability scoped to that session and connector, rather than upstream
credentials. Keep existing ACP permissions and independently enforce live authority.

### Boundaries

Application owns resolution, trust and lifecycle; agents owns MCP protocol and
adapters; gateway composes transports through injected ports and owns loopback
listeners; platform owns native identity, processes and future secure storage.
The only new module dependency is gateway to agents. Browser modules receive no
generic host capabilities. Tools are the initial MCP surface; other features are
explicitly unsupported.

Phase 1 supplies schemas, pure resolution and protocol fixtures only. Active config
loading, production transport/adapter composition, secure storage, OAuth and GUI
management remain later work. The proof does not certify real provider behavior.
Detailed contracts and lifecycle rules live in
[MCP connector architecture](../../ARCHITECTURE.md#mcp-connector-foundation-and-target-runtime).

## Tradeoffs

### Pros

- Consistent backend-owned credentials, connection evidence and cancellation.
- No optional ACP HTTP capability required at the provider boundary.
- Session isolation keeps roots, mutable server state and revocation separate.
- Explicit project shadowing prevents silent connections to a different server.

### Cons

- Per-session isolation consumes more processes and connections than pooling.
- A new local adapter/broker boundary needs capability validation and cleanup.
- Disabled or unapproved project entries suppress usable user entries until resolved.
- Tools-only support excludes resources, prompts, sampling and elicitation initially.
