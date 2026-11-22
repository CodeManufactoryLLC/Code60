# Desktop capability reference

Generated from `src/contracts/knowledge.ts`. Do not edit by hand; run `npm run generate:capabilities`.

Schema version: 1

## Back and Forward

- ID: `navigation-history`
- Status: shipped
- Purpose: Return to visited pages, Settings sections, project and provider homes, and specific chats.
- Access: Title bar → Back / Forward, beside the navigation sidebar toggle
- Prerequisite: none
- Agent access: human-only
- Confirmation: No confirmation; navigation only.
- Limits: Renderer-memory history holds up to 100 destinations and resets on reload or relaunch. Unavailable destinations are skipped. Buttons are disabled without an available destination or while a selection is pending. Restoring a chat preserves drafts and running work; it never sends a request to an agent.
- Pages: none
- Settings sections: none
- Tools: none

## Memory Recall

- ID: `memory-recall`
- Status: shipped
- Purpose: Inspect memories recorded as used by the displayed chat, grouped by dispatched turn.
- Access: Relay, project or worker chat → right sidebar → New tab → Open Memory Recall
- Prerequisite: none
- Agent access: human-only
- Confirmation: Read-only; no retrieval or provider dispatch.
- Limits: Database-independent in Relay and its workers. Reads only recorded IDs while visible; current saved records, not historical snapshots. Unavailable records and malformed recall notes are labelled. Editing and forgetting remain in Memories. Awareness exposes tab metadata only, never memory contents.
- Pages: none
- Settings sections: none
- Tools: none

## Relay

- ID: `relay`
- Status: shipped
- Purpose: Application-wide orchestration across explicit targets.
- Access: Sidebar → Assistants → Relay (also available from Home)
- Prerequisite: provider
- Agent access: existing-tools
- Confirmation: Existing permissions apply.
- Limits: Requires explicit target and direct/worktree mode; selection and history grant no authority.
- Pages: none
- Settings sections: none
- Tools: none

## Assistants

- ID: `assistants`
- Status: shipped
- Purpose: Open Relay or Custom Assistants from two navigation cards on the Assistants page.
- Access: Sidebar → Assistants heading (or command palette → Assistants)
- Prerequisite: none
- Agent access: human-only
- Confirmation: Existing permissions apply.
- Limits: Available without a database. Opening this page does not connect a provider or start work. The heading navigates independently of the disclosure chevron; Relay availability follows the existing application conversation.
- Pages: `assistants`
- Settings sections: none
- Tools: none

## Custom Assistants

- ID: `custom-agents`
- Status: shipped
- Purpose: Create application-wide assistants with special instructions and one persistent Relay-style conversation each.
- Access: Home → Custom Assistants or Sidebar → Assistants → Custom Assistants → New Assistant; assistant card → More actions → Edit or Archive; Archived → card → More actions → Restore
- Prerequisite: none
- Agent access: human-only
- Confirmation: Archiving confirms natively, stops only the assistant and preserves history.
- Limits: Up to 64 assistants, 120-character names and 32,000-character instructions. Shared verified provider required for chat. Independent histories, workspaces, workers and memory scope; no automatic task resumption. Stop the assistant and its workers before editing. Edits refresh provider context on next human Send, preserving history. No management MCP tools.
- Pages: `custom-agents`
- Settings sections: none
- Tools: none

## Projects

- ID: `projects`
- Status: shipped
- Purpose: Retain independent project workspaces and conversations. New Session starts a project-bound chat.
- Access: Projects heading → circular Add Project; project row → + (New Session); Projects page → New Project; project home → New Session; project row → red × (Close Project); project row → chevron (expand/collapse)
- Prerequisite: database
- Agent access: read
- Confirmation: The native folder picker allows directory creation. Confirm the full selected path to open; Cancel leaves the current project and history unchanged. The red × requires the existing Stop folder confirmation; cancelling leaves work running.
- Limits: Opening or selecting a project is a human action; opening never initializes Git. Archiving the last displayed project chat returns to its home without a replacement. New Session explicitly creates a chat. Project chat auto-names are limited to 19 characters. Manual names and existing titles are unchanged. The red × labelled Close Project invokes Stop Folder: it stops project work and Relay workers in that folder, pauses replacement for that task/target and keeps the project open. Other folders continue. Project name selection and new sessions preserve disclosure state; only the project chevron expands or collapses its list.
- Pages: `projects`, `project`, `chat`
- Settings sections: none
- Tools: none

## Workers

- ID: `workers`
- Status: shipped
- Purpose: Delegate and follow up with owned coding agents.
- Access: Chat and existing worker tools
- Prerequisite: capacity
- Agent access: existing-tools
- Confirmation: Existing permissions apply.
- Limits: Project workers require Git isolation; idle workers consume capacity.
- Pages: none
- Settings sections: none
- Tools: `code60_get_context`, `code60_dispatch_agent`, `code60_list_agents`, `code60_read_agent`, `code60_send_agent`, `code60_cancel_agent`, `code60_finish_agent`, `code60_stop_agent`, `code60_resume_agent`

## Browser automation

- ID: `browser`
- Status: shipped
- Purpose: Use Headless, Visible or Existing Browser by stating a preference in chat.
- Access: Relay, Custom Assistant or project chat → ask for browser automation; code60_browser
- Prerequisite: provider
- Agent access: existing-tools
- Confirmation: Existing Browser uses the extension's connection approval; Code60 does not bypass it or provide an extension token.
- Limits: Default Headless. Each live conversation owns its mode and browser connection; no saved setting. status/set-mode never launch processes. list-tools/call lazily run pinned Playwright MCP through Node.js/npm; Chrome must be installed. Existing Browser requires the Playwright Chrome extension and connection approval. Switching modes closes the old connection and loses isolated state; errors never fall back. Calls are serialized, bounded to 100 seconds, and cancellation/Stop/Undo/provider replacement/shutdown close owned processes. External website changes are not undone by message Undo. Browser tools are unavailable to workers, setup probes, helpers and the scheduler. User-configured MCP servers stay independent. Only product-allowed browser tools; no host-code, install, upload or WebMCP tools. Private npm context; 32 MiB temporary automatic artifacts, explicit outputs directly in the owning conversation workspace. Only dispatched turns have browser authority. No native desktop control.
- Pages: none
- Settings sections: none
- Tools: `code60_browser`

## Plans

- ID: `plans`
- Status: shipped
- Purpose: Propose and track revisioned tasks; use View Plan to reopen the current conversation’s latest saved plan.
- Access: Chat → right sidebar → View Plan → existing plan tab
- Prerequisite: runtime
- Agent access: existing-tools
- Confirmation: View Plan reopens the current session's latest existing plan without generating or accepting a new one. Human Accept authorizes only that revision and targets.
- Limits: No agent tool can accept a plan.
- Pages: none
- Settings sections: none
- Tools: `code60_create_plan`, `code60_read_plan`, `code60_update_plan`

## Reviews

- ID: `reviews`
- Status: shipped
- Purpose: Inspect pinned revisions and captured worker changes through quiet change links; add exact saved code references to the existing composer.
- Access: Chat → files changed → read-only diff → select code → Add to chat; Changes → older snapshots
- Prerequisite: runtime
- Agent access: existing-tools
- Confirmation: Existing permissions apply.
- Limits: At most eight removable references per message. Corrections use normal chat. Historical evidence does not restore worker ownership; partial changes do not imply success.
- Pages: none
- Settings sections: none
- Tools: `code60_read_review`, `code60_address_feedback`

## Checkpoints and message Undo

- ID: `apply-undo`
- Status: shipped
- Purpose: Automatically checkpoint requests and integrate isolated worker edits; Undo restores covered files and rewinds conversation context without resending.
- Access: Chat → latest user message → Undo
- Prerequisite: runtime
- Agent access: human-only
- Confirmation: Native confirmation names request and targets, warns about replacing an unsent draft and direct-folder manual edits. Isolated conflicts block rather than overwrite newer edits.
- Limits: Zero-edit requests can rewind. The request and saved-code references return unsent. Direct-folder snapshots also rewind manual edits since their checkpoint; Git metadata and Code60 state are excluded. Direct preimages and current Undo reads allow 32 MiB total regular-file contents, 10,000 entries per folder and 64 directory levels; links are unsupported. Nested children share parent coverage; adding a parent after child execution needs a new request. Checkpoints have bounded 256 MiB storage and 100 prior requests. Interrupted Undo requires explicit recovery, even without a live provider. No automatic commit or reversal of external effects.
- Pages: none
- Settings sections: none
- Tools: none

## Files

- ID: `files`
- Status: shipped
- Purpose: Browse files and bounded read-only previews in tabs owned by the individual chat or worker session.
- Access: Chat → Files panel
- Prerequisite: runtime
- Agent access: read
- Confirmation: Existing permissions apply.
- Limits: Tab sets, order and selection are independent per session, retained during navigation until project close or renderer reload. Inactive panels release file subscriptions. Archived reviews remain read-only in a reachable panel. Awareness can read only authorized open cached previews from the exact active file subscription, not arbitrary paths.
- Pages: `files`
- Settings sections: none
- Tools: none

## Commands

- ID: `commands`
- Status: shipped
- Purpose: Use bundled or saved reusable prompts with a leading $name. Bundled commands: $create-command: Create a reusable $ command from your instructions. $plan: Propose a plan for your request and wait for Code60 acceptance. $business-evaluation: Plan an evidence-based business evaluation, then wait for Code60 acceptance. $catch-me-up: Explain the broader context and anything I may have missed. $big-picture: Step back from the details and reassess the value and approach. $pushback: Challenge your conclusion and re-evaluate the evidence. $simplify: Explain the current topic in simple, plain language.
- Access: Apps → Command Builder; project composer $ command picker
- Prerequisite: database
- Agent access: existing-tools
- Confirmation: Existing permissions apply.
- Limits: Saved names override bundled names; /name is plain text, not a command. Commands expand only in project orchestrator chats, not Relay or worker chats. Conversation commands do not grant new execution authority. Relay has no command creation tool; reading never executes.
- Pages: `commands`
- Settings sections: none
- Tools: `code60_create_command`

## Tactics

- ID: `tactics`
- Status: shipped
- Purpose: Select a bundled workflow for a project request.
- Access: Project chat composer → Tactics
- Prerequisite: database
- Agent access: read
- Confirmation: Existing permissions apply.
- Limits: Selection does not send; role and iteration instructions are not runtime guarantees.
- Pages: none
- Settings sections: none
- Tools: none

## Prompt templates

- ID: `prompts`
- Status: shipped
- Purpose: Customize project orchestration and handoff templates.
- Access: Apps → Prompt Builder
- Prerequisite: database
- Agent access: read
- Confirmation: Existing permissions apply.
- Limits: Database overrides precede config and built-ins; Relay uses its fixed application instructions.
- Pages: `prompts`
- Settings sections: none
- Tools: none

## Saved configurations

- ID: `configurations`
- Status: shipped
- Purpose: Reuse saved run settings.
- Access: Apps → Data Viewer → Configurations
- Prerequisite: database
- Agent access: read
- Confirmation: Existing permissions apply.
- Limits: Saved settings are not live provider health.
- Pages: `configurations`
- Settings sections: none
- Tools: `code60_read_configurations`, `code60_search_configurations`

## Code60 auto-approval

- ID: `orchestration-permissions`
- Status: shipped
- Purpose: Choose whether to review each permission request from Relay, Custom Assistants, project chats and their workers.
- Access: Orchestration chat or worker composer → Code60 auto-approval (beside Harness mode)
- Prerequisite: none
- Agent access: human-only
- Confirmation: When off, choose Allow once or Deny in the requesting conversation. The footer approval count opens a waiting conversation, including archived project chats with a pending request.
- Limits: Defaults on. Changes apply to new ACP requests in live and future sessions. Pending requests still need an answer. Manual runs and scheduled automations have separate policies.
- Pages: none
- Settings sections: none
- Tools: none

## Providers

- ID: `providers`
- Status: shipped
- Purpose: Verify and choose coding-agent providers; inspect and clear saved per-connector orchestrator and worker model defaults.
- Access: Providers → provider details
- Prerequisite: none
- Agent access: read
- Confirmation: Existing permissions apply.
- Limits: Database-independent. Add Provider verifies catalog connectors. Set as Primary preserves other memberships and uses saved command verification; Disconnect removes only Code60 membership and retains model defaults, history and external login. Both actions require stopped desktop agent work and no setup transaction. The primary cannot disconnect until another provider is primary. Verified membership is not live connection health. No automatic installation or management MCP tools.
- Pages: `providers`, `provider`
- Settings sections: none
- Tools: none

## Model and reasoning

- ID: `model-settings`
- Status: shipped
- Purpose: Switch connector-advertised model and reasoning settings between turns and save confirmed role defaults for new sessions.
- Access: Chat or worker composer → Model; Providers → provider details → Default models to clear
- Prerequisite: provider
- Agent access: human-only
- Confirmation: Human selection only; no model-switching MCP tool. Main derives saved values from the owned session.
- Limits: Idle connected sessions only; choices depend on the connector. Busy: Available after this turn; ended: Last reported; timeout: Model unconfirmed. Defaults apply only to new sessions, model first; unavailable values produce notes, never substitutes. Orchestrator covers Relay, project chats and Custom Assistants. Workers do not follow parent changes. No changes to helpers, automation or resumed sessions.
- Pages: none
- Settings sections: none
- Tools: none

## Memory

- ID: `memory`
- Status: shipped
- Purpose: Learn and recall scoped evidence when enabled.
- Access: Settings → Memory; Apps → Data Viewer → Memories
- Prerequisite: none
- Agent access: human-only
- Confirmation: Existing permissions apply.
- Limits: Memory Off disables learning/recall, not session-local continuity. No memory records exposed through awareness.
- Pages: `memories`
- Settings sections: `memory`
- Tools: none

## Context handoff

- ID: `continuity`
- Status: shipped
- Purpose: Maintain bounded session continuity between turns.
- Access: Automatic between-turn desktop lifecycle
- Prerequisite: provider
- Agent access: read
- Confirmation: Existing permissions apply.
- Limits: Never restores permissions or replays dispatched work; independent of Memory On/Off.
- Pages: none
- Settings sections: none
- Tools: none

## Scheduled Jobs

- ID: `automations`
- Status: shipped
- Purpose: Run consented local schedules in an independent service. Each job is an expandable accordion with ordered run/stop, delete and disclosure controls on its closed header. Play starts one run; the pulsing pause glyph retains the Stop action to cancel active work. Disabled schedules show (Paused) beside their name, independently of manual execution. Details show the saved prompt, schedule and execution settings, with separate schedule enable/pause and inline editing. Actions offers New scheduled job in an inline editor and Refresh; Execution history remains a table with live, assembled execution transcripts and saved outcomes. New Notifications opens terminal execution outcomes with explicit individual or displayed-batch acknowledgement.
- Access: Apps → Scheduled Jobs → New Notifications
- Prerequisite: none
- Agent access: human-only
- Confirmation: Human installation and schedule consent.
- Limits: Notification outcomes stay unread until explicitly acknowledged; read state survives service and desktop restarts. Notification reads/saves require the running service and fail visibly. Transcripts subscribe before reading, refresh from saved-chunk notices, retain partial content on errors and show bounded evidence with execution status. Desktop quit/Stop all does not stop service-owned work. Delete requires native confirmation and refuses active jobs; evidence is preserved. Run state is independent of schedule enablement and history paging. Older services without live job state require a service restart for run/stop controls. Reduced motion and forced colors keep the stop glyph static. Awareness never installs or probes the service.
- Pages: `automations`
- Settings sections: none
- Tools: none

## System Manager

- ID: `system-manager`
- Status: shipped
- Purpose: Manage the macOS/Linux Scheduling Service through System Manager. Status checks run automatically every two seconds after a completed read while the page and window are visible. Verified status distinguishes Not installed, Stopped and Running, with Install, Start or Stop as the main action. Stop pauses jobs and cancels active scheduled work before stopping the service; there is no separate pause-and-cancel button. Jobs paused is separate from runtime status; Resume jobs remains available for existing paused jobs, and Repair and Uninstall remain in Service options. No public Code60 CLI is available.
- Access: Apps → System Manager
- Prerequisite: none
- Agent access: human-only
- Confirmation: Human service consent; native confirmation for service controls.
- Limits: Automatic status checks respect global Pause polling and back off to at most sixty seconds on failure; manual Refresh remains available. Awareness never installs, probes or controls the service. Checking or unavailable status never guesses a lifecycle action. A standalone running scheduler is labelled Not installed and has no native Stop action. No database is required.
- Pages: `system-manager`
- Settings sections: none
- Tools: none

## Data Viewer

- ID: `data`
- Status: shipped
- Purpose: Inspect saved application data.
- Access: Apps → Data Viewer
- Prerequisite: database
- Agent access: read
- Confirmation: Existing permissions apply.
- Limits: Existing table tools retain their scopes. Diagnostic logs and memory records are not agent-readable.
- Pages: `tables`, `sessions`, `messages`, `events`, `worktrees`, `polling`
- Settings sections: none
- Tools: `code60_read_sessions`, `code60_search_sessions`, `code60_read_messages`, `code60_search_messages`, `code60_read_events`, `code60_search_events`, `code60_read_worktrees`, `code60_search_worktrees`, `code60_read_polling`, `code60_search_polling`

## Settings

- ID: `settings`
- Status: shipped
- Purpose: Change appearance, text, polling and application options. Text typefaces include locally bundled Scientifica; OCR-A is no longer offered. Table defaults start at Low density (44px rows), with row, column and heading lines off; saved global and per-table choices are retained. Options include left sidebar background opacity (0–100%) and native macOS desktop blur strength (0–100%). Transparent Linux windows retain minimize, maximize/restore and guarded close controls in the title bar, including the splash and first-use setup.
- Access: Sidebar → Settings; Appearance → Left sidebar
- Prerequisite: none
- Agent access: human-only
- Confirmation: Existing permissions apply.
- Limits: Only explicitly allowlisted values are included in awareness. Each sidebar foreground card has a dedicated top-right chevron to expand or collapse its children without changing the current page. Home/Search is also collapsible. Header navigation never toggles expansion; Assistants opens a database-independent page with Relay and Custom Assistants cards. Hidden children are inert; explicit child navigation reveals ancestors. Sidebar background controls are saved locally, apply immediately independently of Transparent background, and keep text/icons sharp. Native desktop blur is macOS-only; strength blends the system-managed blur, not a pixel radius. Lower sidebar opacity to see it. Native blur failures appear beside its Appearance controls; adjust the slider to retry. Linux retains opacity with blur disabled. Forced colors use an opaque background without blur.
- Pages: `apps`, `advanced`, `experiments`, `settings`
- Settings sections: `appearance`, `table-defaults`, `text`, `polling-settings`, `about`
- Tools: none

## Updates

- ID: `updates`
- Status: shipped
- Purpose: Check, download and install macOS arm64 and Linux x64 desktop releases.
- Access: Settings → Updates
- Prerequisite: runtime
- Agent access: human-only
- Confirmation: Human approval before installation and shutdown.
- Limits: Development builds may be unavailable; awareness does not check or download. App updates stop the installed Scheduling Service before replacement. After installation, startup upgrades its registration, verifies the matching app version and restores its prior global pause state. Packaged startup also reconciles an active older service after manual installation; stopped and uninstalled services stay stopped. Automatic recovery requires the native service PID to match the responding scheduler and never replaces a newer or unknown version. Recovery has one exclusive owner. AppImages require executable and parent locations protected from other users. Failed recovery keeps schedules, history and pending restart evidence for System Manager repair.
- Pages: none
- Settings sections: `updates`
- Tools: none

## RAG experiment

- ID: `rag`
- Status: experimental
- Purpose: Manually index database-associated chat history.
- Access: Settings → Advanced → Experiments → RAG
- Prerequisite: database
- Agent access: human-only
- Confirmation: Native confirmation before Clear.
- Limits: Excludes Relay; no automatic indexing or agent retrieval.
- Pages: `rag`
- Settings sections: none
- Tools: none

## Episodic Memory experiment

- ID: `episodic-memory`
- Status: experimental
- Purpose: Inspect experimental episodic extraction.
- Access: Settings → Advanced → Experiments → Episodic Memory
- Prerequisite: database
- Agent access: human-only
- Confirmation: Existing experiment controls.
- Limits: Separate from application Memory.
- Pages: `episodic-memory`
- Settings sections: none
- Tools: none

## Contributor Tools

- ID: `contributor-tools`
- Status: placeholder
- Purpose: Reserved contributor destination.
- Access: Settings → Advanced → Contributor Tools
- Prerequisite: none
- Agent access: human-only
- Confirmation: None.
- Limits: Placeholder, not an implemented tool.
- Pages: `contributor-tools`
- Settings sections: none
- Tools: none

## Search

- ID: `search`
- Status: shipped
- Purpose: Search all projects saved in the connected database, open or closed, with an optional cited overview.
- Access: Sidebar → Search
- Prerequisite: database
- Agent access: human-only
- Confirmation: Opening a closed project source asks the native Open Project confirmation. Archived conversations remain read-only.
- Limits: Search needs no selected project. Includes project identity, saved project sessions/transcripts and bounded documentation/source evidence; excludes other databases, Relay and Custom Assistant histories. Results have project provenance and Load more pages of 100. Submitted results stay stable across project/page selection; new projects enter the next search. Missing/corrupt sources show partial results. Overview helpers use captured evidence, denied permissions and no gateway; failures preserve literal results. Agents cannot request Search.
- Pages: `search`
- Settings sections: none
- Tools: none

## Diagnostic logs

- ID: `logs`
- Status: shipped
- Purpose: Inspect private, typed desktop diagnostics.
- Access: Apps → Data Viewer → Logs
- Prerequisite: none
- Agent access: human-only
- Confirmation: Native confirmation before Clear.
- Limits: Never exposed to agents, MCP or awareness.
- Pages: `logs`
- Settings sections: none
- Tools: none

## Activity display

- ID: `activity`
- Status: shipped
- Purpose: Show the orchestrator's current step beside the transcript and spotlight working conversation and worker names, including custom assistants and Relay.
- Access: Chat transcript activity line and left navigation names
- Prerequisite: runtime
- Agent access: existing-tools
- Confirmation: Existing permissions apply.
- Limits: Presentation only; reports never change work or permissions. Sidebar names follow live connection, work and worker-monitoring states; approval, stopping, idle and saved entries stay static. Hidden views, reduced motion and forced colors disable the spotlight.
- Pages: none
- Settings sections: none
- Tools: `code60_get_activity_context`, `code60_report_activity`

## Self-knowledge

- ID: `knowledge`
- Status: shipped
- Purpose: Discover capabilities, open-state metadata and effective customizations.
- Access: Relay/project chat → read-only Code60 tools
- Prerequisite: none
- Agent access: read
- Confirmation: Existing permissions apply.
- Limits: No new action authority, workers, drafts, transcripts, diagnostic logs or credentials.
- Pages: `home`
- Settings sections: none
- Tools: `code60_get_capabilities`, `code60_get_app_state`, `code60_list_customizations`, `code60_read_customization`, `code60_read_view`
