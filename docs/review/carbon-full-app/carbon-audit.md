# Carbon interaction audit

This review started at `4080c62` with first use, a populated project conversation, and a connected database. The rows describe independently reproduced issues. IBM’s hosted MCP supplied component examples and design guidance through authenticated documentation and code searches.

| Surface | Observed behavior | Correction |
| --- | --- | --- |
| Startup | The startup page occupied 768px of a 1600px viewport. Provider setup opened a second modal on top. | A full-width start page owns the setup task and hides the retained workspace. Provider setup opens one native dialog. |
| Shared dialogs | The wrapper and native backdrop each applied a 60% black overlay. The Close icon had a solid primary blue background, and the container inherited 10px rounded corners. | The native dialog paints the overlay. The close control uses a transparent resting surface, and the container has square corners. |
| Provider choice | Provider buttons varied from 145px to 187px wide inside equal grid columns. Initial focus was on the title. | Carbon clickable tiles fill their cells. Focus moves to the first available provider, and keyboard activation starts the existing verification flow. |
| Provider actions | The chooser offered two Close controls. Install or Sign in and Retry could both appear as primary actions following a failure. | The chooser has a single close control. Install or Sign in gets primary emphasis when it is the recovery step. |
| Global navigation | A keyboard user had to traverse header and sidebar controls to reach an open page. | The first header link moves focus directly to the current panel and preserves navigation history. |
| Page actions | A lone downward chevron beside the title suggested a page selector even though its menu contained commands. | A horizontal ellipsis marks the named actions menu. The menu retains its shortcuts and focus handling. |
| Settings | The Appearance title and its fields started in different grid columns. | Section headings, labels and controls share the page’s left grid line. Forms keep a bounded reading width. |
| Command validation | Opening a blank command immediately showed three errors. The form used separate error paragraphs and gave keyboard users no route from Save to the first invalid field. | Carbon inputs expose field-specific validation on blur or submission. Save focuses the first invalid field. Description is marked optional. |
| Command actions | An untouched form announced an unsaved draft and enabled Discard. New competed with Save, and Delete had the same treatment as routine editing actions. | Unsaved and Discard follow actual edits. Save owns primary emphasis. Only saved commands offer the danger action, with the existing confirmation. |
| Builder navigation | Each prompt or command was presented as an outlined action button, obscuring which record was selected. | Quiet rows use a selected layer and a leading indicator for the current record. |
| Search | The query lacked Carbon’s clear control. Results could appear beneath a spinner still announcing “Searching…”. Match highlights resembled primary actions. | Carbon Search clears the query and returns focus to the field. Literal search and overview generation report their own progress. Matching text uses the theme highlight token. |
| Workflows | Definition actions appeared above the view tabs, while the empty Definitions view only said “No saved workflows”. | The page heading leads into the tabs. Each view owns its actions and empty-state guidance. First use puts New workflow beside the explanation. |

## Screens and sources

The [dark mode gallery](dark-mode.md) shows the audited interactions alongside a populated conversation, schedules and execution history.

- Provider setup — [earlier](audit-provider-before.png), [updated](audit-provider.png), [mobile dark theme at 390px](audit-provider-mobile.png). [Modal guidance](https://carbondesignsystem.com/building-blocks/core/components/modal/guidelines/) · [Tile guidance](https://carbondesignsystem.com/building-blocks/core/components/tile/guidelines/)
- Settings and builders — [earlier Appearance](after-appearance.png), [updated Appearance](audit-appearance.png), [earlier Command Builder](after-commands.png), [pristine form](audit-commands.png), [after submitting an empty form](audit-command-errors.png). [Forms](https://carbondesignsystem.com/building-blocks/core/patterns/forms/) · [Button hierarchy](https://carbondesignsystem.com/building-blocks/core/components/button/guidelines/)
- Navigation, search and automation — [selected search result](audit-search.png), [empty Definitions view](audit-workflows.png). [Header accessibility](https://carbondesignsystem.com/building-blocks/core/components/ui-shell-header/accessibility/) · [Search](https://carbondesignsystem.com/building-blocks/core/components/search/guidelines/) · [Empty states](https://carbondesignsystem.com/building-blocks/core/patterns/empty-states/)

The browser checks exercise opening setup, keyboard focus, command validation and discard, search clearing and recovery, workflow creation, and returning to a retained conversation. Screenshots use isolated state and synthetic providers. The review covers the surfaces above. Physical screen-reader testing and a visual review of every route at every breakpoint remain outside its coverage.
