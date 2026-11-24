# Desktop capability reference

Generated from `src/contracts/knowledge.ts`. Do not edit by hand; run `npm run generate:capabilities`.

Schema version: 1

## MCP Servers

- ID: `mcp-servers`
- Status: shipped
- Purpose: Manage MCP server definitions with guided forms or validated JSON; preview/restore backups and reset selected configurations; enable, approve, test, reconnect and disconnect managed connections; manage secure credentials and reviewed OAuth sign-in; review interrupted transactions, verify owned cleanup and copy a safe troubleshooting report.
- Access: Apps → MCP Servers
- Prerequisite: none
- Agent access: human-only
- Confirmation: Review forms before immediate saves; Save, Discard or Cancel dirty JSON before guided edits or scope changes. Confirm removal, moves, draft discard, backup restoration and reset after scope/inheritance review. Review exact project configuration before approval; confirm stdio tests and reviewed Disconnect/Reconnect effects. Explicitly choose persistent or temporary storage; review issuer, scopes, resource and registration before sign-in; confirm forgetting credentials or sign-out. Review captured revisions and effects before confirming Complete/Roll back; confirm owned cleanup verification. Review the safe report before copying.
- Limits: User configuration is database-independent. Project configuration requires an open project and captured runtime/database identity. Project definitions shadow user IDs, including disabled/unapproved entries. New definitions are disabled. Authentication and observed connection health are separate from configured enablement and project approval. Untested servers say Not tested. Credential references are resolved only in the backend after explicit entry. No credentials or approvals move. Playwright/Context7 templates are opt-in. Invalid files block guided saves; bounded safe malformed files can be repaired in JSON or reset with private preimages. Pending recovery blocks affected writes. JSON drafts stay in renderer memory across navigation; reload/close can lose them. Save preserves exact valid text; formatting is explicit. Restore requires a reviewed valid unpinned backup and fresh revisions; absent-file backups remove the dedicated file. Reset clears this configuration, or User and this project, preserving other project files, credentials, built-ins and running work. Clearing a project may reveal User definitions; clearing User affects other projects. Enablement and approval changes affect future connections. Existing connections retain their captured revisions until explicit Disconnect or idle Reconnect. Reconnect replaces all connectors in the owning ACP session and requires provider load/resume support; otherwise start a new session. Tests initialize/discover only, require project approval, and confirm stdio command launch. Unavailable connectors warn while other tools remain usable. Credentials use macOS Keychain or Linux Secret Service through a bounded helper. Locked/unavailable storage never falls back silently. Explicit temporary storage lasts until backend restart or sign-out. Security-relevant definition changes require new credential review; label/enablement changes do not. OAuth requires issuer/scope/registration review, S256 and a page/revision-bound single-use callback. Supply client information or use advertised per-installation registration; no shared Code60 client or hosted authentication is provided. Sign-out revokes affected connections immediately; uncertain removal remains visible. Tool calls are never replayed after authentication failure; uncertain refresh requires reauthorization. Configuration recovery reviews every affected live scope and exact recorded state before Complete/Roll back. Closed/replaced projects, newer edits or corrupt evidence block recovery; no force or lock deletion. Drafts are retained. Verify cleanup retries only retained revoked resources, without reconnecting. Troubleshooting reports are opt-in counts/fixed codes only, with no definitions, identifiers, paths, endpoints, references or secrets. Definitions and references are excluded from awareness and agent tools.
- Pages: `mcp-servers`
- Settings sections: none
- Tools: none

## Page navigation

- ID: `page-navigation`
- Status: shipped
- Purpose: Open pages through the sidebar, Carbon destination lists or Back and Forward.
- Access: Left navigation sidebar or Home / Apps / Settings lists; workspace header → Back / Forward
- Prerequisite: none
- Agent access: human-only
- Confirmation: No confirmation; navigation only.
- Limits: Work, Automation, Inspect and Manage are expandable navigation groups. Opening a destination reveals its group. Skip to main content moves keyboard focus past the navigation to the current page. Projects and conversations keep their own actions. Commands and Workspace are in the header. Returning browsers restore a validated view scoped to the active database, with Relay as the fallback. Restoring a view never sends a request or grants approval.
- Pages: none
- Settings sections: none
- Tools: none

## Back and Forward

- ID: `navigation-history`
- Status: shipped
- Purpose: Return to visited pages, Settings sections, project and provider homes, and specific chats.
- Access: Workspace header → Back / Forward
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
- Access: Relay, project or worker chat → right sidebar → Files view dropdown → Memory Recall
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
- Purpose: Open Relay or Custom Assistants from two destination rows on the Assistants page.
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
- Access: Home → Custom Assistants or Sidebar → Assistants → Custom Assistants → New Assistant; assistant row → More actions → Edit or Archive; title actions → Archived → row → More actions → Restore
- Prerequisite: none
- Agent access: human-only
- Confirmation: Archiving requires browser confirmation, stops only the assistant and preserves history.
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
- Confirmation: The authenticated host folder chooser allows directory creation within locally configured roots. Click to select a folder, double-click or press Enter to browse, then choose the folder. Confirm the full selected path to open. Back, Forward and Up navigate the chooser; Cancel leaves the current project and history unchanged. The red × requires the existing Stop folder confirmation; cancelling leaves work running.
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
- Purpose: Propose and track revisioned tasks with rounded completion percentages and cumulative running time; use View Plan in a blank Files tab to reopen the current conversation’s latest saved plan.
- Access: Chat → right sidebar → + New Tab → View Plan → existing plan tab
- Prerequisite: runtime
- Agent access: existing-tools
- Confirmation: View Plan appears beside Open Files and Open Memory Recall on blank/empty tabs only. It reopens the current session's latest existing plan without generating or accepting one. Human Accept authorizes only that revision and targets. Execution time counts running intervals only; Resume adds to the saved total. Restart keeps recorded time without restoring authority or counting downtime; older executed plans may lack historical timing.
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
- Confirmation: Browser confirmation names request and targets, warns about replacing an unsent draft and direct-folder manual edits. Isolated conflicts block rather than overwrite newer edits.
- Limits: Zero-edit requests can rewind. The request and saved-code references return unsent. Direct-folder snapshots also rewind manual edits since their checkpoint; Git metadata and Code60 state are excluded. Direct preimages and current Undo reads allow 32 MiB total regular-file contents, 10,000 entries per folder and 64 directory levels; links are unsupported. Nested children share parent coverage; adding a parent after child execution needs a new request. Checkpoints have bounded 256 MiB storage and 100 prior requests. Interrupted Undo requires explicit recovery, even without a live provider. No automatic commit or reversal of external effects.
- Pages: none
- Settings sections: none
- Tools: none

## Files

- ID: `files`
- Status: shipped
- Purpose: Browse files and bounded read-only previews in tabs owned by the individual chat or worker session. Select a tree row with one click. Double-click or press Enter to open a file or toggle a folder; the chevron also toggles it. The Files view dropdown selects among open views; File Explorer, Changes and Memory Recall remain available alongside its + New Tab item. File/document views have Close current tab below the header.
- Access: Chat → upper-right corner of main content card → Toggle files panel
- Prerequisite: runtime
- Agent access: read
- Confirmation: Existing permissions apply.
- Limits: Tab sets, order and selection are independent per session, retained during navigation until project close or renderer reload. Inactive panels release file subscriptions. Archived reviews remain read-only in a reachable panel. The Files view dropdown has no search field. Arrow keys/Home/End and first-letter navigation highlight choices; Enter/Space commits. Delete closes the selected view and Alt+Left/Right reorders it while the closed selector is focused. Tabs cannot be dragged. Closing the final tab leaves the panel open with the selector enabled for the main pages and + New Tab. Close appears only on file/document views, at the upper right below the header. Main-page choices do not load content until selected. Awareness can read only authorized open cached previews from the exact active file subscription, not arbitrary paths.
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
- Access: Apps → Prompt Builder → title actions for Save, Discard changes or Reset to default
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
- Confirmation: When off, choose Allow once or Deny in the requesting conversation. The Workspace approval count opens a waiting conversation, including archived project chats with a pending request.
- Limits: Defaults on. Changes apply to new ACP requests in live and future sessions. Pending requests still need an answer. Manual runs and scheduled automations have separate policies.
- Pages: none
- Settings sections: none
- Tools: none

## Web Server Beta

- ID: `web-server`
- Status: shipped
- Purpose: Enable paired access to Code60 from another device on the same trusted LAN.
- Access: Settings → Advanced → Web Server Beta
- Prerequisite: none
- Agent access: human-only
- Confirmation: Turning the switch on explicitly enables trusted-LAN access. Pair each remote browser using six digits displayed as 123-456 (the hyphen is optional when entering it); take control explicitly. Server administration is localhost-only. Before provider setup, close the setup dialog and choose Web Server Beta on the start screen.
- Limits: Off by default; remembers the enabled preference. Uses the current primary private IPv4 address and existing application port. Only the controlling localhost browser can toggle access or create single-use 60-second pairing codes; LAN always requires pairing, with ten attempts per minute. Paired devices use the full app with explicit single-browser control takeover. Disabling, address changes and backend restart revoke LAN sessions; approved work continues. HTTP is not encrypted. Native execution and the dev-container start launcher are supported; ordinary containers without the host controller report unavailable. LAN serves bundled assets without Vite/HMR or source maps. No custom ports, TLS, public hosting, router/firewall changes, passwords or separate service. Codes are private responses, never snapshots, diagnostics or saved storage.
- Pages: `web-server`
- Settings sections: none
- Tools: none

## Providers

- ID: `providers`
- Status: shipped
- Purpose: Verify and choose coding-agent providers; inspect and clear saved per-connector orchestrator and worker model defaults.
- Access: Providers → provider details → title actions for Disconnect or Set as Primary
- Prerequisite: none
- Agent access: read
- Confirmation: Installation and login are explicit human-only setup actions. Install [provider] and sign in authorizes the fixed release installation and continuation into browser login; authorization happens on the official provider website.
- Limits: Database-independent. Add Provider verifies catalog connectors. Standard Codex setup offers explicit installation of pinned @openai/codex@0.171.0 and device-code sign-in; A non-root backend user is required; Codex and the Claude ACP adapter require npm. The controlling setup dialog alone receives temporary codes and official HTTPS sign-in links; authorization-code paste-back and the fixed Copilot private-file storage confirmation are ephemeral. Login requires enabled ChatGPT device-code authentication, then a fresh ACP probe and automatic save. Closing, reload, takeover or shutdown cancels setup without logout. Other standard harnesses offer fixed pinned installations and browser sign-in: Antigravity with code paste-back, Claude subscription or Anthropic Console with code paste-back, Copilot and Kiro device codes, Droid device pairing, and OpenCode ChatGPT or GitHub Copilot OAuth. Custom launch commands and enterprise endpoints use manual setup. Credentials and managed tools persist in the backend user's home, including the container home volume. No account switching, logout, API-key entry or management MCP tools. Set as Primary preserves other memberships and uses saved command verification; Disconnect removes only Code60 membership and retains model defaults, history and external login. Both actions require stopped interactive agent work and no setup transaction. The primary cannot disconnect until another provider is primary. Verified membership is not live connection health.
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
- Access: Apps → Memory; Apps → Data Viewer → Memories
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
- Access: Automatic between-turn application lifecycle
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
- Purpose: Scheduled Jobs opens on Schedules in a Carbon product shell. Scan job name, schedule status, next run, live run status and agent. Run/Stop applies to one job and works independently of Enabled/Paused. Expand for the saved prompt, cadence, repository, branch, timeout and allowed tools. The row actions menu offers Edit job, Enable/Pause schedule, View history and Delete. New scheduled job and Refresh are in the schedules toolbar. Create and edit use a dedicated form. The Execution history tab supports current-page search, sorting, single execution selection and Older/Latest paging. View history opens an explicit schedule filter. Show all schedules clears it. Select a run to open Transcript or Changes beside its row, including live, assembled execution transcripts. Legacy saved grid preferences stay stored.
- Access: Automation → Scheduled Jobs (also Apps → Scheduled Jobs)
- Prerequisite: none
- Agent access: human-only
- Confirmation: Human installation and schedule consent.
- Limits: Transcripts subscribe before reading, refresh from saved-chunk notices, retain partial content on errors and show bounded evidence with execution status. Closing the browser and interactive Stop all leave scheduled work running. Stopping the backend stops both. Delete requires browser confirmation and refuses active jobs; evidence is preserved. Run state is independent of schedule enablement and history paging. Older services without live job state require a service restart for run/stop controls. Run/Stop controls use text labels; Carbon content follows Light/Dark/System while retaining its own productive typography and standard controls. Awareness never installs or probes the service.
- Pages: `automations`
- Settings sections: none
- Tools: none

## Workflows

- ID: `workflows`
- Status: shipped
- Purpose: Inspect saved definitions or edit a copy for fresh review. Open Workflow sign-in for the host terminal authentication step. Use Execution history to open the player for one run. Create ordered coding workflows manually or through Create with prompt, review and explicitly start them in dedicated saved-file worktrees. Track independent verification, repairs, decisions and accepted diffs.
- Access: Automation → Workflows (also Apps → Workflows)
- Prerequisite: runtime
- Agent access: human-only
- Confirmation: Existing permissions apply.
- Limits: The player shows run activity with tool calls collapsed until expanded, recorded execution time, accepted-task progress and ordered task configuration/results. Pause and resume are available for new Transmission 0.1.0-staging.20 workflows. Existing staging.18 records use their original engine. Stop is terminal. Execution runs on macOS Apple Silicon with recorded Node >=24.22 <25 and bundled staging.18/staging.20 engines, locked dependencies and native Codex. Engine launch uses bundled dependencies without downloading or compiling them. Workflow Codex login/configuration is separate from Code60 provider verification; code60 workflows login explicitly opens the bundled Codex login in an interactive terminal without starting an engine. Immutable engine bindings remain outside application releases. Workflow execution selects the verified cached native Codex, independently of application CODEX_PATH overrides. Automatic permission approvals default on. Work continues after closing the browser or stopping the Code60 backend; the backend stop confirmation explains this. No login service is installed. Prompt drafting uses the verified primary provider, bounded root README/package scripts and no tools; generated fields never start work. Source files, HEAD and index stay unchanged; worktrees/evidence remain. No automatic apply or Undo integration. Read-only views never restart the engine. The staging.18 restart path can exceed retry allowances. One active or uncertain workflow per source checkout; at most 100 ordered tasks with 30 checks each, repair/retry allowances 0–30 (default two), and 200 retained workflows within 8 MiB. Activity is paginated with labelled excerpts above 32,768 characters per detail and a display window of 1,000 events within one million characters. Drafting is bounded to 20 messages, 120 seconds, and 160,000 characters each for composed context and output.
- Pages: `workflows`
- Settings sections: none
- Tools: none

## System Manager

- ID: `system-manager`
- Status: shipped
- Purpose: Inspect Backend Service scheduling health automatically every two seconds. Jobs paused is separate from backend lifetime.
- Access: Apps → System Manager
- Prerequisite: none
- Agent access: human-only
- Confirmation: Human CLI consent is required for service changes; scheduled jobs retain their own explicit controls.
- Limits: Automatic checks respect global Pause polling and back off to at most sixty seconds on failure. Manual Refresh Backend Service is available. Install, repair, start, stop and uninstall use local code60 service commands. No database is required; awareness never probes or controls the service.
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
- Limits: Carbon tables retain saved filters, column filters and backend paging scopes. Search filters the loaded rows; retained-log searches submit to the backend. Sortable headers, single-row selection and loaded-row pagination use Carbon controls. Retained logs use backend cursor paging without a second loaded-row pager. Table settings preview density, lines, visible columns and charts; named Earlier/Later and width controls replace canvas dragging. New configuration/session actions are visible toolbar buttons. Diagnostic logs and memory records are not agent-readable.
- Pages: `tables`, `sessions`, `messages`, `events`, `worktrees`, `polling`
- Settings sections: none
- Tools: `code60_read_sessions`, `code60_search_sessions`, `code60_read_messages`, `code60_search_messages`, `code60_read_events`, `code60_search_events`, `code60_read_worktrees`, `code60_search_worktrees`, `code60_read_polling`, `code60_search_polling`

## Settings

- ID: `settings`
- Status: shipped
- Purpose: Choose Light, Dark or System, interface text size, focus highlights, signal colors and table defaults. Table defaults start at Low density (Carbon 64px rows), with row, column and heading lines off. Saved table settings retain their column order, visibility and density. Browser-native window management is outside Code60.
- Access: Manage → Settings → Text or Table defaults, Apps → Appearance or Polling, Workspace → Color theme
- Prerequisite: none
- Agent access: human-only
- Confirmation: Existing permissions apply.
- Limits: Navigation groups expand or collapse independently. Project and conversation disclosures retain their own state. System follows the operating system. Legacy decorative preferences remain stored.
- Pages: `apps`, `advanced`, `experiments`, `settings`
- Settings sections: `appearance`, `table-defaults`, `text`, `polling-settings`, `about`
- Tools: none

## Update Manager

- ID: `updates`
- Status: shipped
- Purpose: Inspect the installed version and terminal update/recovery commands.
- Access: Apps → Update Manager
- Prerequisite: none
- Agent access: human-only
- Confirmation: Local terminal consent is required before interrupting interactive/scheduled work; non-TTY changes require Code60's --yes. Prior releases, histories, custom databases, worktrees, settings and pinned engine/runtime bindings are preserved. The browser shows installed version and terminal instructions only.
- Limits: Managed installations require Node >=24.22.0 <25 on macOS arm64 or Linux x64. code60 update resolves the stable npm bootstrap, verifies registry integrity and exact platform payloads before shutdown, then activates atomically and repairs service registration. code60 update status is read-only; code60 update recover explicitly repairs the current activation after interruption without database downgrade or replay. Setup never updates. No automatic downloads or checks from browser awareness, native installers or bundled Node.
- Pages: none
- Settings sections: `updates`
- Tools: none

## Browser access and backend

- ID: `browser-runtime`
- Status: shipped
- Purpose: Connect a browser to the local Code60 backend and manage its lifetime.
- Access: Terminal → code60 setup, status or open; Workspace → Stop Code60 Backend
- Prerequisite: none
- Agent access: human-only
- Confirmation: Take control explicitly replaces another browser's control; stale page confirmations are rejected. Stopping the backend confirms cancellation of all interactive and scheduled work. Restart never replays uncertain tasks.
- Limits: macOS Apple Silicon and Linux x64 setup requires Node >=24.22.0 <25, npm and Git; Linux needs a working user systemd session for service enrollment. The private distribution candidate supports code60 setup [--yes] [--no-open] and read-only code60 status. Setup installs a durable launcher, separately requests shell-profile approval and default-no service consent, creates the first default database under XDG_DATA_HOME/code60/databases/default.sqlite (default ~/.local/share), preserves valid custom selections and opens the browser for provider verification. No provider authority or agent work is seeded. Without a TTY, service changes require Code60’s trailing --yes; no profiles are edited. Declined service consent returns files-only success with explicit incomplete status and a continuation command. --no-open skips the opener; opener failure retains a usable URL. Repeated setup reuses healthy files and selections without implicit updates. Status never repairs or starts services/engines. Packages remain unpublished until release preparation. The opt-in per-user backend starts at login. Browsers connect without a code by default, with per-tab sessions and one controlling browser. Local code60 pairing on/off/status makes the code requirement optional; setting changes require consent and revoke browser sessions without cancelling approved work. When enabled, the code is single-use and expires after sixty seconds. Closing or refreshing a browser preserves approved work. Workspace chooser roots default to the user's home and require local configuration to expand. No Electron, public hosting or general agent execution CLI.
- Pages: none
- Settings sections: none
- Tools: none

## RAG experiment

- ID: `rag`
- Status: experimental
- Purpose: Manually index database-associated chat history.
- Access: Settings → Advanced → Experiments → RAG
- Prerequisite: database
- Agent access: human-only
- Confirmation: Browser confirmation before Clear.
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
- Limits: Select a result to read its record alongside the query and results. Open source navigates to the original evidence. Search needs no selected project. Includes project identity, saved project sessions/transcripts and bounded documentation/source evidence; excludes other databases, Relay and Custom Assistant histories. Results have project provenance and Load more pages of 100. Submitted results stay stable across project/page selection; new projects enter the next search. Missing/corrupt sources show partial results. Overview helpers use captured evidence, denied permissions and no gateway; failures preserve literal results. Agents cannot request Search.
- Pages: `search`
- Settings sections: none
- Tools: none

## Diagnostic logs

- ID: `logs`
- Status: shipped
- Purpose: Inspect private, typed desktop diagnostics.
- Access: Apps → Data Viewer → Logs; title actions → Pause/Resume viewing, Refresh logs or Clear logs
- Prerequisite: none
- Agent access: human-only
- Confirmation: Browser confirmation before Clear.
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
