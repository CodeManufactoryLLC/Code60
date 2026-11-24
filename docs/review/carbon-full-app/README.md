# Carbon workflow review

The comparison uses the approved Scheduled Jobs build at `656b0ae` and the full-app conversion based on `341bd8e`. The [migration ledger](../../carbon-migration.md) maps every destination and dialog family to its interaction model and IBM guidance.

| Workflow | Reference | Full application |
| --- | --- | --- |
| Connect a provider | [Providers](before-providers.png) | [Verified provider list](after-providers.png) |
| Open a project | [Projects](before-projects.png) | [Project list](after-projects.png) |
| Direct work | [Conversation](before-conversation.png) | [Pending plan](after-conversation.png) · [Files](project-files.png) · [Dark](after-conversation-dark.png) · [Narrow](after-conversation-narrow.png) |
| Schedule and investigate | [Schedules](before-schedules.png) | [Schedules](after-schedules.png) · [Form](after-schedule-form.png) · [Execution history](after-history.png) |
| Investigate a workflow | [Running workflow](before-workflow-player.png) | [Running workflow](after-workflow-player.png) · [Narrow and dark](workflow-player-dark-narrow.png) |
| Inspect records | [Search](before-search.png) · [Logs](before-logs.png) | [Selected search record](search-selected-record.png) · [Retained logs](after-logs.png) |
| Configure and recover | [Prompt Builder](before-prompts.png) · [Command Builder](before-commands.png) · [Service health](before-system.png) | [Prompt Builder](after-prompts.png) · [Command Builder](after-commands.png) · [Service health](after-system.png) |
| Readability | [Appearance](before-appearance.png) | [Appearance](after-appearance.png) · [Forced colors](jobs-forced-colors.png) · [200% CSS zoom](jobs-zoom.png) |

The [Carbon interaction audit](carbon-audit.md) records the subsequent review of startup, navigation, forms, search and workflows.

The [dark mode gallery](dark-mode.md) covers 15 desktop views across the operator workflows.

## Sidebar review

The Carbon homepage uses UI Shell submenu buttons for its section navigation. The four Code60 sections use that same React component. The current route opens its section, and each section can be toggled without leaving the page. At the default text size, the section uses 16px semibold Plex and destinations use 14px regular Plex. A collapsed section containing the current page retains Carbon’s active indicator. [Carbon homepage](https://carbondesignsystem.com/) · [UI Shell left panel](https://carbondesignsystem.com/building-blocks/core/components/ui-shell-left-panel/accessibility/)

[Previous sidebar](navigation-before.png) · [Updated sidebar](navigation.png) · [Dark theme](navigation-dark.png) · [Mobile drawer](navigation-narrow.png)

## Visual findings

The project title, selected conversation, plan and composer share one frame. At narrow widths the operator can open the plan or file detail at full width. On larger screens the resizing handle stays on the panel boundary. The schedule list exposes next run, enablement and running state simultaneously, and the selected execution owns its evidence actions.

The workflow player retains the execution clock, progress chart, task evidence and activity stream. It uses Carbon layers and separators, and its transport controls fit at narrow widths. Search keeps the submitted query visible while a result is expanded. Related sources from the generated overview remain available when a literal search finds no matches. Settings retains functional text and table choices. Legacy appearance values survive the upgrade.

The screenshots use synthetic providers and isolated state. The workflow player reference comes from the trial's archived production journey. Dates, elapsed times and temporary paths vary between captures.

## Functional checks

The production browser journeys exercise first use, installed and missing providers, external sign-in handoff and cancellation, LAN pairing and takeover, scoped resume, concurrent project conversations, retained drafts and server-side log paging. The golden project journey verifies plan approval, execution in an isolated worktree, changes, diff, attachment and Undo. Scheduler and Transmission journeys exercise independent execution ownership, reconnect, cancellation and evidence. Search covers an empty database, no literal matches, selection and retry after a failed gateway response.

The local QA directory holds the full command logs, Carbon MCP responses, visual evidence and checkout preservation audit. Verification uses synthetic accounts and supervisors. Physical screen-reader testing, real provider credentials and installing a real login service are outside this evidence.
