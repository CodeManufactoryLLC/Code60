# Workflows

Open **Develop → Workflows** (also **Apps → Workflows**) to create and monitor ordered coding tasks. For high-level definitions and how workflows compare with interactive chat Plans, see [Workflow](../TERMINOLOGY.md#workflow), [Gateway](../TERMINOLOGY.md#gateway), and the [Plans and Workflows FAQ](../FAQ.md#plans-and-workflows). The page and retained history work without a project database.

Workflow execution runs directly inside Code60 Gateway using your verified Code60 ACP providers (`Connect → Providers`), local SQLite state (`$XDG_STATE_HOME/code60/workflows/engine/workflows.sqlite`), and private Git temporary-index snapshots. No external workflow daemon, bundled runtime, or separate workflow login command is required.

Choose **New workflow**, select the repository root and a verified **Provider** (defaulting to the primary verified provider), and enter a workflow name and ordered tasks. Each task includes implementation instructions, independent verification criteria and optional check commands. Repair and fresh-session retry allowances default to two. Automatic harness permission approvals default on; change that setting before reviewing if you want decisions shown individually.

**Create with prompt** opens a drafting chat. Describe the desired change and send follow-ups to refine it. A valid response fills the editable name and task fields; a clarification leaves the current fields intact. Drafting uses the verified primary Code60 provider and bounded current form/conversation, root README and package scripts. It does not launch a workflow. No MCP servers are provided; permission requests are denied. Closing or cancelling stops pending drafting. The chat lasts only as long as its creation form, independently of Relay history.

Select **Review workflow**, inspect the complete definition and chosen provider, and choose **Start workflow**. Editing invalidates that review. Code60 captures current saved staged, unstaged and eligible untracked files in an isolated worktree, preserving source files, HEAD and staging. Existing snapshot exclusions remain in effect. A worktree is not a sandbox; the selected provider harness owns any sandbox rules it applies.

Open **Definitions** to create a workflow or edit a copy of a saved definition. Open **Execution history** and select a run to inspect progress, evidence or recovery actions. **Refresh** requests current workflow state.
The player shows accepted tasks, execution time and newest activity. Consecutive tool updates are collapsed by default. Use **Expand tool calls** in the activity card to inspect each update. Expand a numbered task for **View Configuration** and available verifier **View Results**. Reports include the verifier's verdict and check evidence. Expand **Workflow details** for provider, checkout paths and approvals. **Accepted diff** contains changes through the last accepted revision. Activity retains up to 1,000 events within one million characters. Execution time is reconstructed from persisted workflow events and excludes confirmed paused intervals and waits for input. Incomplete timing shows Unavailable.

**Pause workflow** stops the current sessions while preserving work. **Resume workflow** continues the same run with fresh sessions for the unfinished task. **Stop workflow** requires confirmation, waits for cleanup and permanently ends the run. Worktree files remain in place. **Steer** queues guidance for a subsequent turn. Answer a pending question using its offered choices. A lost response leaves the outcome unconfirmed. If stop acknowledgement is pending, use **Stop workflow** again to confirm cleanup for the same run.

Work continues after closing the browser while the Code60 backend stays running. Stopping the Code60 backend pauses or ends active workflows. Opening history or refreshing never starts or resumes execution. Global Pause polling pauses observations. Stop all retains its interactive application scope.

If a start is unconfirmed, preserve its worktree and use **Recover same start request**. This reuses the approved payload and idempotency key. Never create a replacement merely because a response was lost. Interrupted checkout preparation requires inspection; Code60 preserves any partial checkout and history. State is private beneath `$XDG_STATE_HOME/code60/workflows` (default `~/.local/state/code60/workflows`), separately from project databases and Relay. History is bounded to 200 workflows and 8 MiB; it is never deleted automatically.

There is no automatic apply, merge, commit, push, or message Undo integration. Retained worktrees can be reviewed with normal Git tools. Source repositories and execution worktrees must not be replaced or redirected while a workflow owns them.

## Validation

The headless browser journeys exercise the native in-process workflow engine with a fake ACP provider, the production browser gateway and bridge, and real Git repositories. They exercise manual and prompt-assisted starts, provider selection, clarification and refinement, pause and same-run resume across reload, rejection and acceptance evidence, steering, permission choices, and stop acknowledgment. Independent assertions check the persisted run state, retained worktree files, and unchanged source HEAD and index.

Run the journeys with `npm run test:browser -- --grep 'workflow:' --output=test-results/workflow-browser`.
