# Code60 FAQ (Draft)

## Requirements and Setup

### Do I need Docker to run Code60?

No. Code60 installs, runs, and supports local development without Docker.

Code60 runs natively on macOS Apple Silicon and Linux x64. It uses a local Node.js 24 backend, a browser interface, and separate Git worktrees for coding agents.

Only optional contributor workflows require a local Linux Docker engine with Compose v2. Docker Desktop remains optional.

- **Linux development container:** Contributors run `npm run devcontainer -- start` for the optional [Linux development container](../.devcontainer/README.md).
- **Clean-install acceptance tests:** Contributors run `npm run test:packaged:clean` for the container acceptance test suite.

Optional Docker agent workers for stricter filesystem and network boundaries appear on the future roadmap. Code60 runs without them.

## Workspaces and Worktrees

### Does Code60 automatically delete worktrees?

No. Code60 never deletes Git worktrees automatically.

- **Normal lifecycle events:** Finishing, cancelling, or stopping a run leaves existing worktrees intact. Closing the browser, stopping or restarting the backend, updating Code60, or running `code60 uninstall` or `code60 service uninstall` also keeps them on disk.
- **Scheduled Jobs and Transmission Workflows:** Worktrees from **Scheduled Jobs** and **Transmission Workflows** stay on disk. A user can inspect changes and diffs with normal Git tools.
- **Manual removal:** For an inactive run, open its actions menu (for example, in **Apps → Data Viewer**) and choose **Delete worktree**. Code60 blocks removal while the run or its agent process remains active.
- **Confirmation and history:** Before removing a worktree and its run branch, Code60 shows a confirmation dialog. That dialog lists the worktree path, branch, and every file with edits that removal erases. After removal, the session record stays visible as inactive.

## Security and Permissions

### How does Code60 Auto-Approval work?

**Code60 auto-approval** sets one application-wide permission policy across both layers of Code60's [Two-Layer Architecture](terminology-draft.md#two-layer-architecture). It covers orchestrators (**Relay**, **Custom Assistants**, and project chats) and their workers. The toggle sits beside **Harness mode** in the composer, starts on, and persists across restarts.

- **When on:** Code60 answers each new Agent Client Protocol (ACP) permission request with a once-only allow option and never grants an always-allow rule. If the agent offers no matching once-only option, Code60 cancels the request.
- **When off:** Each new ACP request waits in the requesting conversation for a human to choose **Allow once** or **Deny**. The **Workspace** approval count opens a waiting conversation, including a project chat in the archive.
- **Live changes:** The toggle remains available during a turn and applies to new ACP requests in live and future sessions. Any request already waiting for review still needs a human answer after switching auto-approval back on.
- **Harness mode:** **Code60 auto-approval** operates separately from **Harness mode**. Choosing an Ask mode on a provider harness leaves **Code60 auto-approval** on. Any sandboxing depends on that provider harness.
- **Other run types and limits:** Manual runs, **Scheduled Jobs**, and **Transmission Workflows** keep separate permission policies. ACP permissions do not create an operating-system sandbox and cannot block actions an agent takes without requesting approval.

### Does Code60 provide a sandbox for my agents?

No. Code60 does not provide an operating-system, filesystem, or network sandbox for coding agents or Model Context Protocol (MCP) servers. Every agent runs with the backend user's operating-system permissions.

- **Code60 safeguards:** Browser and gateway checks protect the web interface and local application programming interface (API). Git worktrees separate Git working files, and the [Operating Contract](terminology-draft.md#operating-contract) and ACP permissions guide behavior and approval prompts.
- **Security limits:** None of those controls creates an operating-system security boundary or blocks actions an agent takes without requesting ACP approval. See the [Security Policy](../SECURITY.md) for full details.
- **Roadmap:** Optional Docker workers with filesystem, network, and resource boundaries appear in the [Code60 roadmap](../ROADMAP.md).

### How do I provide a sandbox for my agents with Code60?

Apply sandboxing outside Code60 or through each [Agent Provider](terminology-draft.md#agent-provider).

- **Provider sandbox:** Enable the sandbox settings and **Harness mode** options that each **Agent Provider** supports in its own command-line interface (CLI) or configuration.
- **Container or virtual machine:** Run Code60 inside a container (such as the optional [Linux development container](../.devcontainer/README.md)) or a virtual machine. A separate operating-system user account with narrow filesystem and network access also limits what agents can touch.
- **Manual approval review:** Turn off **Code60 auto-approval** in the composer to review each ACP permission request. Manual review helps inspect prompts, while operating-system boundaries still come from the provider sandbox, container, virtual machine, or user account.

### How does Code60 interact with my Agent Provider's sandbox?

Code60 leaves sandbox rules and enforcement to each [Agent Provider](terminology-draft.md#agent-provider) and its own configuration.

- **Harness mode forwarding:** Code60 shows any **Harness mode** options an **Agent Provider** offers over ACP and forwards the user's choice. The harness determines what each mode does, including any sandbox behavior.
- **Separate from Code60 auto-approval:** **Code60 auto-approval** only answers ACP permission requests. Switching it on or off does not change a provider's operating-system sandbox. Choosing an Ask mode on the harness also leaves **Code60 auto-approval** on.
- **Transmission Workflows:** In **Transmission Workflows**, the internal Codex harness owns execution permissions and any sandbox rules it applies.

### What security measures does Code60 take?

Code60 protects the browser interface, local API, orchestration gateway, files, processes, and credentials, while agents still run with the user's operating-system permissions. See the [Security Policy](../SECURITY.md) for full details.

#### Browser, local network, and API boundaries

- **Localhost interface:** The backend listens on `127.0.0.1` by default and enforces Host, Origin, and Content Security Policy (CSP) checks. Browser tabs use per-tab session tokens, explicit **Take control** transfers, and optional `code60 pairing on` codes.
- **Web Server (Beta) limits:** Optional local-network access starts off and uses only the primary private IPv4 address. It enforces single-use 60-second pairing codes with rate limits, separates local and network sessions, serves only static release assets, and blocks management routes.
- **Narrow application API:** The gateway validates every request against a strict operation map and exposes no generic shell or filesystem interface. File choosers accept only opaque IDs inside local workspace roots, and human confirmations stay browser-only.

#### Process, filesystem, and storage safeguards

- **Process safety:** Code60 spawns subprocesses with argument arrays without a shell and checks process identity before stopping any process. Local management commands authenticate through private filesystem metadata outside browser origins.
- **Symlink and file guards:** Private configuration and state operations reject symlinks, hard links, and world-writable paths using `O_NOFOLLOW` and atomic staging. New run directories and files use private permissions (`0700` and `0600`).
- **Diagnostics and redaction:** Operational errors and `stderr` tails apply best-effort redaction for common tokens, headers, and private keys. Diagnostic logs keep only strict event metadata and exclude prompts, transcripts, paths, and secrets.

#### Orchestration, MCP, and browser-tool controls

- **Orchestration gateway:** Code60's orchestration MCP server runs behind a token check on `127.0.0.1` with size and time limits. Workers never receive Code60's orchestration tools.
- **MCP servers and network policy:** Project MCP definitions start off and require human approval for their exact revision. Stdio servers run without a shell in an allowlist environment. HTTP servers check Domain Name System (DNS) destinations, block cloud metadata addresses, and require HTTPS for credentials outside loopback.
- **MCP secrets and OAuth:** Secrets stay in macOS Keychain, Linux Secret Service, or explicit temporary memory and never reach the browser. OAuth, an open authorization protocol, enforces S256 Proof Key for Code Exchange (PKCE), exact issuer checks, and single-use five-minute callbacks.
- **Browser automation tool:** The `code60_browser` tool runs Playwright in a private context and blocks host-code execution, installation, file upload, and page WebMCP tools. Workers, helpers, and **Scheduled Jobs** do not receive it.

#### Package integrity and repository checks

- **Provider setup and updates:** In-app provider setup checks release integrity, disables npm lifecycle scripts, and accepts only exact official HTTPS login domains. Code60 updates verify SHA-512 digests and complete file inventories before replacing a release, without running registry bootstrap code.
- **Repository security scans:** Security workflows run CodeQL, lockfile dependency audits, and Gitleaks secret scans on pull requests, pushes to `main`, and a weekly schedule.

## Licensing and Pricing

### Can I use Code60 for commercial purposes?

Yes. Code60 ships under the [Apache License, Version 2.0](../LICENSE), which permits commercial use, modification, and distribution under its terms.

- **Notices:** Redistributions must keep the license and attribution notices in [LICENSE](../LICENSE) and [NOTICE](../NOTICE).
- **Trademarks:** "Code60" and the Code60 logo belong to Code Manufactory LLC. The Apache License grants no trademark rights, so forks and commercial offerings must follow the [Trademark Policy](../TRADEMARKS.md).
- **Provider terms:** Commercial use of external coding-agent providers also depends on each provider's own terms of service.

### How much does Code60 cost to use?

Code60 is free and open-source under the [Apache License, Version 2.0](../LICENSE). Code60 uses your existing third-party coding agents and tools and is subject to their cost structure.

## Orchestration and Workers

### How are Code60 subagents different than my Agent Provider's subagents?

In Code60's [Two-Layer Architecture](terminology-draft.md#two-layer-architecture), Code60 subagents (workers) are full Code60 sessions that run in separate Git worktrees. An [Agent Provider's](terminology-draft.md#agent-provider) internal subagents run inside that single provider's process and stay outside Code60's orchestration controls.

- **Separate Git worktrees:** Each Code60 project worker edits files in its own Git worktree and run branch. Code60 integrates those edits safely and supports message-level **Undo**, whereas a provider's internal subagents typically share one working directory.
- **Cross-provider flexibility:** Code60 can dispatch workers using any active **Agent Provider** and apply separate model defaults for orchestrators and workers. A provider's internal subagents stay within that single provider's harness.
- **Direct visibility and control:** Each Code60 worker has its own sidebar chat, live transcript, and diff viewer. A user can directly message, cancel, stop, or resume a worker. Provider-internal subagents usually run as internal tool calls without separate Code60 worker views.
- **Local run records:** Code60 keeps local run records, transcripts, and process-group tracking for each worker. A user or orchestrator can inspect or continue an inactive worker later.
- **Using both together:** Code60 does not block a provider's internal subagents. If a harness spawns its own subagents inside a worker session, they run within that worker's worktree under that provider's control.

### Does Code60 use my Agent Provider's subagents?

No. Code60 does not call or manage an [Agent Provider's](terminology-draft.md#agent-provider) internal subagents directly.

In Code60's [Two-Layer Architecture](terminology-draft.md#two-layer-architecture), orchestrators delegate coding tasks by starting Code60 worker sessions through ACP. Each project worker runs in its own Git worktree with its own transcript and lifecycle controls.

Code60 does not block a provider's internal subagents. If a harness spawns its own subagents during a turn, they run inside that session's directory or worktree under that provider's control.

## Provider Support

Code60 connects both layers of its [Two-Layer Architecture](terminology-draft.md#two-layer-architecture) to coding-agent providers through ACP. It never asks for provider passwords and never stores API keys. Each provider keeps its own credentials in the backend user's storage.

The standard provider catalog covers **Antigravity, Claude, Codex, Copilot, Droid, Kiro, and OpenCode**. Under **Connect → Providers**, a user can verify a CLI that already holds an active login. A user can also run Code60's in-app installation and browser sign-in flow.

In-app setup verifies release integrity before placing exact versions into private backend-user storage. It leaves existing CLIs and configuration intact. Users manage API keys, account switching, logout, enterprise endpoints, and custom launch commands outside Code60.

The sections below cover individual providers:

- [Claude](#claude)
- [Codex](#codex)
- [Kiro](#kiro)
- [OpenCode](#opencode)
- [Droid](#droid)
- [Cursor](#cursor)

### Does Code60 work with local models?

Yes, through any agent that supports local models. Code60 does not run local language models directly and connects to coding-agent harnesses through ACP.

- **Through a harness:** A user can run local models when an ACP harness, such as **OpenCode**, points to a local model server. Code60's **Model** picker shows the models that active harness reports.
- **External setup:** Code60's in-app setup flows cover official cloud sign-ins only. Configuring a harness to call a local model server happens outside Code60 in that harness's own configuration.
- **Transmission Workflows:** **Transmission Workflows** run only on their Codex runtime and do not support alternate or local model providers.
- **Local embeddings:** Separately from coding agents, Code60 runs its own embedding model offline on the CPU without a graphics card or external service.

---

## Claude

### How does Code60 authenticate with Claude?

Code60 connects to Claude through ACP. It never asks for a password and never stores credentials.

- **Existing CLI:** If a Claude CLI with an active login already exists on the machine, verify and connect it under **Connect → Providers**.
- **In-app setup:** From **Connect → Providers**, install a private copy of Claude and its ACP adapter (`@agentclientprotocol/claude-agent-acp`) without overwriting existing tools. Choose **Claude subscription** or **Anthropic Console** sign-in, then complete login on `claude.ai`, `platform.claude.com`, or `console.anthropic.com`. Paste the authorization code from the browser into the setup dialog.
- **Storage and limits:** Claude keeps credentials in its own backend-user storage. Users manage API keys, account switching, logout, and custom launch commands outside Code60.

## Codex

### How does Code60 authenticate with Codex?

Code60 connects to Codex through ACP. It never asks for a ChatGPT password and never stores credentials.

- **Existing CLI:** If Codex already exists on the machine with an active login, select **Codex** under **Connect → Providers** to verify and connect it.
- **In-app installation:** Choose **Install Codex and sign in** or **Sign in to Codex**. Installation puts `@openai/codex@0.171.0` in `~/.local/share/code60/providers/codex/0.171.0` without replacing an existing CLI.
- **Device-code sign-in:** Copy the device code on screen, open `https://auth.openai.com/codex/device`, and authorize with a ChatGPT account. ChatGPT security settings must allow device-code login. Keep setup open until ACP verification finishes and shows "Connected."
- **Transmission Workflows:** Workflows use a separate Codex runtime that ships with Code60. Run `code60 workflows login` in an interactive terminal to authenticate workflows separately.
- **Storage and limits:** Codex keeps credentials in its normal backend-user storage. Users manage API keys, account switching, logout, and custom launch commands outside Code60.

## Kiro

### How does Code60 authenticate with Kiro?

Code60 connects to Kiro through ACP (`kiro-cli acp`). It never asks for a password and never stores credentials.

- **Existing CLI:** If `kiro-cli` already exists on the machine with an active login, verify and connect it under **Connect → Providers**.
- **In-app setup:** Install a private copy of Kiro from **Connect → Providers** and start its browser device-code flow on `app.kiro.dev` or `view.awsapps.com`. Copy the code on screen, authorize in a browser, and wait for ACP verification to finish.
- **Storage and limits:** Kiro keeps credentials in its own backend-user storage. Organization policies may block device-code sign-in. Custom enterprise settings and custom launch commands require external setup.

## OpenCode

### How does Code60 authenticate with OpenCode?

Code60 connects to OpenCode through ACP (`opencode acp`). It never asks for passwords and never stores credentials.

- **Existing CLI:** If OpenCode already exists on the machine with model-provider credentials, verify and connect it under **Connect → Providers**. Code60 uses those credentials directly.
- **In-app setup:** Install a private copy of OpenCode from **Connect → Providers**. Sign in to **ChatGPT** (`auth.openai.com/codex/device`) or **GitHub Copilot** (`github.com/login/device`) through browser device-code OAuth, an open authorization protocol.
- **Temporary login server:** During sign-in, Code60 runs a temporary local loopback OpenCode server with a password and with external plugins off. Code60 stops that server when login finishes or stops.
- **Storage and limits:** OpenCode keeps credentials in its own backend-user storage. API keys, other model integrations, and custom launch commands require external setup.

## Droid

### How does Code60 authenticate with Droid?

Code60 connects to Droid through ACP (`droid exec --output-format acp`). It never asks for a password and never stores credentials.

- **Existing CLI:** If Droid already exists on the machine with an active login, verify and connect it under **Connect → Providers**.
- **In-app setup:** Install a private copy of Droid from **Connect → Providers** and complete Factory's browser device-pairing flow on `app.factory.ai`. Code60 runs an authentication-only handshake that grants no file, terminal, or tool permissions. It shows the verification link, plus a code when Factory sends one, then runs a fresh ACP check after pairing finishes.
- **Storage and limits:** Droid keeps credentials in its own backend-user storage. Custom launch commands and account management outside initial sign-in require external setup.

## Cursor

### How does Code60 authenticate with Cursor?

Cursor is currently absent from Code60's standard provider catalog. That catalog covers **Antigravity, Claude, Codex, Copilot, Droid, Kiro, and OpenCode**.

Code60 offers no in-app installation or sign-in flow for custom or external ACP launch commands. Users must authenticate those tools outside Code60 through each tool's own CLI.
