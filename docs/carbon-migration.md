# Code60 product interface

The full-app worktree integrates the approved Scheduled Jobs design at `656b0ae` with upstream `341bd8e`. The reference worktree can still run independently. The renderer uses `@carbon/react` 1.121.0, standard blue, locally bundled Plex Sans and White/G100. The product header and navigation belong to the application. Scheduled Jobs owns its task tabs, forms and evidence.

## Route inventory and interaction decisions

| Workspace | Destinations and deep links | Operator task |
| --- | --- | --- |
| Work | Home, Assistants, Chat, Custom Assistants, Projects, Project, Search | Home offers task entry points. Project and provider lists keep their primary action by the list. Open projects expose their conversations in navigation. A conversation retains its composer and transcript while Files, plans, worker activity, changes and evidence occupy its contextual panel. Files resolves into that panel. |
| Automation | Scheduled Jobs, Workflows | Read next run and running state from Schedules. Expand for details or explicitly open scoped history. Workflows separates saved definitions from execution history. Edit a copy reuses a definition and requires a fresh reviewed submission. Playback, evidence and reconnect act on one run. |
| Inspect | Data Viewer, Sessions, Configurations, Memories, Messages, Events, Logs, Worktrees, Polling | Open a record alongside the relevant table or in a bounded detail dialog. Search operates on its submitted query. The independent server cursors and retained log stream own older entries. Table density, sorting, column visibility and order remain available where supported. |
| Manage | Providers, Provider, Apps, System Manager, Settings, Advanced, Experiments, Episodic Memory, RAG, Web Server Beta, Contributor Tools, Prompt Builder, Command Builder | Apps indexes tasks. Provider setup exposes install, login, verify, retry and cancellation. System Manager keeps recovery beside the affected service. Builders put editing and save actions with the working fields. |
| Settings sections | About, Appearance, Memory, Polling, Table defaults, Text, Update Manager | Workspace and Appearance provide system, dark and light themes. Text controls interface sizing. The renderer preserves stored decorative preferences when displaying Carbon defaults. Destination glyphs come from Carbon. Extracted memory statements are text rows. |
| Startup and ownership | Pairing, takeover, backend reconnect, provider prerequisites, database selection, explicit workspace setup and verified return | Required actions appear in the affected state. Resume stores a validated route identity for each database and a separate browser-local identity for work without a database. A missing identity opens Relay. |

The sidebar groups are entry points. Nested destinations keep their existing IDs, command palette targets, database gates and keyboard contracts. The shared header supplies global commands, history, connection state and Workspace. Navigating between destinations retains inactive components wherever drafts, scroll position or independent subscriptions require that lifetime.

## Dialog and chooser inventory

| Owner | Surfaces |
| --- | --- |
| Application and gateway | Command palette, Workspace and theme, provider setup, Git setup, update notice, required pairing, takeover, connection loss, stop-backend confirmation, backend-owned approvals and confirmations. |
| Projects and agents | Select database, create/open database file chooser, Open Project and choose folder, project confirmation, new and edit assistant, select or edit run configuration, new sessions and started-session results. |
| Conversations | Rename, tactics, provider and model selection, permissions, plan approval, agent questions, attachment and repository choosers, file explorer settings, file/diff/evidence tabs. |
| Automation | Dedicated create/edit schedule, repository approval, delete confirmation, execution transcript and changes. Workflow creation, prompt-assisted definition, review/review refusal, reconnect, steer, stop, task configuration, decision and accepted diff. |
| Inspection and management | Search preview, record details, filters and saved filters, columns/table configuration, memory details, log record, polling controls, service and provider recovery confirmations. |

## Guidance and implementation

Authenticated IBM Carbon MCP documentation and code searches informed each family. The QA directory retains the original responses from both tools. The code responses guided component composition. The installed React version and production journeys verify the specific APIs used here.

| Family | Guidance used | Implementation |
| --- | --- | --- |
| Shell and navigation | [Global header with a left panel](https://carbondesignsystem.com/building-blocks/core/patterns/global-header/#header-with-left-panel) | Header, HeaderMenuButton and SideNav organize navigation around tasks. Header utilities stay in the same place across destinations. |
| Startup and providers | [Progress indicators](https://carbondesignsystem.com/building-blocks/core/components/progress-indicator/guidelines/#when-to-use) | Installation and login vary by harness. Show the current required action and real verification state. Only measured progress receives determinate feedback. |
| Conversations and evidence | [2x Grid and slide-in panels](https://carbondesignsystem.com/building-blocks/foundations/2x-grid/guidelines/#slide-in-side-panels) | Place details alongside the conversation and let them take the available width on a small screen. Preserve the initiating owner and focus when the operator returns. |
| Automation and records | [Data table variants](https://carbondesignsystem.com/building-blocks/core/components/data-table/guidelines/#variants) | Use the table toolbar for collection actions. Apply row actions to the selected object. Line tabs separate ongoing management from investigation. |
| Search and diagnostics | [Search recovery](https://carbondesignsystem.com/building-blocks/core/patterns/search/#avoid-dead-ends) | Present the query, scope, results and selected record together. Distinguish literal matches from related sources used in the overview. Preserve a failed query so the operator can retry, and offer Clear search for no matches. |
| Settings and builders | [Forms](https://carbondesignsystem.com/building-blocks/core/patterns/forms/) | Keep labels, related fields, dependent settings, preview and form actions together. Preserve edited values when the backend rejects a submission. |

Carbon owns standard fields, button semantics, tabs, menu surfaces, table elements, theme tokens and composed dialogs. Code60 owns session and execution identity, cancellation, server cursors, revision checks, selection, evidence assembly and focus across view transitions. Monaco, trees, diffs, telemetry and transcript scrolling keep their specialist implementations. The shared stylesheet bridges these retained layouts to Carbon. The job stylesheet contains schedule-specific layout. Visual evidence and run-specific results are recorded in the worktree QA directory under `test-results/qa/carbon-full-app`.

The [visual review and functional coverage](review/carbon-full-app/README.md) include before/after comparisons for the major operator workflows.
