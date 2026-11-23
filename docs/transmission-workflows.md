# Transmission workflow prototype

Open **Apps → Workflows** to create and monitor ordered coding tasks. The page
and retained history work without a project database. Execution currently requires
macOS, external Node.js >=24.22.0 <25 with npm/npx, and a working Codex login.
The first explicit start downloads/caches exactly
`code60-transmission-server@0.1.0-staging.20` for new workflows from npm. No login service is installed.

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

Use the menu beside **Workflows** for New workflow, Refresh and Workflow history.
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

Work continues after Code60 quits. Opening history or refreshing never starts
an engine. On disconnection, the player retains the last verified state.
The header menu offers **Reconnect engine** for that workflow and explains that
unfinished approved work may continue. Global Pause polling pauses observations.
Desktop Stop all retains its desktop-owned scope.

If a start is unconfirmed, preserve its worktree and use **Recover same start
request**. This reuses the approved payload and idempotency key. Never create a
replacement merely because a response was lost. Interrupted checkout preparation
requires inspection; the prototype preserves any partial checkout and history.
State is private beneath `$XDG_STATE_HOME/code60/workflows` (default
`~/.local/state/code60/workflows`), separately from project databases and Relay.
History is bounded to 200 workflows and 8 MiB; it is never deleted automatically.

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

The Linux container journeys use a scripted Transmission HTTP engine, a fake
drafting provider, the production desktop bridge and real Git repositories.
They exercise manual and prompt-assisted starts, clarification and refinement,
pause and same-run resume across reload, rejection and acceptance evidence,
steering, permission choices, connection loss, and stop acknowledgment. A second
journey opens an unversioned staging.18 registry and checks that actions reach
its original engine. Independent assertions check the engine run ID, worker
exit, retained worktree files, and unchanged source HEAD and index.

Run the journeys with `npm run test:desktop:container -- --grep 'workflow: Transmission'`.
The runner retains desktop and narrow screenshots in Light and Dark under its
reported artifact directory. Live-provider execution and packaged macOS behavior
require separate validation.
