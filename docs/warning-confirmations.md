# Important-action confirmation inventory

Audited for issue #269. Warnings run in main, before the effect, using native
window-owned dialogs. They name the action, target and material consequences.
Cancel is the first/default/cancel choice; the other button is Confirm or the
specific action (Quit, Stop all, Clear logs, Open project, Install and restart).
Escape and window dismissal cancel. Native sheets provide keyboard containment,
accessible dialog text/choices and return to the owning window. Renderer dialogs
continue using the existing modal pattern.

The shared `Confirmations` helper rejects overlapping warnings rather than
queuing stale intent or sharing approval. Reload, renderer loss, window replacement
and shutdown invalidate pending answers. Clear logs and Stop all retain the guard
through their underlying operation; controller-owned writes retain their existing
serialized queues, revision checks and owner checks. Errors release the guard,
propagate to existing error displays and never retry automatically.

## Inventory and decisions

| Action | Existing protection and decision | Gap resolved / rationale |
| --- | --- | --- |
| Latest-request Undo (project or Relay, including direct folders) | Keep native warning naming request and affected folders; draft replacement and direct-folder manual-edit warning | Shared parent, Cancel and lifetime guard; existing checkpoint checks remain authoritative |
| Discard worker worktree/branch | Keep native warning with exact worktree, branch and changed-file list | Irreversible file loss; keep stopped-worker and leftover-process checks |
| Stop all desktop work | Keep warning before cancellation | Explicitly names all projects and Relay, paused updates, kept evidence and independent background automations; guard spans cleanup |
| Stop folder | Keep native warning with folder and inclusion of Relay workers | Other folders continue; existing owner capture remains |
| Close project | Keep native warning naming folder and project-owned work | Relay workers remain running; close is distinct from folder stop |
| Stop/cancel an individual worker or chat turn | Keep direct explicit Stop/Cancel | Immediate interruption control; evidence kept; no extra prompt delaying cancellation |
| Quit with work or background service | Keep native warning explaining desktop cancellation and continuing background work | Consistent Cancel and parent/lifetime guard; no warning when nothing is running |
| Install update/restart | Keep native warning explaining stopped agents and retained worktrees/settings/databases | Consistent Cancel and parent/lifetime guard; existing update/shutdown guards remain |
| Replace connected database with open projects/chats | Keep native warning before disposal | Now names old and new database; Relay independence stated |
| Clear all project history | Keep native warning with count and database path | Removes saved navigation records, not folders/runs |
| Remove one project from history | Keep explicit Remove without another prompt | Reversible by opening folder again; does not close project or delete files/runs |
| Delete saved run configuration | Keep native warning with saved name | Sessions unaffected; serialized database write |
| Delete reusable command | Keep native warning with command name and irreversibility | Serialized database write; preserve editor on decline |
| Reset edited prompt template | Keep native warning with template/database and fallback source | Affects future uses; preserve draft on decline |
| Forget individual memory | Keep native warning and revision-checked deletion | Now quotes the displayed memory and states irreversibility, suppression and retained transcripts/live context |
| Forget memory scope | Keep native warning | Now identifies project (or projectless conversations), non-global scope and consequences |
| Promote memory globally | Keep native warning quoting memory and wider sharing | Revision checked; no changes to authority |
| Shorten memory retention | Keep native preview/count warning and validated retention token | Names age, existing deletions and future expiration; pinned memories/transcripts kept |
| Memory Off, edit/pin/resolve; reindex | Keep immediate setting or explicit Save/Repair | Off preserves records; edits are deliberate and revision checked; reindex rebuilds derived data |
| Clear RAG index | Keep native warning | Now names connected database; originals retained; existing epoch and index-generation checks |
| Clear diagnostics | Keep native warning naming all retained local diagnostics | Shared guard spans actual clear; conversations, records and databases retained |
| Delete automation | Keep native warning | Now reads and names saved automation/repository, lost schedule/prompt, kept evidence; rejects stale revision before warning and service rechecks revision at mutation |
| Install/repair/start/stop/uninstall automation service | Keep native warning naming control and service consequences | Shared parent/Cancel/lifetime guard; existing human service consent retained |
| Create/update/enable/run automation; pause/cancel/resume | Keep explicit editor/controls and existing service consent | No new arbitrary approval policy; schedule revision/service checks remain authoritative; pause/cancel stays immediate |
| Open project from native folder picker or closed Search result | Keep full-path confirmation before opening/history write | Shared window-owned warning, Cancel default and database epoch recheck; never initializes Git |
| Open web link | Keep existing normalized-destination native confirmation | Shared window/lifetime guard, readable target, Cancel default, serialized opening; no arbitrary shell access |
| Guided Git initialize/initial commit | Keep existing explicit setup preview and commit control | Separate human action with file selection and author/message; no automatic Git initialization or commit |
| Accept plan, permission response, harness mode, batch permission options | Keep existing explicit controls and provider permission rules | This audit grants no new execution/approval authority; revision/delegation authority remains outside this rollout |
| Archive chat or Custom Assistant | Keep reversible archive/restore controls | Hides navigation without deleting saved history; no destructive warning needed |
| Disconnect/set primary provider, clear saved model defaults | Keep explicit human-only management controls and active-work gates | Does not sign out, uninstall CLIs or erase history; can reconnect/reselect; no additional approval policy |
| Browser mode switch and agent website actions | Keep explicit mode preference and existing harness/extension approvals | Switching loses isolated browser state as documented; website effects are external and Undo cannot reverse them; this inventory does not grant browser permission |
| Change orchestration auto-approval | Keep existing explicit composer setting and permission behavior | Preserve current live approval rules and pending reviews; no new policy or silent approval |
| Change provider or database/project selection, save ordinary edits/settings, download update | Keep existing active-work gates, explicit Save or immediate preferences | Do not add routine confirmations; download does not install; target/lifecycle validation remains |

## Validation

`src/desktop/confirmations.test.ts` covers native ownership/options, cancellation,
dismissal, stale answers, duplicate in-flight operations and error recovery.
`src/desktop/automations.test.ts` covers target/revision-bound deletion, cancellation,
view replacement and service conflict. Existing desktop/controller, memory,
worktree and Undo tests retain their independent storage/process assertions.
The golden-path and reopening workflows assert the updated native dialog contract.
The Logs journey exercises cancel/reload/confirm with diagnostic-file and database
oracles. Native focus trapping and screen-reader announcement need native platform
validation; a stubbed native boundary cannot establish those operating-system
outcomes. Execution results and any blocked journeys are recorded under
`test-results/qa/issue-269/report.md` during development and summarized in the PR.
