# Renderer

- Relay is application-owned, database-independent and singleton. Its history,
  draft and selected identity must not inherit a database/project view lifetime.
  Relay never offers New global chat, rename or archive. Connection Retry does
  not resume tasks. Show bounded history and incomplete/partial evidence honestly.
  Its file panel must not silently follow the selected project; hide that panel
  until an explicit Relay workspace/target view is selected.
- Relay file roots use the workspace/opaque-target choices supplied by main.
  Bind each visible file context to its detail subscription and increasing
  sequence; never synthesize a project FileContext or send an absolute root.
  Keep Relay tabs and file state outside database/project lifetimes.
- Retained inactive panels keep their content but expose no toggle action. Only
  the active panel offers a Files toggle, including Relay without a database.
- Relay Changes groups bounded review pages by target and labels direct edits
  separately. Send only opaque review/revision/file IDs with its captured Relay
  generation. Keep historical evidence readable, disable historical feedback,
  and require the human-only confirmed checkout-local apply/undo flow. Read
  review details only while requested and active; revision hints are not payloads.

- When `openProjects` is present, project-instance identities supersede the old
  single-project disposal rules below. Retain each open project's views on
  navigation; dispose only on actual close or database-instance replacement.
  Project accordions contain project-bound chats and workers, with a separate
  New chat action per project. Selecting a project never retargets Relay.
  Closing a project and stopping a folder are distinct confirmed operations.

## Ownership and style boundaries

- Keep `main.tsx` as bootstrap and `App` as composition, not another monolithic
  hook. Inject the desktop API. Use focused snapshot, preference, window,
  visibility and splash lifecycles.
- Application services outlive projects. Database conversations/events and
  Commands/Prompt Editor drafts survive same-database project replacement.
  Project-instance state owns worker views, file tabs/reads, transcript caches,
  table selections, menus and project dialogs. Keep form/draft/scroll state local.
- Hiding a page/panel or returning to splash is activation, not disposal.
  Replacing today's single project disposes its scope. Use generation captures,
  not path equality alone, for delayed reads/actions, including A → B → A.
  Capture execution identity before awaiting. Disposal must not replay actions,
  stop backend workers or delete persisted history. Do not add a project cache
  or claim multi-project backend authority.
- Derive static navigation metadata from `navigation.ts` and keep page rendering
  exhaustive. Dynamic conversation identities are not static pages.
- Share message presentation and exact-source draft mechanics. Keep orchestrator
  and worker action/recovery lifecycles separate.
- `style.css` owns only imports and ordered layers: vendor, tokens, base, layout,
  components, utilities, accessibility. Put rules beside their feature owner in
  `styles/`; reconcile existing declarations instead of adding late corrections.
  Keep the selected `data-theme` distinct from resolved `data-color-scheme`.
  Use the resolved attribute for the single dark palette and artwork. Import
  Glide CSS in the vendor layer. Scope runtime Monaco overrides to its internals.
  Never restore a universal important radius reset or global rounding patch.

- Tactics opens only from the orchestrator composer. Use the bundled browser-safe
  catalog as React/text, never prototype HTML/scripts. Preview does not apply;
  Apply persists before closing, Remove explicitly clears, and neither sends or
  changes the draft. Keep search/keyboard/focus behavior accessible, full/shared
  prompt disclosures readable, and Apply reachable in narrow layouts. Pass only
  chat/project identity and tactic ID/null through the validated action. Saved
  chats remain stopped until Send or explicit Continue task.

- Orchestrator and worker chats use borderless agent text and solid user bubbles: verdigris in Light, lighter verdigris in Dark/System dark, with contrasting text. Activity/tool disclosures remain distinct. Copy uses a 16px Carbon icon without a fill or border, outside user bubbles, with glyph highlighting on keyboard focus and a 24px hit target. Keep a single resizable file panel after the conversation, opening at 20% of Chat width with a 120px panel minimum and 300px conversation minimum, stacking below Chat at 1200px and below. Give it only a left divider and the left navigation fill throughout, including Monaco, and a Carbon drawer toggle inside its tab header. Close to zero width with no divider or rail, and zero height on narrow layouts. Show the reopening icon at the chat area's top right when closed, reserving header space so actions do not overlap it. Keep hidden contents inert; preserve toggle focus, tabs, preview state and expanded width. Animate expansion/closing with reduced-motion support. Keep the resize grip borderless at rest, with visible keyboard focus.
- Conversation rows use numeric unread badges and plain-text activity/errors, without icons. Keep counts and status text in a separate reserved column; ellipsize names before they overlap those indicators. Count each turn once at its first nonempty agent text. Opening Chat marks all present replies read regardless of scroll; open-chat streams stay read. Persist only database/run-scoped read markers in session storage, never message content; use pushed events without polling or new IPC.

`src/renderer` is the React interface, built by Vite into `dist/renderer`.

- Reach the main process only through `window.desktop`. Import only types from `core`, and nothing from Node.js or Electron.
- Render prompts, activity, tool output, and diffs as text. Agent replies in both chats alone may use ChatMarkdown (react-markdown and remark-gfm) to render safe React elements, including semantic emphasis. Never use `dangerouslySetInnerHTML`, raw-HTML plugins, or remote images/embeds. Links allow only validated HTTP(S) destinations through openWebLink and native confirmation; never navigate Electron. Copy retains exact source. Preserve the CSP.
- Merge updates by revision with `applyUpdate`, so reloads and startup never lose or duplicate events.
  Subscribe before the initial snapshot. Bound the pending frame buffer; overflow
  and a gap in previous-broadcast revisions require a single-flight full read.
  Keep recovery attempts bounded and discard all late work after disposal.
- Detail streams use the same bounded recovery protocol with independent owner
  revisions. Retain caches across navigation, prune closed/replaced addresses,
  and never use a newer unrelated app revision to drop conversation events.
  Compact conversation reply counters use count-based session read markers;
  legacy event-only snapshots retain their turn-based markers.
  App detail-revision hints request bounded resynchronization only for the
  addressed subscription. Check hints received during a read before installing
  that response; never use a global app revision as a detail-data fence.
- Use appSummary for startup/recovery when supplied, and scoped details for
  selected views. Summary revisions never advance detail-data fences. Selected
  Relay workers subscribe to their own target, never the selected project.
- Show status as text, not only as color. Keep controls labelled, keyboard reachable, and their shortcuts visible.
- Support Light, Dark, and System appearance, and the opt-in Signal colors (`data-signals`), with the CSS variables in `style.css`. Light uses white surfaces with subtle borders and restrained shadows to distinguish them, with teal actions (`#43b3ae`) and pale viridian hover fills; selection uses neutral gray; saved Paper selections migrate to Light. Dark and System dark use jet black (`#000000`) wherever Light uses white for neutral resting surfaces, with white text, `#aaaaaa` muted text, `#444444` subtle borders, `#888888` control borders, and `#303030` selected fills. Use lighter verdigris actions and user bubbles (`#77ccc8`), related focus and hover colors, and opt-in signals; separate fields and controls with fine borders and keep disabled stripes transparent. The Code60 wordmark’s colored 60 block has a small upper-right, 45-degree chamfer. The main Chat composer has 5px rounded corners, a visible 1px border, a subtle 1px outer shadow retained on focus, and focus that replaces the normal border color without a separate inset outline, including system colors in forced colors. The composer and both sidebars blend into the main app surface: white in Light and steel-gray (`#242b33`) in Dark/System dark, including file previews and resting controls. Buttons, modal/popup windows and both new-message composers use the shared 5px border radius. Joined button groups round only their outside corners. Human message bubbles also use 5px corners. Other fields, agent messages, page surfaces and vendor editor/table internals stay square; retain the existing full-window splash and native window frame geometry.
- Give every independent icon action the shared `icon-button` class: no border, shadow or background fill in resting, hovered, pressed or disabled states; hover and focus highlight only the glyph, with no focus outline even when Focus highlight border is enabled. Preserve hit targets, accessible labels, disabled semantics and visible keyboard focus. Decorative icons in labeled buttons, rows and menus inherit their parent state, never their own hover. Close, add and drag actions remain separate controls even when visually inside a tab or row.
- Use the 16px Carbon icons from `icons.tsx` (`Icon` in the DOM, `drawIcon` on canvas), except the six top-level Phosphor duotone navigation icons from `navigation-icons.tsx`, 1em conversation role icons and 8px static activity fallbacks, instead of text glyphs such as ×, ↑, or ▾. Write run states with `statusSpec` labels and, outside the left sidebar, icons; nothing blinks.
- Apply the six text roles (table headings, buttons, agent messages, human messages, page titles, and normal text) through their CSS properties and the canvas table theme. All roles default to IBM Plex Sans Regular (400) in sentence case. Left navigation labels default to 15px; other buttons retain their 13px default. An explicit Button Text size controls both, including an explicit 13px choice; resetting it restores the separate defaults. Preserve saved role choices and existing migration markers when changing defaults, without another appearance reset. Use regular weight for navigation, headings, other status labels, controls and the wordmark; avoid hard-coded bold or selected-state weight changes. Keep code and diffs monospace and case-preserving. The shared Code60 wordmark uses IBM Plex Sans Regular independently of text-role choices; preserve its green chamfered 60 block and the D-DIN splash subtitle. Bundle fonts locally and retain their licenses; keep `font-src 'self'`.
- Get external data from snapshots and request reads with `poll`; do not start timers that fetch data. Use `useTicker` from `ticker.ts` for clock-only redraws, inside the smallest component that needs it, and report visibility with `setVisibility`.
- Keep Glide Data Grid imports in the renderer. Import its bundled CSS and pass theme colors resolved from the app's CSS variables, since the grid draws on a canvas; do not inject styles or weaken the Content Security Policy. Preserve row selection by session ID across sorting and data updates, and support clicking a row or pressing Enter on a cell to open its chat. The Actions cell opens its session's actions menu instead; keep that menu keyboard reachable.
- Build tables with `DataTable` from `data-table.tsx`, so every table shares Glide's search, header-menu filters, add row, and per-table settings. Save table preferences by stable column ID through `useTableView`; keep ad hoc column filters in memory. Named definitions and one active selection persist by table and database/project with `saved-filters.ts`; incompatible definitions must remain visible and unapplied. Use explicit column filter types so empty tables do not change their meaning.

- Give buttons, checkboxes, radios, switch tracks/thumbs, cards, modal/popup windows and chat composers the shared 5px corners without a trailing-edge border effect. Round selected radio indicators too; preserve the Carbon checkbox mark. Button groups and segmented radio choices use 5px outside corners and straight internal separators. Include settings cards, settings field groups and approval cards, without clipping their focus indicators. Main page surfaces have no outer border. Hover changes the fill without introducing a border. Text fields, scrollbar thumbs and other passive page surfaces stay square; the Code60 wordmark retains its branded upper-right chamfer. Standard button groups use 28px controls (30px overall), with 24px controls for compact groups. Give page headers a small bottom margin. Table headers put the page title on the left and the control group on the right, wrapping on narrow screens. Button groups have no overlap or cutouts; give them a fine outer border, a restrained shadow, and white fills in Light and black fills in Dark. Use the standard Carbon checkmark. Focus outlines and glows follow the Focus highlight border preference, which defaults off, except independent icon actions use glyph highlighting without an outline; preserve keyboard focus behavior, validation baselines, filled resting controls and restrained overlay shadows.
- Table Settings opens a native modal with draft controls and a four-row fictional Glide preview. Reuse shared canvas styling and width calculations. Apply commits once; Cancel, Escape and close discard drafts. Reset is draft-only and removes the saved override when applied without further edits. Keep at least one data column visible, including when chart columns are turned off. Restore trigger focus, keep the header/footer visible, use two-column display toggles without row dividers, and discard drafts on workspace replacement. Put column visibility toggles in a closed-by-default dropdown above the orange dotted preview frame; Escape dismisses that dropdown before the modal. Scrollbars should remain subtle in both themes, with stronger hover contrast and system colors in forced-color mode.

- Default canvas gridlines off; preserve per-table line settings. Use white headers and rows in Light, black headers and rows in Dark, and resolved CSS colors in Glide. Preserve explicit labels when colors change or forced colors apply.
- Search and Messages use `useTranscripts` and its project-scoped cache. Bound concurrent history reads, deduplicate requests, expose partial failures/retry and discard stale project responses. Search may request the dedicated evidence-only summary helper through its validated bridge; do not expose generic agent execution or telemetry capabilities.

- Use one application footer across the full window bottom without a top border, with a 20px default content height and 4px bottom padding, lifting all compact vertically centered controls above the window edge. Vertically center the last-seen icon/text at its left; only activating it opens a modal with Pause/Start and Refresh polling controls. Keep updates and an actionable pending-approval count in the footer, with the full runtime version at its bottom right. Give polling controls centered equal-width buttons and a 200px minimum dialog height bounded by the viewport. Give last-seen and harness-mode triggers 12px horizontal padding. Keep page panels free of internal footer space and treat the footer as opaque during transparent-window hit testing.

- Keep the selected conversation's agent-message age inside the vertically centered footer trigger. Dark footer surfaces are black.
- Match the footer database icon's resting color and opacity to Last Message text,
  while retaining shared hover/focus glyph highlighting and disabled semantics.

- Enclose repository identity and page navigation in one square-edged sidebar with only a subtle 1px theme-aware right divider and full-width rows and wider in-row label indents. Align its top and bottom with the desktop right file panel, leaving the shared 12px bottom inset above the footer. Keep the native-control drag strip separate, without extending the sidebar fill into it. Keep it open with no collapse toggle, rail or hover expansion. Provide a borderless right-edge resize handle with visible keyboard focus and Left/Right adjustment. Default to 220px, constrain to 180–480px while reserving content space, and remember the width locally. Preserve navigation, conversations, drafts and disclosure state when resizing. Keep matching 12px workspace insets. Resting labeled controls match the sidebar fill. Enabled hover uses viridian. Mark the selected page with a contrasting fill and accessible selection state, without an underline or bottom border. Preserve system selection outlines in forced colors. The tab list scrolls within the available height and reserves its scrollbar gutter before overflow. Its filled interior, including gaps between buttons, stays opaque to transparent-window hit testing.

- Keep project identity, nested page labels and conversation roles/status text-only. The six top-level navigation entries alone use local Phosphor duotone icons sized at 1.5em (150% of the label text): Chat = green chats, Prompt Editor = purple pencil-line, Commands = red megaphone, Settings = gray gear, Search = orange magnifying-glass, Tables = blue database. Preserve the official paths and 20% secondary layer from @phosphor-icons/core 2.1.1, its MIT license/provenance, and the CSP without adding a dependency or runtime fetch. Use Light/Dark-aware hues and system text colors in forced colors. Keep these SVGs decorative and non-focusable, colored on hover/selection, with an 8px label gap and at least 12px of leading space, without adding actions. Expand the gutter and 40px minimum rows as needed for larger text, retaining hierarchy alignment and avoiding clipping. Center the project selector with equal horizontal padding. Restore Carbon chevrons for show/hide disclosures and the horizontal overflow icon for More, keeping independent actions as labelled `icon-button` controls. New chat uses a separate labelled Carbon plus action. Stack sidebar rows without gaps, preserving labels, keyboard order, selection, disclosure semantics, unread counts, errors and approvals. The application footer database icon remains separate.

- Settings exposes the shared agent setup wizard through Add agents and Change primary, plus the fixed allow-all switch. Present bundled logos and alphabetical Antigravity, Claude, Codex, Copilot, Droid, Kiro and OpenCode choices as agent cards that immediately start detection and connection on click or Enter/Space, never radio inputs or a separate Continue step. Use compact wizard typography (16px headings, 13px body and controls), independent of larger page-title settings. Keep arrow/Home/End focus navigation and Enter/Space selection. Select primary first, detect, connect and save automatically through the existing finish action, without further confirmation or review steps. Keep the result open with Close and optional Add another agent; failures offer Close and Retry, including save retry without another probe. Each addition starts a new add transaction so dismissal cannot undo earlier successes. Show only Detected and Connected as agent statuses; use separate progress and error messages with retry/cancel controls. Preserve native keyboard navigation, live progress announcements, shared text-role and theme tokens, and reduced-motion support. Persist no verification in renderer storage.

- Require completed main-process setup before splash entry, including renderer reloads and existing installations. Dismissing unverified setup leaves entry blocked. Render the recoverable main-process session and commit automatically through finishAgentSetup after successful verification. Membership is configured, not a permanently live connection. Share the application's saved Light, Dark or System appearance with the splash. Keep an upper-right Light/Dark button group that selects and saves the application theme, reflects System appearance changes until an explicit selection, and stays non-draggable above the content, painted after the drag strip. The splash is photo-free: use solid white surfaces with black lettering in Light, and solid black surfaces with white lettering in Dark/System dark. Do not import background artwork or read/write the legacy `code60.splashBackground` key. Use locally bundled IBM Plex Sans Regular (400) for the shared wordmark, preserving its transparent backing and theme-green chamfered 60 block. Horizontally center the wordmark and the exact subtitle "v0.2 'Paddock' (Beta)" as one group, lifted up to 48px above the logo area's center, with the subtitle below in regular 18px D-DIN and its exact case preserved. Reduce that lift on short panels instead of overlapping the database notice or other controls. Use the subtitle as the dialog description and reveal both together only when ready. Keep sidebar text and path labels fully opaque, with transparent resting control fills. After setup, show the full shared project selector beside the wordmark, never a Continue/Yes/No prompt. Center the Open Project heading. Include recent folders with full paths, Remove, and a Carbon plus/Open Folder button link immediately below the list, not a filled footer button. Omit Clear history from both selectors. Start enters without opening a new project. Recent-project selection requires a cancellable in-app confirmation with the full path; keep failures in that confirmation for retry. Native folder picking also confirms before opening. Only the dedicated top strip is draggable; the sidebar remains non-draggable. Preserve setup/database gates, native-picker cancellation, errors/retry, focus, and Escape-to-enter behavior. Keep scrolling controls reachable on narrow windows. Forced colors use system colors for the sidebar, wordmark and keyboard focus.

- On the splash, disable project controls for in-flight operations, not merely because project runs are active. Show the active-run restriction visibly, let recent-project clicks open the existing blocked confirmation, and let Open Folder explain the restriction without opening a picker. Keep history-only Remove and Start available without stopping work. Preserve the main-process project-switch guard and the confirmation's disabled Open action until runs finish or stop.

- Put an icon-only, labelled Carbon plus action beside Chat, as a separate button, never nested in the tab. Keep it reachable when the Chat group is collapsed. Creation reveals the group. Nest only labelled conversations beneath Chat. Use 4px vertical navigation padding and 40px minimum rows, growing to fit proportional icons and larger text. Share in-flight guards and visible errors between creation and conversation selection. Remember expansion; reveal externally selected conversations. Collapse never changes the conversation. Preserve independent drafts, transcripts and scroll positions; activity and failure indicators remain visible on background conversations. No secondary sidebar or standalone Files page.

- Present orchestration Chat as a conversation: right-aligned user messages, borderless assistant replies without repeated speaker labels, inline activity dropdowns for thoughts/tools/permissions, toggled by the live animation/status or completed turn timing, and a persistent composer. Show “Give Code60 a task.” in the empty conversation view. Keep session metadata inside the shared composer footer: mode at left, then context donut/model/harness logo/Send or Stop at right. Use N/A for unavailable metadata, shared keyboard-accessible tooltips, and a custom mode menu preserving advertised option groups and idle-only changes. Keep Code60 approval policy in the mode tooltip. Keep orchestrator progress visible with an activity row below the latest transcript message, with the animation on the left and a regular-weight state name on the right, with a local current-activity timer after its ellipsis. Hide idle activity entirely; keep the name left-aligned within a fixed-width area, and fade ordinary activity changes while respecting reduced motion. Expand/collapse the activity row when opening/closing. Follow transcript size changes only while the user is already following the bottom. Present waiting_for_workers as Monitoring subagents with the radar artwork. Align status text with agent reply text and keep artwork in a reserved left gutter. Activity dropdowns smoothly expand/collapse with reduced-motion support and expand fully with no nested scrolling; preserve per-turn expansion and reading position, and support keyboard toggle/Escape. Composer and sidebar entries have no striped loader; replace Send with Stop during a turn. Errors stay outside collapsed activity.

- Plan tabs are plain React DOM, never a Markdown renderer or webview. Keep progress and actions in the toolbar outside the document. Task rows use a grid whose checkbox and status cells are one line box tall, so they stay centred on the first text line at any size or wrap; notes align with the task text. Completion checkboxes stay disabled indicators without the unavailable-control hatching.
- New and revised draft plans open in the existing side panel. Do not duplicate
  those tabs with Plan buttons in the chat header. Preserve plan progress,
  acceptance, revision, persistence and tab-closing behavior.
- Paint each conversation label, ellipsis action and worker disclosure on one
  rounded row background, with only four outside corners and straight internal
  seams. Keep the buttons independent, their enabled fills transparent and their
  focus, context-menu, disabled and keyboard behavior intact.

- Display automatic worker prompts as labelled activity, never as user messages. Show paused worker updates with a keyboard-reachable Resume updates control bound to the current chat ID. Label orchestrator-owned worker chats as allowing all actions. MCP contract descriptions must distinguish read-only tools from tools that change worker state.

- Group Configurations, Events, Logs, Messages, Polling, Sessions and Worktrees beneath Tables. Keep table children alphabetized and Settings last in normal navigation, without a bottom spacer. Nest Agents, Appearance, Table defaults, Text, Polling, Updates and About as individual pages beneath Settings. Build Settings pages from `SettingsHeader` (title, optional tip, page-wide actions) and bordered `SettingsCard` rows or `settings-group` field cards, so no row or field sits outside a card; use the shared `segmented` control for short exclusive choices. Settings pages have no explanatory paragraphs: put explanations behind an `InfoTip` information button beside the setting or heading, keep them as the control's accessible description, and drop text that only restates the controls. Under Settings → Advanced, put Experiments → Episodic Memory and the sibling Contributor Tools placeholder page. Remember disclosures, reveal external destinations, and support arrow-key navigation without changing the active page on collapse.
- Logs is app-wide and available without a database. Reuse DataTable settings and
  saved filters, applying search/conditions to retained history through validated
  requests, not only the visible page. Use bounded cursors and stale-response
  rejection. Notices, never a fetch timer, drive updates. Preserve paused,
  selected, scrolled and older-page readers. Capture continues while viewing is
  paused; show pending records, retry, partial history and cursor expiry clearly.
  Details are text-only, Enter-accessible, with awaited icon-only Copy. Explain
  that diagnostic retention and Clear logs never affect transcripts or databases.
- Orchestrator rows use main-process titles with numbered fallbacks and offer Open, Rename, Archive via a labelled More icon button and keyboard-accessible context menus. The main header displays and edits the same name. Archive hides the orchestrator only, retaining session records and work. Worker rows remain accessible.

- Group prompt templates beneath a collapsible System disclosure. Keep saved edits in this group, preserve drafts on collapse, omit per-prompt Built-in labels, and use borderless items with viridian hover and neutral gray selection.
- Put Commands after Prompt Editor, disabled without a database. Reuse the prompt-editor layout for a command list and labelled Name/Title/Description/Prompt fields, inline validation, Save/Discard and natively confirmed Delete. Preserve drafts across page and command switches, scoped to the database. The orchestrator composer alone offers a leading-slash ARIA combobox filtered by name/title: Up/Down selects, Enter/Tab inserts and Escape dismisses without sending. Send only the recognized command name with the original text; main expands it. Mark recognized leading commands in user bubbles without changing Copy, and explain unknown slash words as plain text. Never expand commands in worker chats.
- Files uses Headless Tree and the shared read-only Monaco inspector. Keep filesystem access scoped through `setFileContext` and refreshed by the main-process Files poll source. Bundle Monaco workers and languages locally; its generated style elements use the build nonce, with `style-src-attr` allowing its per-token positioning. Never permit inline scripts or remote assets. Keep renderer-only blank, Explorer and file tabs separate from page navigation; clear them on project/database changes and reloads. Hide the panel outside Chat while preserving tabs, order, drafts and editor scroll/selection state in memory. Request filesystem context and polling visibility only for the selected Explorer/file tab while the panel is visible; discard stale reads.

- Files uses borderless page and inspector surfaces with `--chat-neutral` fill, neutral selection and viridian hover. A plus immediately after the last tab creates blank tabs with a centered Open Files link that replaces the blank with Explorer; multiple Explorers are allowed and share expansions and hidden-file preferences. Deduplicate file tabs by relative path. Every tab is closable and draggable; support arrow/Home/End selection, Delete close and Alt+Left/Right reorder, restoring focus after close/reorder. Closing the last tab returns to the empty panel. Keep file names and code case-preserving; resolve Monaco preview colors from the app theme tokens, including System appearance.

- Without a database, replace project identity/selectors with Connect to database on both splash and sidebar. Show the large, non-dismissable database warning at the top of both surfaces. Disable workspace navigation, chats, files, and polling until connection succeeds, including command-palette alternatives; keep connection, app entry, setup, Logs, settings, and updates available. Cancellation/failure must leave the warning and disabled state intact. Once connected, the sidebar becomes the text-only project card: show Open a project or the selected folder, without borders or hatching, and open the project modal on activation. Keep cancellation/errors in the modal, show a success toast after project selection, and disable switching while project runs are active.

- Chat File Explorer always opens the current project root. Route legacy Files, palette and Browse project files through Chat to an existing or newly created Explorer tab; Search file sources open or select file tabs directly. Never select a worktree/private orchestration root; offer Open project when absent. Clear stale selections on project changes and discard stale reads. Put Show hidden files only in the native modal opened by the settings icon beside the Explorer title; changes apply immediately, Escape/Done closes and restores trigger focus, and workspace/page/tab changes and hiding the panel dismiss it. Do not show a Reveal in Files preview button.
- Show current-project worker sessions, including history, in the normal Chat hierarchy. Nest only known owned workers beneath their controlling orchestrator; unknown/manual sessions stay directly beneath Chat, except finished ones, which are hidden unless a current orchestrator owns them or the user opened them. Name workers, in rows and their chat heading, by the role label the orchestrator assigned at dispatch, falling back to provider / short run ID. Keep sidebar names text-only, with role provenance in accessible descriptions and independent status text/unread counts. Separate worker disclosures expand on new children without changing selection; otherwise retain manual collapse. External navigation reveals ancestors. Preserve visible-row keyboard navigation, drafts, scroll, permissions, recovery, Copy, timing and shared file panel. No popup, dock, fullscreen, close/minimize or reorder controls. Worker selection must not change backend orchestrator selection. Load history on demand through the shared cache, never merely to populate rows.
- Use per-conversation current-project owned worker IDs for aggregate activity, not the global worker list or process existence. Keep sendability and Stop tied to the orchestrator alone.
- Both chat interfaces use shared turn timing and icon-only Carbon Copy controls with accessible labels. Show dispatch-to-completion timing with outcomes; incomplete history stays explicitly unavailable. During an active orchestrator turn, use the activity animation/status/timer instead of a duplicate Working for line; retain completed Worked for summaries. Use the local ticker only in small displays, without per-tick announcements or scroll/focus changes. Copy exact message source at invocation, await clipboard success, then show “Copied.” through the shared application success toast, never a local success tooltip. Keep actionable inline failure feedback with Retry Copy. Keep the full runtime Code60 version at the bottom right of the application footer.
- Put a compact relative message age immediately before Copy, using the original prompt or first response-chunk timestamp, never replay time. Keep its width reserved and failure feedback out of flow so the icon never shifts on click, success, failure or toast dismissal/expiry. Fade the entire row in/out on message or controls hover, with keyboard focus also revealing it. Keep its layout space while hidden, stop local clocks in hidden chats/documents, and do not announce clock ticks. Give every mouse/keyboard Copy activation a brief glyph-only depression without moving the hit target. Respect reduced motion.

- Search submits only on Enter or Search. Capture results after transcript reads settle, keep them stable until resubmission, and keep AI overview failures separate from usable results. Use single-column title actions and local numeric citations; never render generated markup or links. Start an overview even without literal matches, use relevant saved context for natural-language questions, and map citations to the exact returned evidence. File sources open the read-only file tab in the Chat panel. Cancel stale requests and preserve page-switch state.

- PanelShell owns only layout, tab interactions and focus; FilePanel retains file identities, reads and preview state. Keep tab descriptors stable across unrelated streamed updates. Changes lists revisions nested beneath review (task) titles, without a review dropdown. Each revision opens a separate tab deduplicated by review/revision identity. ReviewPanel/useReviewFile own pinned revision diffs and cancellable saved-file reads with local loading/errors and read Retry. Revision tabs show only the file list and read-only inline diff, without selectors, titles, counts, diff toolbar, review/worker/compare controls, capture, apply/undo or feedback actions. Show all captured files, including reviewed files, and leave empty revisions blank. Preserve pinned revisions and distinct same-path worker versions.

- Chat owns guided Git setup with selectable files and bounded previews. Preserve conversation/drafts, require explicit initial-commit confirmation and explicit task continuation. Show failures and partial completion honestly; never replay dispatch or suggest Refresh can recover a non-isolated run baseline.

- Changes lives beside orchestrator Chat in the shared panel. Preserve revision selection and
  view state on incoming captures. Keep worker sources distinct, including same-path files.
  The tab never changes files, review decisions or feedback. Source-aware
  review file tabs show saved content rather than silently opening project files.

- Worker headers place status as a subtitle beneath the agent name. Keep sidebar names icon-free and scale worker heading icons to 1em of the associated text; composer harness logos retain their dedicated size.

- Sidebar navigation rows extend from the window's left edge to the sidebar's reserved scrollbar gutter, without container or group padding. Apply hierarchy indentation inside labeled buttons instead, so nested page and conversation highlights remain full width. Use a 40px minimum base page inset that grows to fit larger icons, with 24px hierarchy steps; conversation labels retain their 4px alignment offset. Do not apply these wider indents to the splash selector. Selected rows use the neutral selection fill without an underline or bottom border. When Chat is open, highlight the selected conversation rather than the parent Chat disclosure; clear conversation current state on other pages. Keep navigation rows, the project header and their adjacent row actions aligned at a 40px minimum height, expanding consistently for larger text. Settings and orchestrator action controls share their row's highlight. Keep a labelled Carbon database icon action in the application footer, on the same line as the Last Message indicator and aligned to the sidebar's right edge as it resizes. Immediately to its left, put a separate Carbon back-arrow icon action with the tooltip and label “return to splash page”. Returning preserves the database, open project, chats, drafts and active work. Keep that explicit return visible even with an open project and across renderer reload; Start/Escape or a confirmed project selection re-enters the app. Do not block return merely because project runs are active. Use the compact footer height, outside the scrolling tab list; reuse the database modal and project selector's busy/active-project-run restrictions. The right file panel has no top, bottom or left container padding.

- Chat bodies have no bottom padding beneath the composer, in both wide and narrow layouts.
- Main Chat follows streamed growth with one retargetable scroll animation, cancelled
  by upward input or reading activity details. Restore history/reading positions
  without animation. Fade/translate new visible assistant messages only once, never
  each chunk or historical/background messages. Respect reduced motion and hidden
  documents; preserve exact source, Copy and Markdown behavior.
- Appearance includes four local transition-time sliders (reply entrance, scroll
  response, activity fade and activity dropdown), each defaulting to 175 ms and
  accepting 0–30,000 ms with fine
  short-duration control, exact numeric entry and Reset transitions. Zero is instant;
  preserve reduced-motion, hidden-view and urgent-state overrides. Keep CSS/JS
  timing synchronized and cancel long automatic reveals on reader input or stale views.
  Other UI transitions also default to 175 ms. Read unversioned saved chat timings
  at half their previous bounded duration, rounded to whole milliseconds, without
  changing missing/invalid fields from the new defaults. Save version 1 alongside
  later edits so reloads never halve them again. Reset transitions restores the
  current defaults; leave non-transition timers and backend timeouts unchanged.
- Smooth occupied message height, not just opacity/translation, so new prompts and
  streamed replies move the status row without a jump or overlap. Bottom-follow
  tracks already-smoothed height directly rather than adding a second lag. Keep
  pending status above the empty placeholder, preserve instant history/width reflows,
  and leave activity dropdowns outside these message-height wrappers.

- Extend the left sidebar divider from the window’s top edge to its bottom edge across the drag strip and footer. Track sidebar resizing without shifting content; the extension must not intercept pointer events or native window dragging.
- New chat connections use a centered, non-interactive animated icon above
  spotlight “Connecting...” text, without a timer or duplicate inline status.
  Reuse activity fade timing for gentle entrance/exit. Hide the empty task prompt
  until the session is ready and the loader has faded out. Preserve Cancel, errors,
  drafts, transcript layout and scroll; stop animation in hidden/reduced-motion/
  forced-color views, using a static 16px Carbon fallback.
- Resolve the shared sidebar track width on `.app`, where the live sidebar width
  override is set, rather than inheriting a root-computed track width. Navigation,
  its divider and the footer database action must all follow pointer/keyboard resize.
- Commands uses a table-controls header with an h1.table-title and New command action outside the scrolling list/editor body, so both stay visible on narrow and wide layouts.
- Include bundled commands in the orchestrator picker and command recognition through availableCommands, with saved commands taking precedence. Built-ins are not editable database rows or counted against the saved-command limit.

- Animate sidebar disclosure groups (Chat, Tables, Settings, Advanced, Experiments
  and owned workers) with a 20ms delay and the shared 175ms height/opacity transition.
  Keep children mounted, closed groups immediately inert and ARIA-hidden, and
  rapid reversals continuous. Reduced motion and forced colors skip the transition
  and delay; reveal focused destinations immediately without clipping them.
  Preserve saved expansion, external reveals, keyboard navigation and
  selected-row fills. Regular and primary button borders must not change on
  mouse down; keep pressed fills and visible keyboard focus.

- Left-navigation fills and shared right-panel tab fills use the same 20ms delay
  and 175ms background fade on hover and off hover, except reduced motion and
  forced colors make them instant. Keep keyboard focus immediate. Paint each
  right-panel tab's selected/hovered background underneath its label and Close
  action; both controls stay separate and transparent, with glyph-only icon focus.
- Give human prompt bubbles in both chats 5px corners, excluding automatic prompts
  and agent code blocks. Add a theme-aware 1px horizontal separator after completed
  turn timing notices, outside activity disclosure buttons and absent for active
  timers. Both composers keep a theme-aware 1px outer shadow on focus as well as
  at rest, with minimal paint gutters to prevent clipping and no focus geometry
  changes. In forced colors, omit the shadow and retain system-colored borders.

- Reserve stable vertical scrollbar gutters on every native scrolling surface,
  including textareas, dialogs, menus, navigation, settings, files, plans, Tactics
  and Glide scrollers, so overflow and width-dependent wrapping never shift the
  content sideways. Keep the property beside the overflow declaration, and reset
  it on clipped dialog/page frames. Horizontal tab strips, table control groups,
  workflow diagrams and code/table blocks reserve their scrollbar height too.
  Preserve scrolling and keyboard access rather than hiding scrollbars; leave
  Monaco's overlay-scrollbar layout under Monaco's control. Apply in both themes
  and forced colors.
