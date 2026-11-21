# Desktop capability reference

Generated from `src/contracts/knowledge.ts`. Do not edit by hand; run `npm run generate:capabilities`.

Schema version: 1

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
- Access: Sidebar → Relay
- Prerequisite: provider
- Agent access: existing-tools
- Confirmation: Existing permissions apply.
- Limits: Requires explicit target and direct/worktree mode; selection and history grant no authority.
- Pages: none
- Settings sections: none
- Tools: none

## Projects

- ID: `projects`
- Status: shipped
- Purpose: Retain independent project workspaces and conversations.
- Access: Projects → New Project; project home → New Session; sidebar add controls remain available
- Prerequisite: database
- Agent access: read
- Confirmation: The native folder picker allows directory creation. Confirm the full selected path to open; Cancel leaves the current project and history unchanged.
- Limits: Opening or selecting a project is a human action; opening never initializes Git. Closing the last project chat returns to its home without a replacement. New Session explicitly creates a chat.
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

## Plans

- ID: `plans`
- Status: shipped
- Purpose: Propose and track revisioned tasks.
- Access: Chat → plan tab
- Prerequisite: provider
- Agent access: existing-tools
- Confirmation: Human Accept authorizes only that revision and targets.
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
- Purpose: Browse files and bounded read-only previews.
- Access: Chat → Files panel
- Prerequisite: runtime
- Agent access: read
- Confirmation: Existing permissions apply.
- Limits: Awareness can read only authorized open cached previews, not arbitrary paths.
- Pages: `files`
- Settings sections: none
- Tools: none

## Commands

- ID: `commands`
- Status: shipped
- Purpose: Use bundled or saved reusable prompts with a leading $name.
- Access: Apps → Command Builder; project composer $ command picker
- Prerequisite: database
- Agent access: existing-tools
- Confirmation: Existing permissions apply.
- Limits: Saved names override bundled names; /name is plain text, not a command. Relay has no command creation tool; reading never executes.
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

## Agents

- ID: `providers`
- Status: shipped
- Purpose: Verify and choose coding-agent providers.
- Access: Settings → Agents
- Prerequisite: none
- Agent access: read
- Confirmation: Existing permissions apply.
- Limits: Configured does not mean detected, verified, or connected. No automatic installation.
- Pages: none
- Settings sections: `agents`
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

## Automations

- ID: `automations`
- Status: shipped
- Purpose: Run consented local schedules in an independent service.
- Access: Apps → Automation Studio
- Prerequisite: none
- Agent access: human-only
- Confirmation: Human installation and schedule consent.
- Limits: Desktop quit/Stop all does not stop service-owned work. Awareness never installs or probes the service.
- Pages: `automations`
- Settings sections: none
- Tools: none

## System Manager

- ID: `system-manager`
- Status: shipped
- Purpose: Install, repair, start, stop or uninstall the background automation service.
- Access: Apps → System Manager
- Prerequisite: none
- Agent access: human-only
- Confirmation: Human service consent; native confirmation for service controls.
- Limits: Awareness never installs, probes or controls the service.
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
- Purpose: Change appearance, text, polling and application options.
- Access: Sidebar → Settings
- Prerequisite: none
- Agent access: human-only
- Confirmation: Existing permissions apply.
- Limits: Only explicitly allowlisted values are included in awareness.
- Pages: `apps`, `advanced`, `experiments`, `settings`
- Settings sections: `appearance`, `table-defaults`, `text`, `polling-settings`, `about`
- Tools: none

## Updates

- ID: `updates`
- Status: shipped
- Purpose: Check, download and install platform releases.
- Access: Settings → Updates
- Prerequisite: runtime
- Agent access: human-only
- Confirmation: Human approval before installation and shutdown.
- Limits: Development builds may be unavailable; awareness does not check or download.
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
- Purpose: Search saved project evidence, with an optional cited overview.
- Access: Sidebar → Search
- Prerequisite: database
- Agent access: human-only
- Confirmation: Existing permissions apply.
- Limits: Overview helpers run with denied permissions and no gateway; agents cannot request them.
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
- Purpose: Show the orchestrator's current step beside the transcript.
- Access: Chat transcript activity line
- Prerequisite: runtime
- Agent access: existing-tools
- Confirmation: Existing permissions apply.
- Limits: Presentation only; reports never change work or permissions.
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
- Limits: No new action authority, workers, CLI, drafts, transcripts, diagnostic logs or credentials.
- Pages: `home`
- Settings sections: none
- Tools: `code60_get_capabilities`, `code60_get_app_state`, `code60_list_customizations`, `code60_read_customization`, `code60_read_view`
