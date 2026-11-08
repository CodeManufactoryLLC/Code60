# Agents

`src/agents` starts agent processes and talks to them over ACP with `@agentclientprotocol/sdk`. Read [ARCHITECTURE.md](../../ARCHITECTURE.md) before changing it.

- Do not import `core` or `git`.
- Spawn agents through `platform` with argument arrays, the run's worktree as the working directory, and their own POSIX process group or Windows owned Job Object.
- Advertise no ACP file-system or terminal client capabilities.
- Keep the agent process and session open after a turn ends. Stop the process only when the caller finishes the run or cancellation escalates.
- Reject a prompt sent while a turn is still in progress.
- Forward permission requests to the caller, and never answer them here.
- Capture every ACP session update as a raw `acp` event, capped at 256 KiB of UTF-8 JSON text with the original byte size and a truncation marker. Also translate understood updates into typed run events. Never treat unrecognized updates as errors or approvals. Suppress both raw and typed transcript replay during `session/load`, while retaining replayed tool-call state.
- Treat agent output as untrusted. Never infer errors or outcomes from free text.
- Cancel with `session/cancel`, then stop through `platform`: POSIX SIGTERM/SIGKILL grace or Windows owned-job termination. Never issue POSIX group signals on Windows.
- Keep only a bounded, credential-scrubbed tail of stderr through the platform diagnostic utility. Redact before clipping; do not echo provider errors that may contain prompts. Preserve transcript events separately.
