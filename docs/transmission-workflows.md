# Transmission workflow prototype

Open **Apps → Workflows** to create and monitor ordered coding tasks. The page
and retained history work without a project database. Execution currently requires
macOS, external Node.js >=24.22.0 <25 with npm/npx, and a working Codex login.
The first explicit start downloads/caches exactly
`code60-transmission-server@0.1.0-staging.18` from npm. No login service is installed.

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

The status view distinguishes implementation, independent verification, repairs,
questions and accepted tasks. Progress counts accepted tasks, not elapsed time.
Select a task for its criteria and accepted verifier evidence; expand activity,
repair feedback and accepted diff for additional evidence. Activity excerpts are
labelled when incomplete; the display retains at most 1,000 events within one
million characters. Reselect the workflow to page from the beginning again. Check results are
verifier-reported evidence, not a guarantee of correctness. The accepted diff is
cumulative from the initial saved-files baseline; it omits unfinished edits.

Guidance is queued for a subsequent turn. Answer a pending question using its
current offered choices. Cancellation waits for acknowledgement and preserves
accepted work, partial edits and the worktree. A lost cancellation response leaves
the outcome unconfirmed; refresh before deciding what to do next.

Work continues while Code60 is quit. Reopen Workflows and select its retained run
to reconnect to the same engine. Opening pages and refreshing history never start
the engine. **Start engine / reconnect** explicitly starts it if unavailable and
can resume unfinished approved work. No automatic login/reboot startup is installed.
Global Pause polling pauses observations only; desktop Stop all does not cancel
Transmission work. Use **Cancel workflow** for that purpose.

If a start is unconfirmed, preserve its worktree and use **Recover same start
request**. This reuses the approved payload and idempotency key. Never create a
replacement merely because a response was lost. Interrupted checkout preparation
requires inspection; the prototype preserves any partial checkout and history.
State is private beneath `$XDG_STATE_HOME/code60/workflows` (default
`~/.local/state/code60/workflows`), separately from project databases and Relay.
History is bounded to 200 workflows and 8 MiB; it is never deleted automatically.

There is no automatic apply, merge, commit, push, message Undo integration,
pause/resume or alternate execution provider. Retained worktrees can be reviewed
with normal Git tools. Source repositories and execution worktrees must not be
replaced or redirected while a workflow owns them.

## Known server limitation

Transmission staging.18 can launch fresh worker sessions across engine restarts
without consuming its documented retry allowance. This integration neither fixes
nor hides that behavior. Automatic recovery does not establish exactly-once effects.
Do not interpret a quiet/disconnected UI as evidence that execution stopped.
