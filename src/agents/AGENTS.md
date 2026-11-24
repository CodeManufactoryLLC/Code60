# Agents

`src/agents` starts agent processes and talks to them over ACP with `@agentclientprotocol/sdk`. Read [ARCHITECTURE.md](../../ARCHITECTURE.md) before changing it.

- Do not import `core` or `git`.
- The MCP connectors target design uses one agents-owned stdio adapter per
  session/connector; gateway composes transports and application owns authority.
  Phase 1 supplies protocol feasibility fixtures only, not a live connector
  entrypoint. Upstream credentials stay backend-owned; provider adapters receive
  only scoped, ephemeral capabilities. Preserve existing ACP permission handling.
- Spawn agents through `platform` with argument arrays, the run's worktree as the working directory, and their own POSIX process group.
- Advertise no ACP file-system or terminal client capabilities.
- Keep the agent process and session open after a turn ends. Stop the process only when the caller finishes the run or cancellation escalates.
- Reject a prompt sent while a turn is still in progress.
- Forward permission requests to the caller, and never answer them here.
- Capture every ACP session update as a raw `acp` event, capped at 256 KiB of UTF-8 JSON text with the original byte size and a truncation marker. Also translate understood updates into typed run events. Never treat unrecognized updates as errors or approvals. Suppress both raw and typed transcript replay during `session/load`, while retaining replayed tool-call state.
- Treat agent output as untrusted. Never infer errors or outcomes from free text.
- Optional desktop diagnostics record provider connection boundaries and durations
  once, with allowlisted provider/error metadata and opaque correlation IDs only.
  Never serialize AgentSpec, process arguments/environments or ACP payloads into logs.
- Cancel with `session/cancel`, then stop through `platform`: POSIX SIGTERM/SIGKILL grace.
- Keep only a bounded, credential-scrubbed tail of stderr through the platform diagnostic utility. Redact before clipping; do not echo provider errors that may contain prompts. Preserve transcript events separately.

## MCP production connections (phase 5)

Phase 5 supersedes the earlier deferred-runtime guidance. Dedicated mcp.json files
are authoritative; config.json.mcpServers has no reader or migration. Application
reuses its existing store and owns resolution, private exact-revision approvals and
session/turn authority. Core's optional resource hook creates fresh per-session
resources on new/load/resume/handoff/continuity replacement; helpers and scheduler
remain excluded. Gateway owns the private capability broker and injects the agents
transport port. The pinned MCP SDK belongs only to agents. Platform owns process
groups. Providers receive fixed stdio adapter descriptors and ephemeral capabilities,
never upstream definitions or credentials. No application-to-agents dependency.

Tools only; keep ACP permissions independent of turn authority. Revoke before
cleanup; never replay uncertain calls or resume HTTP transport automatically. Tests
only initialize/discover, with page ownership and stdio launch confirmation. Enable
and approval changes affect future connections; Disconnect/Reconnect are explicit.
Reconnect requires idle and provider load/resume support, previews every affected
connector, and sends no prompt. Keep JSON drafts and existing recovery evidence.
Credential references/OAuth require authentication until phase 6. Publish safe status
and payload-free notices only. Dedicated integrations and recovery GUI stay excluded.
