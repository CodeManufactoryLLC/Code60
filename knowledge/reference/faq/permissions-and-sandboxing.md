---
id: KB-REF-011
title: "FAQ: Permissions and Sandboxing"
domain: reference
kind: reference
status: active
summary: Frequently asked questions on Code60 auto-approval, agent sandboxing boundaries, and Agent Provider sandbox controls.
updated: 2026-11-27
code_refs:
  - src/core/config.ts
  - src/core/orchestrator.ts
  - src/gateway/server.ts
related:
  - KB-REF-012
  - KB-REF-014
tags:
  - faq
  - security
  - permissions
  - sandboxing
---

# FAQ: Permissions and Sandboxing

> **Applies to:** Code60 `v0.5.0-beta` · **Last update:** `2026-11-27`
> Open **Manage → About** or run `code60 status` to check the local Code60 version. See [Code60 Terminology](../../../TERMINOLOGY.md) for key terms.

## Security and Permissions

### How does Code60 Auto-Approval work?

**Code60 auto-approval** sets one application-wide permission policy across both layers of Code60's [Two-Layer Architecture](../../../TERMINOLOGY.md#two-layer-architecture). It covers orchestrators (**Relay**, **Custom Assistants**, and project chats) and their workers. The **auto-approve** checkbox sits in the top header, starts on, and persists across restarts.

- **When on:** Code60 answers each new ACP permission request with a once-only allow option and never grants an always-allow rule. If the agent offers no matching once-only option, Code60 cancels the request.
- **When off:** Each new ACP request waits in the requesting conversation for a human to choose **Allow once** or **Deny**. The **Workspace** approval count opens a waiting conversation, including a project chat in the archive.
- **Live changes:** The toggle remains available during a turn and applies to new ACP requests in live and future sessions. Any request already waiting for review still needs a human answer after switching auto-approval back on.
- **Harness mode:** **Code60 auto-approval** operates separately from **Harness mode**. Choosing an Ask mode on a provider harness leaves **Code60 auto-approval** on. Any sandboxing depends on that provider harness.
- **Other run types and limits:** Manual runs, **Scheduled Jobs**, and **Workflows** keep separate permission policies. Single-prompt jobs use an explicit deny-by-default tool allowlist, while workflow jobs expose the workflow `autoApprove` toggle. ACP permissions do not create an operating-system sandbox and cannot block actions an agent takes without requesting approval.

### Does Code60 provide a sandbox for my agents?

No. Code60 does not provide an operating-system, filesystem, or network sandbox for coding agents or MCP servers. Every agent runs with the backend user's operating-system permissions.

- **Code60 safeguards:** Browser and gateway checks protect the web interface and local application programming interface (API). Git worktrees separate Git working files, and the [Operating Contract](../../../TERMINOLOGY.md#operating-contract) and ACP permissions guide behavior and approval prompts.
- **Security limits:** None of those controls creates an operating-system security boundary or blocks actions an agent takes without requesting ACP approval. See the [Security Policy](../../../SECURITY.md) for full details.
- **Roadmap:** Optional Docker workers with filesystem, network, and resource boundaries appear in the [Code60 roadmap](https://github.com/CodeManufactoryLLC/code60/issues/79).

### How do I provide a sandbox for my agents with Code60?

Apply sandboxing outside Code60 or through each [Agent Provider](../../../TERMINOLOGY.md#agent-provider).

- **Provider sandbox:** Enable the sandbox settings and **Harness mode** options that each **Agent Provider** supports in its own CLI or configuration.
- **Container or virtual machine:** Run Code60 inside a container (such as the optional [Linux development container](../../../.devcontainer/README.md)) or a virtual machine. A separate operating-system user account with narrow filesystem and network access also limits what agents can touch.
- **Manual approval review:** Turn off **auto-approve** in the top header to review each ACP permission request. Manual review helps inspect prompts, while operating-system boundaries still come from the provider sandbox, container, virtual machine, or user account.

### How does Code60 interact with my Agent Provider's sandbox?

Code60 leaves sandbox rules and enforcement to each [Agent Provider](../../../TERMINOLOGY.md#agent-provider) and its own configuration.

- **Harness mode forwarding:** Code60 shows any **Harness mode** options an **Agent Provider** offers over ACP and forwards the user's choice. The harness determines what each mode does, including any sandbox behavior.
- **Separate from Code60 auto-approval:** **Code60 auto-approval** only answers ACP permission requests. Switching it on or off does not change a provider's operating-system sandbox. Choosing an Ask mode on the harness also leaves **Code60 auto-approval** on.
- **Workflows:** Each **Workflow** runs on the active **Agent Provider** the user selects, and that provider's harness owns any sandbox rules it applies.
