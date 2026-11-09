# Code60

Code60 is an Electron desktop app and headless CLI for running coding agents
in parallel. In a Git repository with a commit, each run gets its own worktree
so you can review its changes independently. Outside one, agents work directly
in the selected directory.

## Security and privacy

**Worktrees isolate changes, not permissions. Code60 does not sandbox agents.**
Agents run with your operating-system permissions, and may access files or
execute commands beyond their worktree.

- **Desktop safeguards:** the interface runs in Electron's Chromium sandbox,
  with context isolation and no Node.js integration. Desktop requests are
  validated in the main process. The local MCP gateway uses authentication
  and scoped worker controls.
- **Agent permissions:** orchestration chats and their workers automatically
  approve supported once-only permission requests. Choosing an Ask mode in
  the provider's harness does not disable Code60 auto-approval. CLI and manual
  desktop runs use a separate permission policy.
- **Local history, external providers:** Code60 stores run records locally,
  with restrictive permissions for newly created record files. Configured
  agents may send prompts, code, and context to their providers. Local storage
  does not mean offline execution.
- **Sensitive records:** transcripts include prompts, raw agent updates, and
  potentially sensitive tool inputs and outputs. Diagnostic errors and stderr
  receive best-effort credential redaction, but transcripts are not scrubbed
  or automatically expired. Review logs and screenshots before sharing them.
- **Repository scanning:** CI runs CodeQL, a dependency audit, and Gitleaks
  secret scanning. Passing scans are not a guarantee that code is safe.

Read the [security policy](SECURITY.md) for safeguards, data locations, network
behavior, and limitations. Report suspected vulnerabilities privately to
[support@code60.dev](mailto:support@code60.dev), not through public issues.

## Getting started

For source development, use Node.js 22.12 or later and npm:

```sh
npm ci
npm run dev
```

Install and authenticate your chosen agent through its own CLI. See
[contributing](CONTRIBUTING.md#setup-and-checks) for development and validation,
[architecture](ARCHITECTURE.md#cli) for CLI usage and configuration, and
[Windows setup](WINDOWS.md) for Windows-specific requirements.

## More information

- [Architecture and behavior](ARCHITECTURE.md)
- [MCP server configuration](MCP.md), including the opt-in [Playwright and Context7 starter](mcp.default.json)
- [Contributing](CONTRIBUTING.md)
- [Release process](RELEASING.md)
- [Security policy](SECURITY.md)
- [Apache License 2.0](LICENSE)
