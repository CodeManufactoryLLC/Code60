# Code60

Code60 is an Electron desktop app and headless CLI for running coding agents
in parallel. The CLI uses isolated worktrees in Git repositories with a commit
and runs directly in the current directory otherwise. Desktop project workers
require Git isolation; Relay workers explicitly choose isolated or direct work.

In desktop Chat, open **Review changes** to inspect a task revision. **Use these changes…**
opens a preview before applying the worker's result to your project. **Ask workers to revise**
sends application conflicts back through Chat. **Undo application** restores the previous
contents if the applied files still match. Applying and undoing preserve Git staging.

## Relay and projects

**Relay** is one persistent, application-wide conversation. It works without a
database or open project and connects idle after agent setup. Restart restores
history, not tasks or workers, and sends no prompt until you press Send. The first
Send includes at most 64,000 Unicode characters of labelled history, once.
Older messages stay on disk; bounded paging and exact-source Copy do not send prompts.
Relay state lives under `$XDG_STATE_HOME/code60/relay` (by default
`~/.local/state/code60/relay`), separately from project databases.

Give Relay each intended target directory explicitly. It can dispatch to unopened
Git repositories and, in **direct** mode, non-Git folders the harness permits.
Direct changes are not isolated or automatically reversible. Relay never silently
switches modes or redirects a refused launch to another folder.

Open Relay's Files panel and choose **Open Changes** to review isolated results
grouped by target. Capture a revision, inspect its diff, send feedback or preview
checkout-local application. Apply and undo require confirmation and recheck newer
edits. Saved reviews remain historical evidence after restart, without reconnecting
workers or replaying feedback. Human **Accept** authorizes the displayed plan
revision and target assignments, not later target changes.

Project accordions retain independent chats, drafts and file views. Project chats
remain database-backed and bound to their project. Navigation and database changes
do not retarget Relay. Closing a project stops its own work, not Relay workers in
that folder. **Stop workers in folder** includes those Relay workers; **Stop all**
stops every owner. Database-wide legacy chat files are not loaded or migrated;
existing files remain untouched.

See [implementation and validation notes](docs/relay-implementation.md) for limits
and platform-validation status.

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

## Chat formatting

Agent replies in both chat views render Markdown, including code blocks, lists and
tables. Copy keeps the original Markdown source. Web links ask for confirmation
before opening your browser; HTML and images are not loaded.

## Reusable commands

Open **Commands** after connecting a database to save a reusable prompt. In a
project orchestrator chat, type `/` at the start of your message. Use Up/Down to choose
and Enter or Tab to insert the command, then add optional instructions and send.
Escape closes the list. Unknown commands and paths such as `/tmp` are sent as
plain text. Commands are shared across projects in the same database; worker
chats and Relay do not expand them.

Use the built-in `/create-command` to have the orchestrator create one for you:

```text
/create-command Make a command called review that checks changes for bugs and missing tests.
```

It asks for clarification when needed and saves the new command without running it.

Two more built-ins guide work through Code60's plan review:

- `/plan <request>` asks the orchestrator to create a plan, then wait for **Accept**.
- `/business-evaluation <idea>` proposes an evaluation plan before doing research,
  analysis or delegation. After **Accept**, its prompt guides an evidence-based
  evaluation with five deliverables: decision brief, feasibility analysis, market
  and economics model, risks and assumptions, and a validation plan. Proposed
  experiments do not authorize outreach, spending or business operations.

Built-ins appear in the slash picker and do not use a saved-command slot. A saved
command with the same name takes precedence.

## More information

- [Architecture and behavior](ARCHITECTURE.md)
- [MCP server configuration](MCP.md), including the opt-in [Playwright and Context7 starter](mcp.default.json)
- [Contributing](CONTRIBUTING.md)
- [Release process](RELEASING.md)
- [Security policy](SECURITY.md)
- [Apache License 2.0](LICENSE)
