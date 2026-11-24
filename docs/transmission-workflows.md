# Transmission workflow prototype

Open **Apps → Workflows** to create and monitor ordered coding tasks. The page
and retained history work without a project database. Execution currently requires
macOS Apple Silicon or Linux x64 with glibc, the installation's recorded Node.js >=24.22.0 <25, and
separate Codex workflow authentication. macOS distribution candidates include
exactly `code60-transmission-server@0.1.0-staging.20` for new workflows and
staging.18 for retained records, with their locked dependencies and native runtime.
Starting a workflow needs no npm download or compiler. No Transmission login
service is installed. Code60 provider verification does not establish workflow
authentication; the harness uses Codex's own configured credentials. If authentication is needed, run
`code60 workflows login` in an interactive terminal after setup. It launches only
the bundled Codex login with its recorded Node; Codex manages its own credentials.
It starts no workflow or engine, has a ten-minute deadline and propagates exit
status/interruption. Non-interactive use and extra flags are rejected. Code60
does not store or copy provider credentials or mark application setup verified.
If the command is outside PATH, use `"$HOME/.local/bin/code60" workflows login`.
For a custom existing Codex home, use the same absolute `CODEX_HOME` when running
setup/service repair and workflow login. Service registration preserves that path,
without persisting credential variables or configuration payloads. Existing
engines keep their startup environment; login does not reconfigure them.
New engines and workflow login select the verified bundled Codex binary explicitly;
an application-level `CODEX_PATH` override does not replace the workflow runtime.

Choose **New workflow**, select the repository root and enter a workflow name and
ordered tasks. Each task includes implementation instructions, independent
verification criteria and optional check commands. Repair and fresh-session retry
allowances default to two. Automatic harness permission approvals default on;
change that setting before reviewing if you want decisions shown individually.

**Create with prompt** opens a drafting chat. Describe the desired change and send
follow-ups to refine it. A valid response fills the editable name and task fields;
a clarification leaves the current fields intact. Drafting uses the verified
primary Code60 provider and bounded current form/conversation, root README and
package scripts. It does not launch a Transmission workflow. No MCP servers are
provided; permission requests are denied. Closing/cancelling stops pending drafting.
The chat lasts only as long as its creation form, independently of Relay history.

Select **Review workflow**, inspect the complete definition and choose **Start
workflow**. Editing invalidates that review. Code60 captures current saved staged,
unstaged and eligible untracked files in an isolated worktree, preserving source
files, HEAD and staging. Existing snapshot exclusions remain in effect. A worktree
is not a sandbox. Transmission's Codex harness owns execution permissions.

Choose **Workflow sign-in** for the terminal authentication step. Open **Definitions** to create a workflow or edit a copy of a saved definition. Open **Execution history** and select a run to inspect progress, evidence or recovery actions. **Refresh** requests current engine state.
The player shows accepted tasks, execution time and newest activity. Consecutive tool updates are collapsed by default. Use **Expand tool calls** in the activity card to inspect each update. Expand a
numbered task for **View Configuration** and available verifier **View Results**.
Reports include the verifier's verdict and check evidence. Expand **Workflow details**
for checkout paths and approvals. **Accepted diff** contains changes through the
last accepted revision. Activity retains up to 1,000 events within one million
characters. Execution time is reconstructed from Transmission events and excludes
confirmed paused intervals and waits for input. Incomplete timing shows Unavailable.

**Pause workflow** stops the current sessions while preserving work. **Resume workflow**
continues the same run with fresh sessions for the unfinished task. **Stop workflow**
requires confirmation, waits for cleanup and permanently ends the run. Worktree
files remain in place. **Steer** queues guidance for a subsequent turn. Answer a
pending question using its offered choices. A lost response leaves the outcome
unconfirmed. If stop acknowledgement is pending, use Stop workflow again to confirm cleanup for the same run.

Work continues after closing the browser or stopping the Code60 Gateway. Opening history or refreshing never starts
an engine. On disconnection, the player retains the last verified state.
The header menu offers **Reconnect engine** for that workflow and explains that
unfinished approved work may continue. Global Pause polling pauses observations.
Stop all retains its interactive application scope.

If a start is unconfirmed, preserve its worktree and use **Recover same start
request**. This reuses the approved payload and idempotency key. Never create a
replacement merely because a response was lost. Interrupted checkout preparation
requires inspection; the prototype preserves any partial checkout and history.
State is private beneath `$XDG_STATE_HOME/code60/workflows` (default
`~/.local/state/code60/workflows`), separately from project databases and Relay.
History is bounded to 200 workflows and 8 MiB; it is never deleted automatically.

Executable bundles are preserved separately under
`$XDG_DATA_HOME/code60/engines` (default `~/.local/share/code60/engines`). Their
private version bindings record the bundle inventory and canonical Node. Do not
remove this storage, the original versioned state directories or legacy npm
caches while retaining workflows. A damaged binding or moved Node is an explicit
recovery condition; execution never falls back to a different Node on PATH.

For source development on a supported target, run `npm run prepare:engines` after
`npm run build`. Preparation uses a fresh dependency tree and the committed
`distribution/transmission/package-lock.json`; ordinary build/dev does not fetch
engine assets. Another full build clears generated assets. Linux builds bundle Transmission 0.1.1 for new workflows. History stays bound to the engine version recorded at approval.

There is no automatic apply, merge, commit, push, message Undo integration
or alternate execution provider. Retained worktrees can be reviewed
with normal Git tools. Source repositories and execution worktrees must not be
replaced or redirected while a workflow owns them.

## Known server limitation

Existing records without an engine version belong to staging.18. They retain their
original engine, run ID and state directory. Pause and resume require staging.20.
Transmission staging.18 can launch fresh worker sessions across engine restarts
without consuming its documented retry allowance. This integration neither fixes
nor hides that behavior. Automatic recovery does not establish exactly-once effects.
Do not interpret a quiet/disconnected UI as evidence that execution stopped.

## Prototype validation

The headless browser journeys use a scripted Transmission HTTP engine, a fake
drafting provider, the production browser gateway and bridge and real Git repositories.
They exercise manual and prompt-assisted starts, clarification and refinement,
pause and same-run resume across reload, rejection and acceptance evidence,
steering, permission choices, connection loss, and stop acknowledgment. A second
journey opens an unversioned staging.18 registry and checks that actions reach
its original engine. Independent assertions check the engine run ID, worker
exit, retained worktree files, and unchanged source HEAD and index.

Run the journeys with `npm run test:browser -- --grep 'workflow: Transmission' --output=test-results/workflow-browser`.
The runner retains wide and narrow screenshots in Light and Dark under its
reported artifact directory. Live-provider execution and packaged macOS behavior
require separate validation.
