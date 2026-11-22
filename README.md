# Code60

Code60 is an Electron desktop application for running coding agents in parallel on macOS and Linux. Desktop Scheduled Jobs uses an independent background scheduler.

Desktop project chats and Relay checkpoint requests and automatically integrate
isolated worker changes, without Apply. A quiet **files changed** link opens a
read-only diff; **Changes** keeps older snapshots. Select code and **Add to chat**
to attach its exact saved version and lines without replacing or sending a draft.
Request corrections in ordinary chat. Plan and permission approvals stay explicit.

**Undo**, beside the latest user message, confirms the request and targets, stops
owned work, restores covered files and rewinds conversation context. It returns
the original request to the composer without resending. Conflicting newer edits
block isolated restoration; staging and HEAD stay untouched. Direct-folder Undo
also rewinds manual edits made since its snapshot, with an explicit warning.
Undo does not reverse deployments, database changes or other external effects.

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
Direct changes are not isolated. Before execution, bounded private snapshots
cover regular files, including additions, deletions and renames on restoration.
Direct snapshots exclude Git and Code60 state; links and unsupported coverage
block editable launch. They allow 32 MiB total preimage contents per request,
10,000 entries per folder and 64 directory levels. Relay never silently
switches modes or redirects a refused launch to another folder.
Nested direct targets share existing parent coverage. Adding a parent after its
child has started requires a new request. Current direct contents must also fit
the combined 32 MiB limit for Undo.

Relay captures and integrates isolated changes after worker turns settle; partial
work and failures remain explicit. Files → **Open Changes** is a secondary
target-grouped history browser. Request checkpoints retain at most 100 prior
requests and 256 MiB of recorded rollback data; interrupted Undo requires explicit
recovery. Saved, unapplied reviews remain read-only historical evidence after
restart, never work to integrate automatically. Human **Accept** authorizes the displayed plan
revision and target assignments, not later target changes.
The right sidebar's **View Plan** button reopens the current session's latest
existing plan after its tab is closed, without generating a new plan.

Project accordions retain independent chats, drafts and file views. Project chats
remain database-backed and bound to their project. Reopening Code60 restores the
open projects and saved chats for the connected database, starting on Relay.
Chat titles, archive state and history survive; unsent drafts do not. Restored
project chats stay stopped until you explicitly send or continue. **Close project**
removes a project from the next restore; quitting the app preserves the open set.
Unavailable folders produce a warning without deleting their saved chats.
Navigation and database changes do not retarget Relay. Closing a project stops
its own work, not Relay workers in
that folder. **Stop workers in folder** includes those Relay workers; **Stop all**
stops every owner. Database-wide legacy chat files are not loaded or migrated;
existing files remain untouched.

See [implementation and validation notes](docs/relay-implementation.md) for limits
and platform-validation status.

## Models

In any connected chat, use the **Model** picker between turns to choose the
connector's advertised model and reasoning settings. **Save as default** applies
to new sessions for that connector and role, orchestrator (Relay, project chats
and Custom Assistants) or worker. Clear saved choices in **Providers → provider details →
Default models**. Existing sessions and automation defaults do not change.
Unavailable defaults produce a note; Code60 never substitutes a model.

## Memory

**Settings → Memory** has one application-wide On/Off switch. On learns useful
information from Relay, project chats and workers, and recalls relevant saved
memories. Off stops learning and recall without deleting saved memories or
ordinary transcripts; turning it back on does not backfill the intervening chats.
Previously supplied information can remain in an active provider session.

**Manage memories** opens Apps → Data Viewer → Memories to inspect evidence, edit,
pin, delete or explicitly share a memory across projects. Retention can delete
unpinned memories after 30 days, 90 days or one year; the default is Never.
Shortening retention requires confirmation.

In Relay, project chats and worker chats, open the right sidebar and choose
**New tab → Open Memory Recall** (also available in an empty sidebar). The
closable, reorderable tab shows recorded recalls by turn, newest first, and
marks the latest dispatched turn, including when it recalled nothing.
Older recorded turns are paged without rerunning retrieval. Relay and its workers
need no database. Retrieval never opens or focuses the tab automatically.
Records show their current saved text, conditions and expandable evidence quotes,
not historical snapshots. Changed records and unavailable memories are labelled.
Editing and forgetting stay in Memories.

Storage, embeddings and search are local. Learning sends conversation excerpts
to the configured provider and may incur usage; there is no daily learning limit.
Automatic handoff can still summarize a long conversation while Memory is Off,
without creating long-term memories. See [memory behavior and validation](docs/memory-validation.md).

## Scheduled automations

Open **Apps → Scheduled Jobs** to save one agent, prompt, isolated Git repository
and explicit tool permissions on an interval, daily or weekly schedule.
Each job has an expandable details card. Use its **play** button to run once;
while it runs, the button shows a pulsating **pause** icon; its **Stop** action cancels
that run. The ordered circular controls are play/stop, delete and expand/collapse.
Disabled schedules show **(Paused)** beside their name.
Both run/stop and **×** (delete) remain available when details are closed.
Deletion requires confirmation and active work must stop first; run evidence stays.
Expand a job to inspect its prompt and settings, enable/pause its schedule, or edit
it inline. **Actions → New scheduled job** opens an inline editor; **Actions → Refresh**
reloads the saved jobs and history. Execution history stays
below the job list. Reduced motion keeps the stop icon static.

Open **Apps → System Manager** to install and manage the Scheduling Service,
with native confirmation, to keep scheduling after Code60 quits.
The computer must stay awake and the user logged in. Missed occurrences are skipped,
not replayed, and an agent finishing a turn is not proof the task succeeded.

Manage schedules in Scheduled Jobs and service installation/recovery in Apps → System Manager.
For source development, build with `npm run build` and run
`node dist/automation/main.js` in a separate terminal before saving automations.
That standalone process is not installed for future logins.

App updates cancel active automation work and stop the installed service before
replacing the app. On the first launch after installation, Code60 upgrades the
service registration, verifies that the running scheduler matches the installed
app version, and restores its previous global pause state. Packaged startup also
reconciles an active older service after a manual app installation. A service
that was stopped or uninstalled stays stopped. Stop a standalone
development scheduler before installing an app update. If restart fails, Code60
shows a recovery message; repair the service from Apps → System Manager.
Schedules, evidence and worktrees are preserved.

## Browser automation

For browser tasks, tell Relay, a Custom Assistant or a project chat to use
**Headless**, **Visible**, or **Existing Browser**. Headless is the default;
Visible opens a separate window and Existing Browser uses the Playwright
Chrome extension with its connection approval. Install Chrome and Node.js/npm;
the pinned Playwright MCP package starts on demand. Preferences last for that live
conversation, and switching modes loses isolated browser state. Website changes
are not reversed by message Undo. See [browser modes](MCP.md#browser-modes-in-chat).

## Security and privacy

**Worktrees isolate changes, not permissions. Code60 does not sandbox agents.**
Agents run with your operating-system permissions, and may access files or
execute commands beyond their worktree.

- **Desktop safeguards:** the interface runs in Electron's Chromium sandbox,
  with context isolation and no Node.js integration. Desktop requests are
  validated in the main process. The local MCP gateway uses authentication
  and scoped worker controls.
- **Agent permissions:** orchestration chats and their workers approve once-only
  permission requests automatically by default. Turn off **Code60 auto-approval** beside **Harness mode** in the
  chat or worker composer to choose **Allow once** or **Deny** in
  the requesting chat or worker. This takes effect on the next request, including
  in live sessions. Manual desktop runs and scheduled automations use their own permission policies.
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
npm run prepare:models
npm run dev
```

Install and authenticate your chosen agent through its own CLI. See
[contributing](CONTRIBUTING.md#setup-and-checks) for development and validation,
[architecture](ARCHITECTURE.md#files) for configuration.

## Agent memory and long conversations

**Settings → Memory** controls automatic memory for Relay, project chats and
workers. Memory and automatic continuity are on by default. Completed exchanges
produce cited Episodic, Semantic, Lesson and History records through your verified
orchestration provider, which can incur normal provider usage. Embeddings and
search run locally using the bundled Jina model.

Project knowledge stays with its durable project identity. Relay's ambiguous
knowledge stays private to Relay; its workers use their explicitly assigned
targets. Only a confirmed **Promote to global** shares a memory across projects.
The Memories browser shows attribution, exact evidence, conflicts, revisions and
last use, and supports edits, pinning and forgetting.

Before context reaches its automatic threshold (70%), Code60 prepares
a checkpoint and continues between turns in a fresh agent session. The logical
conversation and transcript stay intact. An oversized request or unavailable
required checkpoint pauses the send, never silently truncates or replays it.
Context capacity falls back to an internal 128,000-token estimate when the
provider does not report one.

One application-wide Memory switch controls capture, generation and recall.
Automatic conversation continuity remains available with Memory Off. Forgetting
suppresses future recall and recreation from the same source ranges, but does not
erase original transcripts or context already sent to a provider. See
[memory behavior and validation](docs/memory-validation.md).

## RAG experiment

Open **Settings → Advanced → Experiments → RAG** and select **Index conversations**.
This creates a local snapshot of orchestration chats and worker conversations
across the connected database, including archived chats and registered projects.
This includes project-bound and legacy chats, even when their project is closed.
The application-owned Relay conversation is independent of the database and is
not indexed.
Type a message and press **Enter** or **Retrieve** to see the ten closest chunks.
Similarity scores are not confidence percentages.

The bundled Jina Embeddings v2 Base Code INT8 model runs offline on CPU. Nothing
is sent to a provider. **Rebuild index** includes newer messages; it never runs
automatically. **Clear index** asks for confirmation and preserves original chats.
The index is private derived data beside the database under `.code60_workspace/rag`.
Missing projects, unreadable histories and size limits fail a rebuild while
preserving the previous snapshot. Repository indexing and generated answers are
not part of this experiment.

See [offline validation and measured resource use](docs/rag-validation.md).

## Chat formatting

Agent replies in both chat views render Markdown, including code blocks, lists and
tables. Copy keeps the original Markdown source. Web links ask for confirmation
before opening your browser; HTML and images are not loaded.

## Reusable commands

Open **Command Builder** (under Apps) after connecting a database to save a reusable prompt. In a
project orchestrator chat, type `$` at the start of your message. Use Up/Down to choose
and Enter or Tab to insert the command, then add optional instructions and send.
Escape closes the list. Unknown commands and slash-prefixed text such as `/tmp` are sent as
plain text. Commands are shared across projects in the same database; worker
chats and Relay do not expand them.

Use the built-in `$create-command` to have the orchestrator create one for you:

```text
$create-command Make a command called review that checks changes for bugs and missing tests.
```

It asks for clarification when needed and saves the new command without running it.

Two more built-ins guide work through Code60's plan review:

- `$plan <request>` asks the orchestrator to create a plan, then wait for **Accept**.
- `$business-evaluation <idea>` proposes an evaluation plan before doing research,
  analysis or delegation. After **Accept**, its prompt guides an evidence-based
  evaluation with five deliverables: decision brief, feasibility analysis, market
  and economics model, risks and assumptions, and a validation plan. Proposed
  experiments do not authorize outreach, spending or business operations.

Four built-ins help steer the conversation; each also accepts optional instructions:

- `$catch-me-up` explains the broader context, relevant background and things you may have missed.
- `$big-picture` steps back from a rabbit hole to reassess the goal, value and approach before continuing.
- `$pushback` challenges the agent's conclusion and asks it to recheck evidence and correct errors.
- `$simplify` explains the current topic in simple, plain language.

Built-ins appear in the dollar-command picker and do not use a saved-command slot. A saved
command with the same name takes precedence.

## More information

- [Architecture and behavior](ARCHITECTURE.md)
- [MCP server configuration](MCP.md), including the opt-in [Playwright and Context7 starter](mcp.default.json)
- [Contributing](CONTRIBUTING.md)
- [Release process](RELEASING.md)
- [Security policy](SECURITY.md)
- [Apache License 2.0](LICENSE)

### Custom Assistants

Open **Custom Assistants** from Home or under Assistants in the sidebar and choose
**New Assistant**. Set a name and special instructions, then open its persistent chat.
Each agent uses the shared
verified provider and Relay's plans, workers, Files, Changes and message Undo.
No database is required. Stop the agent and its workers before editing its
instructions. Editing keeps history and uses fresh provider context on the next
Send. **Archive** stops only that agent and preserves its data; use **Archived**
then **Restore** to bring it back. Restart and Restore never resume work.

## Removed interfaces

The public Code60 CLI and Windows support have been removed. There is no replacement
terminal command or compatibility shim. Existing configuration, databases, run records,
histories and worktrees are preserved. Provider CLIs remain desktop prerequisites.
This is a breaking removal for the next release; release preparation sets the version.

### Providers

Open **Providers** after Projects in the sidebar to manage verified coding-agent
providers without a database. **+ Add Provider** uses the existing connection
wizard; provider cards and sidebar entries open the same details and saved model
defaults. Their More menus offer **Disconnect** and **Set as Primary**.

The checked circle marks the primary provider. Set another provider as primary
before disconnecting it. Primary changes preserve other memberships. Both menu
actions require stopped desktop agent work and no setup transaction. Disconnect
removes Code60 membership only; histories, model defaults and external logins remain.
Verified membership does not indicate a live connection.
