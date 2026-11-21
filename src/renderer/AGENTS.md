# Renderer

- System Manager labels the Scheduling Service and reads its typed native/live
  status through the existing scheduler/status request. Distinguish Not installed,
  Stopped and Running with dashed/solid/blue badges, icons and Install/Start/Stop.
  Keep job pause and active-run annotations separate. Do not guess lifecycle
  actions for checking/unavailable status; explicit Repair stays in Service options.
  Standalone live schedulers offer Install, never native Stop. Keep the last verified
  badge during actions, disable competing controls and refresh afterward. Preserve
  hidden-read cleanup, coalescing and stale-response guards. Use square outlines,
  hard panel shadows, saved role typography, dark reading fills and forced colors.
  Stop is the main installed/running action; omit the separate pause-and-cancel
  control. Keep Resume jobs for existing paused jobs after Start. Backend Stop
  retains its pause, cancellation, ownership checks and confirmation behavior.
  Poll status two seconds after completion while the page and document are visible,
  respecting global Pause polling. Back off failures/unavailable status to sixty
  seconds at most, resetting after recovery. Coalesce background reads without
  dimming controls or clearing action failures; discard replies across visibility
  changes. Dispose timers on pause, page hide and unmount. Initial/manual reads
  still work while paused; no new polling key, setting or bridge method.

- Settings → Memory is application-wide and database-independent. Persist its
  controls through main, not local storage. Expose only the application-wide
  Memory On/Off switch, immediate-save retention selector and Manage memories
  navigation to the shared Data Viewer. No daily learning allowance, pipeline,
  role/type/conversation switches or context tuning controls. Explain provider
  usage, independent conversation continuity and privacy limits in the Memory
  switch’s accessible description; retain scope and retention information tips.
  Show search repair only on an actual indexing failure.
- The Memories browser pages main-owned records, filters by project/type/state
  and is also available as a database-independent shared table under Apps →
  Data Viewer → Memories, with the grid-nine icon. Keep its cursor pages bounded;
  keep store-wide selectors beside the title, apart from page-local table controls.
  Preserve filters and paging across navigation, defer hidden reads and reuse
  the existing evidence inspector and revision-checked actions.
  Memory details use a single reading column: readable attribute tags, editable
  memory text, named project/conversation facts, formatted dates and recall status,
  attributed evidence quotes, expandable source messages with cited text marked,
  and newest-first revision history. Keep raw IDs and extraction offsets out of
  the presentation. Use a compact modal with a sticky action row; Save changes
  stays disabled until the text or pin choice changes.
  Render evidence/revisions as text. Use pushed notices and stale-response
  guards, never polling. Human edits, pinning, conflict resolution, promotion and
  forgetting must use revision-checked bridge actions; global sharing and
  forgetting remain natively confirmed. Memory used notes belong to their turn.
- Memory Recall is a read-only shared sidebar tab for the displayed Relay,
  project or worker chat, including Relay workers without a database. Validate
  IDs from turn-associated Memory used notes only; never retrieve or browse.
  Page all available recall turns, retain current/zero-hit turn indicators, and
  label edited/unavailable records and malformed notes. Omit introductory and
  source-history gap copy from the tab. Read only while
  selected and visible, with bounded caches/concurrency, pushed notices and full
  owner/generation stale-result rejection. No automatic opening or focus changes.
  Awareness receives only tab metadata, never recalled memory or evidence text.

- Relay is application-owned, database-independent and singleton. Its history,
  draft and selected identity must not inherit a database/project view lifetime.
  Relay never offers New global chat, rename or archive. Connection Retry does
  not resume tasks. Show the live conversation without a separate historical
  transcript panel, history paging buttons or historical message Copy controls.
  Its file panel must not silently follow the selected project; hide that panel
  until an explicit Relay workspace/target view is selected.
- Show unavailable Relay history saving as a nonblocking status warning:
  “History isn’t being saved. Recent messages may be unavailable after restart.”
  Keep it separate from connection errors and activity state. An absent
  historySaving field needs no warning.
- Relay file roots use the workspace/opaque-target choices supplied by main.
  Bind each visible file context to its detail subscription and increasing
  sequence; never synthesize a project FileContext or send an absolute root.
  Keep Relay tabs and file state outside database/project lifetimes.
- Retained inactive panels keep their content but expose no toggle action. Only
  the active panel offers a Files toggle, including Relay without a database.
- Relay Changes groups bounded review pages by target and labels direct edits
  separately. Send only opaque review/revision/file IDs with its captured Relay
  generation. Keep historical evidence read-only, without historical execution
  or automatic integration. Preserve explicit interrupted-journal recovery. Read
  review details only while requested and active; revision hints are not payloads.
- Project chats and Relay use one composer and ordinary-chat corrections, not
  feedback forms, line inputs, checklists or Apply controls. Retain plan and
  permission approval. Show one quiet files-changed link per request; zero-edit
  requests have no empty card. Open pinned read-only diffs only on user action.
  Keep metadata reads bounded and visible-only; Changes retains older snapshots.
  Partial work and failures remain explicit and never imply success.
- Diff selection offers Add to chat with a removable exact review/revision/file/
  side/line reference, without replacing a draft, sending or stealing focus.
  Undo appears beside Copy on the latest user message on hover and keyboard
  focus. Route confirmation/restoration through main; restore its returned
  request unsent while preserving newer draft edits. Direct-folder snapshots
  must warn that Undo also rewinds manual edits. Interrupted Undo blocks Send
  until explicit recovery. Rewind revisions invalidate stale transcript caches.

- When `openProjects` is present, project-instance identities supersede the old
  single-project disposal rules below. Retain each open project's views on
  navigation; dispose only on actual close or database-instance replacement.
  Project accordions contain project-bound chats and workers. Each project row has a circular + (New Session), red × (Stop Folder)
  and circular disclosure chevron, in that order. Selecting a project never retargets Relay.
  Closing a project and stopping a folder remain distinct backend operations.
  Project rows expose only a red circular × with the tooltip “Close Project” and
  a path-qualified accessible name. Invoke stop-folder with its existing native
  confirmation; retain the project and its saved history. Remove the project
  More menu. Other folders continue; conversation More menus stay independent.
- Show only Relay and project-bound conversations, not database-wide legacy chats.
  Put Home first in the sidebar’s page list, followed by Search, Assistants, Projects,
  Providers, Apps and Settings. The Assistants heading opens a database-independent home with
  exactly Relay and Custom Assistants cards, using the shared Home card layout,
  artwork, pending/error handling and existing destinations. Add no greeting there.
  Keep their Home cards and link assistant breadcrumbs through Assistants. Remember its
  expansion locally, keep closed contents inert, close nested disclosures on collapse,
  and reveal the group for explicit assistant navigation. Never change selection
  or execution ownership just by opening or closing it.
  Home uses a Phosphor house icon and a standard table-controls page heading.
  Show “Welcome to Code60” above its cards, centered with the card group in the
  same scrollable content. Do not add this greeting to other navigation homes.
  Show exactly six clickable, title-only feature cards in this order:
  Relay, Custom Assistants, Search, Projects, Apps and Sessions. Use theme-aware
  artwork, restrained blue accents, shared focus styles and responsive stacking. Relay selects the
  application conversation and clears worker selection. Search and Sessions retain
  database gating; Custom Assistants, Projects and Apps remain available without a database.
  The Custom Assistants card opens management without opening a chat or connecting an agent.
  Keep errors inline and prevent duplicate Relay selections.
  Keep the existing startup destination. Remove the sidebar wordmark, retaining
  the splash wordmark. Search is a regular labelled page tab with the same selected,
  disabled and arrow-key behavior as the other destinations, not a utility action.
  Give it the custom race track icon at 1.25em, with 12-unit track edges and
  enlarged cars, animated only during active work. Its track and edges are black
  in Light and gray (#aaaaaa) in Dark/System dark; preserve system colors in
  forced-colors mode. Reserve enough shared gutter
  and row height for it as text grows. Use shared 24px indentation steps for
  project chats and owned workers, inside labels rather than padded containers.
  Project labels navigate home without toggling. Keep +, red × and chevron
  independent; + creates a session without changing expansion. Only explicit
  chevron activation changes the project disclosure; navigation and ancestor
  hiding preserve its state.
  Reuse anchored menu behavior for conversations, including bounds, dismissal and keyboard focus.
  The Projects heading has a circular Carbon plus action labelled “Add Project”,
  immediately left of its circular disclosure chevron. It opens the existing project
  picker or database connection flow when disconnected. Keep it outside the
  disclosure, available when collapsed and in keyboard order.

- Projects and individual project homes use a first-position creation card,
  labelled New Project or New Session with a decorative Carbon plus, instead of a
  page-header plus button. Match normal card width/corners, use a thick 3px dashed
  border without gradient artwork or a corner arrow, and center the label.
  Keep these cards present for empty lists, keyboard-native and disabled while
  navigation is pending. New Project uses the existing database/project picker;
  New Session captures its rendered project ID. Preserve sidebar add controls,
  retained view state, errors, database gates and main-process ownership.

## Visual restraint

- Translate newly selected page content over the shared 175ms motion duration,
  keeping its card fully opaque. Include Settings sub-pages, projects and conversation switches.
  Never remount retained views, delay navigation or reset drafts, scroll or focus.
  Skip first render, splash, hidden/inert views, reduced motion and forced colors;
  cancel on rapid navigation, document hiding, preference changes and disposal.

- Position the navigation toggle in the native-control row, vertically centered
  with the OS window controls and outside the inert navigation. Clear the native
  controls by at least 80px on the left, honoring wider native-control insets.
  Keep the toggle non-draggable and clickable in transparent windows, without
  shifting sidebar content or page elements. Center the trail inside its content-aligned
  card while the sidebar is closed; retain its shared content track when open.
  Its resting glyph uses the same muted color
  and opacity as the footer return/database actions. Collapsing a navigation
  accordion recursively closes worker/page descendants without changing selection;
  individual project lists retain their explicit chevron state while hidden.
  Reopening does not restore child expansions; explicit destination navigation
  still reveals its ancestors. Relay selection never reveals project chats.
  Preserve project/chat text color on press and selection, and do not briefly
  disable or dim unrelated rows during guarded asynchronous selection.

- Workspace content reserves its measured preceding height again for its header,
  including a wrapped database notice. Observe strip/notice/window resizing, avoid
  redundant style writes and disconnect on disposal. The sidebar starts immediately
  below the native drag strip/notice with no extra top padding; its first card keeps
  only its normal 6px outer margin. Span the sidebar across both workspace rows; keep the
  breadcrumb header in the content column so its artwork and wrapping cannot
  move navigation. Align the first breadcrumb row's icon centers with the sidebar
  Home icon using its shared row height and 12px card-heading inset. Enclose the
  breadcrumbs in an opaque theme-surface card spanning the content column, with a
  a 2px outline, 5px corners and the shared hard shadow. Use the same solid
  theme surface as sidebar cards through `--card-header-fill`. Keep the header above the content in normal
  flow on all pages, including Chat; content must never scroll beneath the card.
  Use 6px outer vertical spacing and 6px inner vertical padding
  to retain icon alignment; keep wrapping and focus outlines unclipped,
  and use Canvas/CanvasText in forced colors.
  While Chat is active, track the actual conversation column with a ResizeObserver
  so the breadcrumb card ends at the conversation edge before the right-panel gap through opening, closing,
  dragging and sidebar/window resizing. Restore full width for stacked panels or
  other pages. Read geometry only on resize/media changes; disconnect observers,
  remove listeners and clear workspace geometry when Chat hides or disposes.
  Observe header resizing too and measure the open right panel's upward extension
  from the chat body to the breadcrumb card top. Above 1200px, let only the right
  card extend into that reserved area, keeping its top aligned with the card and
  its bottom at the footer inset. Preserve transcript clipping and normal-flow
  chat positioning. Stacked panels retain their gap above and no upward extension.
  Reserve header space in normal flow; wrapping and oversized artwork never
  shift the sidebar. Disable scroll anchoring in the tab list and avoid refocusing
  an already focused destination. Preserve keyboard and external destination reveal.
  Move only the active breadcrumb trail into the workspace header. Its original
  inert, ID-free marker uses display:none, reserving no title space inside Search,
  app homes, tables, Settings or chat. Collapse title-only table and Settings
  headers; preserve tooltips and page actions in compact rows. Hidden retained views must
  never publish into the header; disconnect visibility observers on disposal.
  Feature pages add no extra top padding. Align header contents to the top so
  small title sizes and taller actions do not shift titles. Put project-readiness
  notices below chat headers, not above them.
- Scheduled Jobs uses local Neobrutalism accordions for jobs and a table for
  Execution history. Align Schedules and Actions with a 16px top inset; Actions
  contains New scheduled job/Refresh, and creation/editing stays inline.
  Order independent run/cancel, delete and disclosure controls in DOM and visually.
  Use 24px transparent circles in 28px targets with black outlines, 2px hard
  shadows, 1px press offsets and contrasting glyphs. Only the final chevron toggles
  details; the noninteractive title labels the panel. Paint hover on the full
  stationary header; skip generic header scaling. Fit 3px inner corners to the
  outer 5px/2px frame and square lower corners while expanded without clipping focus.
  Omit the agent/status/next-run subtitle; show `(Paused)` beside disabled schedules,
  independently of manual execution. The live pause glyph retains Stop/cancel
  behavior; its pulse is static for reduced motion and forced colors. Preserve
  independent focus, narrow wrapping and system fills/outlines without shadows.
  Load details only for an expanded active job. Keep recurrence enable/pause
  independent, with original native deletion consent, active-run refusal,
  revision checks, history and service ownership. Update self-knowledge for the
  workflow; styling adds no further capability, setting, bridge or stored format.
- Navigation cards use a fixed 224px width, 36px artwork, 18px default titles and
  32px gaps as columns wrap. Scale the independent Card Titles role by 9/11,
  with an 8px minimum; preserve saved text choices.
  Do not stretch one- or two-column rows. Content page headers reserve 24px below
  their heading/actions; navigation-card and chat headers keep their own spacing.
- Polling settings retain the normal 640px centered reading column even inside
  the database-dependent fieldset; preserve that fieldset's disabled semantics.
- Shared click feedback presses in 60ms and releases in 90ms, without delaying
  actions. Animate only the glyph of icon actions, keep inline links in text flow,
  and skip disabled/inert controls, reduced motion and forced colors. Cancel on
  blur, drag, pointer cancellation, hidden documents and disposal.
- Sidebar press feedback animates glyphs, not row backgrounds or click targets.
  Selected rows use their background fill without an accent edge or border.
  Preserve keyboard-focus and forced-color outlines. Add 15px of internal left
  padding to each item's shared icon/text inset, preserving hierarchy and the
  icon-to-label gap without moving its selection fill.
- Give each sidebar navigation row 2.5px of bottom margin, including nested rows
  and creation actions. Apply the margin once per visible row, keeping grouped
  heading wrappers from adding duplicate space. Add 3px before each card's second
  row for a 5.5px first-to-second gap; collapsed groups add no space. Preserve shared fixed row heights: 40px at default text size, with 2px vertical
  item padding. Grow rows for the largest 2.5em sidebar icons plus their borders
  at larger navigation text sizes; selection must never change row height.
- Sidebar buttons, hover fills and selected rows have square corners. In each foreground
  card, all visible rows have square corners. Update
  these edges on nested disclosure and row changes, and disconnect observers on disposal.
  The external toggle and other buttons retain their square corners. Animate the registered reveal progress and sidebar fade over
  the shared motion duration, not the saved width itself, so resizing stays
  immediate. Keep closing contents painted until visibility settles, but inert
  and aria-hidden immediately. Do not generate a sidebar divider in either state.
- Assistants, Apps, Projects and Settings each have an opaque sidebar card enclosing their heading,
  actions and expanded descendants. Use the local Neobrutalism Card primitive for all
  five groups: theme surface, 2px outline, 5px corners and hard offset shadow. Keep
  a 4px inset so border + padding retains the existing 6px row offset; compensate
  the absolute header-action offsets too. Sidebar opacity and blur affect only the
  background behind the opaque cards.
  Give sidebar card headers, main navigation-card artwork, breadcrumbs and the
  right-panel tab header the same solid `--card-header-fill` (the theme surface),
  with opaque descendants and Canvas in forced colors.
  Trim the last row's 2.5px margin at the card boundary, including nested or
  collapsed disclosures, so top and bottom inner padding both remain 6px.
  Keep fixed row heights, disclosure controls and keyboard navigation intact.
  CSS reversals follow the latest state; reduced motion/forced colors skip motion.
  Home and Search share one matching opaque card above these sections, with the
  same 5px corners, balanced combined 6px border/padding offset and 5.5px spacing between their rows.
  Use 8px top and 3px bottom card margins for an 11px gap; retain the first card's
  6px top margin to keep Home aligned with the breadcrumb header.
  Each card has a dedicated top-right chevron button with a state-specific accessible
  name, aria-expanded and aria-controls. Only that button toggles on click; Home,
  Projects, Apps and Settings headings navigate without changing expansion, and
  Assistants also opens its home. Preserve keyboard Left/Right disclosure and
  descendant reveal on explicit navigation. Home/Search also collapses Search and
  persists its expansion. Keep collapsed descendants mounted but inert/hidden;
  recursively close nested disclosures. Rotate the chevron over the shared motion
  duration, give its glyph a solid primary-color backplate on hover/focus/press,
  and use shared glyph-only press feedback. Keep aria-labels but suppress native
  titles and shared tooltips on these chevrons with an empty data-tooltip. Use
  Highlight/HighlightText for the backplate in forced colors.
  Respect reduced motion/forced colors and keep header row geometry fixed.

- Prefer quiet, professional layouts over explanatory copy. Do not add sentences
  that explain how a page, filter or control works; name things clearly and use
  an InfoTip only for setting consequences that users must understand.
- Page and table toolbars use borderless Carbon icon actions (`icon-button`)
  with accessible labels that the shared tooltip displays. Keep a native select
  as the accessible control behind the Columns glyph. Active saved/column filters
  appear as removable chips. Server-paged tables use the shared `TablePager`.
- Shared tooltips snapshot ancestor scroll positions when hover/focus begins.
  Ignore queued notifications for unchanged positions; actual scrolling still
  dismisses them. Preserve Escape, press, leave and focus cleanup, including a
  cancelled pending reveal. This reliability fix adds no capability or catalog entry.
- Disabled controls are dimmed with solid borders: no hatching or dashed
  outlines. Unavailable sidebar destinations are dimmed labels without outlines.
- The database notice is one compact status row with its connect action.

- Keep labelled Back and Forward icon buttons in the title bar beside the sidebar toggle, backed by `navigation-history.ts` and `history-navigation.ts`. Record destinations (page, Settings page, or conversation ID for orchestrator, Relay and worker chats) by observing state, never by instrumenting each entry point. Wrap orchestrator selection that completes in the main process with `expect`, listing the destinations it passes through; anything else is the user moving on and is recorded at once. Arriving at a history entry updates it in place. Restore chats through the existing selection paths, skip a slow restore that a newer navigation superseded, skip unavailable chats, reuse `pageAvailable`, and keep history in memory only.

## Ownership and style boundaries

- Keep `main.tsx` as bootstrap and `App` as composition, not another monolithic
  hook. Inject the desktop API. Use focused snapshot, preference, window,
  visibility and splash lifecycles.
- Application services outlive projects. Database conversations/events and
  Command Builder/Prompt Builder drafts survive same-database project replacement.
  Project-instance state owns worker views, file tabs/reads, transcript caches,
  table selections, menus and project dialogs. Keep form/draft/scroll state local.
- Hiding a page/panel or returning to splash is activation, not disposal.
  Replacing today's single project disposes its scope. Use generation captures,
  not path equality alone, for delayed reads/actions, including A → B → A.
  Capture execution identity before awaiting. Disposal must not replay actions,
  stop backend workers or delete persisted history. Do not add a project cache
  or claim multi-project backend authority.
- Page titles use `PageTitle` breadcrumbs derived from the existing navigation tree.
  Use chevrons and keyboard-accessible parent buttons wired to the shared navigation
  actions. Retain the matching navigation icon on every breadcrumb item. Show
  the Home root as an icon-only parent with an accessible Home name, without
  duplicating it on Home itself. Home's current heading is also icon-only with
  screen-reader text. Keep the sidebar toggle visually in the native-control row,
  outside the inert navigation. Sidebar and main content share two
  columns; never reserve a narrow content column for the toggle.
  Render Relay as plain title text, not a disabled rename button that compounds
  title opacity. In breadcrumbs, label agent chats “Agent” and worker chats
  “Subagent”, including “Agent” as the parent of a worker. Keep Relay named Relay.
  Preserve actual titles in sidebar rows, saved records and rename dialogs, and
  retain the existing rename button action and owner identity. Project rename
  actions remain independent.
  Size chevrons at 1em. Keep title rename buttons unpadded, without a minimum control
  height, so Relay and orchestrator labels retain the standard 8px icon gap.
  Keep only the current leaf as the heading; preserve icons, rename actions,
  title typography, native no-drag links and responsive wrapping. Underline the
  current text (or the icon-only Home heading) and center-align breadcrumb items
  so leaf text and parent text share a horizontal line, including rename controls.
  Resolve dynamic
  ancestry from the rendered conversation identity and registered ownership, never
  the selected project. Secondary section/file/history headings are not page trails.
- Derive static navigation metadata from `navigation.ts` and keep page rendering
  exhaustive. Dynamic conversation identities are not static pages.
- Share message presentation and exact-source draft mechanics. Keep orchestrator
  and worker action/recovery lifecycles separate.
- Do not show the synthetic “the owning process (PID …) is gone” interruption
  reason as a chat warning. Preserve recorded history, recovery checks and real
  provider, process, storage and transcript-read errors in both chat interfaces.
- `style.css` owns only imports and ordered layers: vendor, tokens, base, layout,
  components, utilities, accessibility. Put rules beside their feature owner in
  `styles/`; reconcile existing declarations instead of adding late corrections.
  Only the shared layout sheet places outer page panels in the workspace grid.
  Chat uses the same flexible content track as other pages; the toggle is in the
  header, not its own track. Feature sheets must not override page placement.
  Keep the selected `data-theme` distinct from resolved `data-color-scheme`.
  Use the resolved attribute for the single dark palette and artwork. Import
  Glide CSS in the vendor layer. Scope runtime Monaco overrides to its internals.
  Never restore a universal important radius reset or global rounding patch.
- RAG is a manual, database-wide snapshot experiment under Advanced → Experiments.
  About shows main-owned configured embedding identity/revision/dimensions/
  precision and the installed ONNX Runtime package name/version and CPU execution
  details, including Copy version info. Do not initialize inference to show About.
  Preserve query/results across page switches, reset on database replacement,
  reject stale replies and use pushed progress, never polling. Show retrieved
  chunks as safe text with provenance and cosine scores, not confidence claims.
  Use the shared Settings cards and information-tip pattern.

- Tactics opens only from the orchestrator composer. Use the bundled browser-safe
  catalog as React/text, never prototype HTML/scripts. Preview does not apply;
  Apply persists before closing, Remove explicitly clears, and neither sends or
  changes the draft. Keep search/keyboard/focus behavior accessible, full/shared
  prompt disclosures readable, and Apply reachable in narrow layouts. Pass only
  chat/project identity and tactic ID/null through the validated action. Saved
  chats remain stopped until Send. Omit New session, Continue task and the
  saved-chat-stopped warning from Chat. Preserve database connection, Cancel,
  Relay Retry connection, connection errors and current history-saving warnings.

- Orchestrator and worker chats use distinct message bubbles: human fills are pale blue in Light and plum in Dark; agent fills are warm neutral in Light and olive-charcoal in Dark, with contrasting text. Activity/tool disclosures remain distinct. Copy uses a 16px Carbon icon without a fill or border, outside message bubbles, with glyph highlighting on keyboard focus and a 24px hit target. Keep a single resizable file panel after the conversation, opening at 20% of Chat width with a 120px panel minimum and 300px conversation minimum, stacking below Chat at 1200px and below. In the stacked layout, size the conversation for its visible notices, approvals and complete composer, with a 300px conversation minimum and a 120px independently scrolling transcript minimum. Enclose it in an opaque card with a 2px outline, the shared hard shadow, 5px corners and a 12px gap from the conversation/breadcrumb column. The gap moves above the panel when stacked and collapses to zero when closed. Include the gap in both CSS and pointer/keyboard resize bounds to preserve the 300px conversation minimum. Give the tab-header row the same solid `--card-header-fill` as sidebar cards, using Canvas in forced colors. Keep the resize grip transparent so it does not mask that row. Keep content and Monaco on the main app surface, and a Carbon drawer toggle inside the tab header. Close to zero width with no divider or rail, and zero height on narrow layouts. Show the reopening icon at the chat area's top right when closed, reserving header space so actions do not overlap it. Keep hidden contents inert; preserve toggle focus, tabs, preview state and expanded width. Animate expansion/closing with reduced-motion support. Keep the resize grip borderless at rest, with visible keyboard focus.
- Conversation rows show numeric unread and approval counts, not visible activity, completion or error labels. Keep status in accessible descriptions and tooltips. Keep counts in a separate reserved column; ellipsize names before they overlap those indicators. Count each turn once at its first nonempty agent text. Opening Chat marks all present replies read regardless of scroll; open-chat streams stay read. Persist only database/run-scoped read markers in session storage, never message content; use pushed events without polling or new IPC.

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
- Support Light, Dark and System appearance and the existing opt-in Signal colors.
  Use the palette, square geometry, hard shadows and focus rules in
  [Neo-brutalist presentation](#neo-brutalist-presentation). Preserve native
  window geometry, the chamfered wordmark and independent sidebar transparency.

- Give every independent icon action the shared `icon-button` class: no border, shadow or background fill in resting, hovered, pressed or disabled states; hover and focus highlight only the glyph, with no focus outline even when Focus highlight border is enabled. Preserve hit targets, accessible labels, disabled semantics and visible keyboard focus. Decorative icons in labeled buttons, rows and menus inherit their parent state, never their own hover. Close, add and drag actions remain separate controls even when visually inside a tab or row.
- Use the 16px Carbon icons from `icons.tsx` (`Icon` in the DOM, `drawIcon` on canvas), except the Phosphor duotone sidebar icons from `navigation-icons.tsx`, animated conversation role icons and 8px static activity fallbacks, instead of text glyphs such as ×, ↑, or ▾. Write run states with `statusSpec` labels and, outside the left sidebar, icons; nothing blinks.
- Apply the seven text roles (table headings, buttons, agent messages, human messages, page titles, card titles, and normal text) through their CSS properties and the canvas table theme. Page titles default to Space Grotesk Bold (700) at 16px; card titles also use Space Grotesk Bold. Body/chat use IBM Plex Sans Regular (400); controls/table headings use IBM Plex Sans Semibold (600); card titles use 22px and independent settings, never page-title settings. All roles preserve sentence case by default. Offer Light (300) and bundle its normal and italic IBM Plex faces locally. Text sizes accept 8–64px. Left navigation labels default to 15px; other buttons retain their 13px default. An explicit Button Text size controls both, including an explicit 13px choice; resetting it restores the separate defaults. Preserve saved role choices and existing migration markers when changing defaults, without another appearance reset. Avoid hard-coded bold or selected-state weight changes. Keep code and diffs monospace and case-preserving. The shared Code60 wordmark uses D-DIN Regular independently of text-role choices; preserve its blue chamfered 60 block and the D-DIN splash subtitle. Bundle fonts locally and retain their licenses; keep `font-src 'self'`.
- Get external data from snapshots and request reads with `poll`; do not start timers that fetch data. Use `useTicker` from `ticker.ts` for clock-only redraws, inside the smallest component that needs it, and report visibility with `setVisibility`.
- Keep Glide Data Grid imports in the renderer. Import its bundled CSS and pass theme colors resolved from the app's CSS variables, since the grid draws on a canvas; do not inject styles or weaken the Content Security Policy. Preserve row selection by session ID across sorting and data updates, and support clicking a row or pressing Enter on a cell to open its chat. The Actions cell opens its session's actions menu instead; keep that menu keyboard reachable.
- Build tables with `DataTable` from `data-table.tsx`, so every table shares Glide's search, header-menu filters, add row, and per-table settings. Save table preferences by stable column ID through `useTableView`; keep ad hoc column filters in memory. Named definitions and one active selection persist by table and database/project with `saved-filters.ts`; incompatible definitions must remain visible and unapplied. Use explicit column filter types so empty tables do not change their meaning.

- Precision theme: use the square controls, outlined panels and solid offset shadows
  defined in [Neo-brutalist presentation](#neo-brutalist-presentation). Retain
  circular radio buttons and status dots; keep keyboard and system focus visible.
- Table Settings opens a native modal with draft controls and a four-row fictional Glide preview. Reuse shared canvas styling and width calculations. Apply commits once; Cancel, Escape and close discard drafts. Reset is draft-only and removes the saved override when applied without further edits. Keep at least one data column visible, including when chart columns are turned off. Restore trigger focus, keep the header/footer visible, use two-column display toggles without row dividers, and discard drafts on workspace replacement. Put column visibility toggles in a closed-by-default dropdown above the orange dotted preview frame; Escape dismisses that dropdown before the modal. Scrollbars should remain subtle in both themes, with stronger hover contrast and system colors in forced-color mode.

- All Settings pages use 10px card corners through `--settings-card-radius`, including shared cards and fieldset groups. Table defaults uses a 5px High/Medium/Low selector, with 4px inner end corners to follow its 1px border. Keep other segmented groups unchanged and preserve focus outlines.
- Default all tables to Low density (44px rows), with row, column and heading lines off; preserve saved global and per-table settings. Use white headers and rows in Light, muted blue `#253347` headers over charcoal `#252525` rows in Dark, and resolved CSS colors in Glide. Preserve explicit labels when colors change or forced colors apply.
- Messages, Events and worker views use the project-scoped `useTranscripts` cache. Search instead owns a connected-database request: include all registered projects without opening them, preserve query/results/overview through page and project selection, and load immutable globally ranked pages of 100 through opaque cursors. Show project-qualified results/citations and concise partial warnings. Main resolves source identity and confirms closed-project opening before navigation; archived results stay read-only. Overview requests reference captured evidence, never renderer excerpts. Database replacement/clear/unmount retire requests; provider changes cancel only overview generation.

- Use one application footer across the full window bottom without a top border, with a 20px default content height and 4px bottom padding, lifting all compact vertically centered controls above the window edge. Vertically center the last-seen icon/text at its left; only activating it opens a modal with Pause/Start and Refresh polling controls. Keep updates and an actionable pending-approval count in the footer, with the full runtime version at its bottom right. Give polling controls centered equal-width buttons and a 200px minimum dialog height bounded by the viewport. Give last-seen and harness-mode triggers 12px horizontal padding. Keep page panels free of internal footer space and treat the footer as opaque during transparent-window hit testing.

- Keep the selected conversation's agent-message age inside the vertically centered footer trigger. Dark footer surfaces are black.
- Match the resting Last Message, return and database glyphs to the footer text.
  Independent actions retain shared glyph highlighting and disabled semantics.

- Enclose repository identity and page navigation in one square-edged sidebar without borders or divider overlays, with rows filling the navigation area inside a 12px right gutter and wider in-row label indents. Align its top and bottom with the desktop right file panel, leaving the shared 12px bottom inset above the footer. Keep the native-control drag strip separate, without extending the sidebar fill into it. Place a labelled icon toggle in the native-control row, outside the sidebar; keep the breadcrumb header in the same content grid column through opening and closing, driven by the shared sidebar reveal animation; center the trail inside its card when closed. Match the main card edges without discrete column or negative-margin changes, preserving the measured inspector inset. Remember open/closed state locally; collapse its track to zero and make the mounted navigation inert and hidden, without disposing drafts, selection, scroll, disclosures or saved width. Keep the toggle and footer actions reachable when closed. Do not add hover expansion. Provide a borderless right-edge resize handle with visible keyboard focus and Left/Right adjustment. Default to 220px, constrain to 180–480px while reserving content space, and remember the width locally. Preserve navigation, conversations, drafts and disclosure state when resizing. Keep matching 12px workspace insets. Resting labeled controls match the sidebar fill. Enabled hover uses blue. Mark the selected page with a contrasting fill and accessible selection state, without an underline or bottom border. Preserve system selection outlines in forced colors. The tab list scrolls within the available height and uses the full sidebar width. Its full left background region, including gaps between buttons, remains interactive in transparent windows even at zero background opacity.

- Use the labour-day animation for project orchestrator conversations and the drone animation for workers. The top-level Relay item uses its own icon. Use local Phosphor duotone icons for pages and navigation groups and the folder animation for each project accordion. Clicking the project name selects its home without changing its accordion. Only its dedicated chevron changes expansion; row background clicks do not toggle. Preserve the official paths and 20% secondary layer from @phosphor-icons/core 2.1.1, its MIT license/provenance, and the CSP without adding a dependency or runtime fetch. Let decorative icons inherit the label color, including hover, selection and forced colors. Keep these SVGs non-focusable, with an 8px label gap and at least 12px of leading space. Expand the gutter and shared 40px rows together only for larger saved text, retaining hierarchy alignment and avoiding clipping; clicking never resizes a row. Center the project selector with equal horizontal padding. Size Carbon chevrons and action glyphs to match navigation text. Keep chevrons on the dedicated sidebar-card and project disclosure controls, with accessible names. Use labels for nested page-group disclosures, including Settings; use the dedicated circular chevron for project disclosures; retain aria-expanded, arrow-key controls and motion. Use a separate agent-icon toggle for owned workers so collapsing them preserves the open conversation. More uses the horizontal overflow icon, with labelled `icon-button` controls for independent actions. New chat uses a separate labelled Carbon plus action. Stack sidebar rows without gaps, preserving labels, keyboard order, selection, disclosure semantics, unread counts, errors and approvals. The application footer database icon remains separate.

- Show the shared Code60 auto-approval toggle beside the harness mode dropdown in orchestration chats and their workers. Keep it available during a turn. Manual runs retain their own approval policy.
- Providers exposes the shared setup wizard through Add Provider. Present bundled logos and alphabetical Antigravity, Claude, Codex, Copilot, Droid, Kiro and OpenCode choices as agent cards that immediately start detection and connection on click or Enter/Space, never radio inputs or a separate Continue step. Use compact wizard typography (16px headings, 13px body and controls), independent of larger page-title settings. Keep arrow/Home/End focus navigation and Enter/Space selection. Select primary first, detect, connect and save automatically through the existing finish action, without further confirmation or review steps. Keep the result open with Close and optional Add another agent; failures offer Close and Retry, including save retry without another probe. Each addition starts a new add transaction so dismissal cannot undo earlier successes. Show only Detected and Connected as agent statuses; use separate progress and error messages with retry/cancel controls. Preserve native keyboard navigation, live progress announcements, shared text-role and theme tokens, and reduced-motion support. Persist no verification in renderer storage.

- Require completed main-process setup before splash entry, including renderer reloads and existing installations. Dismissing unverified setup leaves entry blocked. Render the recoverable main-process session and commit automatically through finishAgentSetup after successful verification. Membership is configured, not a permanently live connection. Share the application's saved Light, Dark or System appearance with the splash. Keep an upper-right Light/Dark button group that selects and saves the application theme, reflects System appearance changes until an explicit selection, and stays non-draggable above the content, painted after the drag strip. Use solid white surfaces with black lettering in Light. Dark/System dark use a solid dark surface with white lettering. Do not add a background selector or read/write the legacy `code60.splashBackground` key. Use locally bundled D-DIN Regular (400) for the shared wordmark, preserving its transparent backing and theme-blue chamfered 60 block. Horizontally center the wordmark and the exact subtitle "v0.2 Paddock (Beta)" as one group, lifted up to 48px above the logo area's center, with the subtitle below in regular 18px D-DIN and its exact case preserved. Reduce that lift on short panels instead of overlapping the database notice or other controls. Use the subtitle as the dialog description and reveal both together only when ready. Keep sidebar text and path labels fully opaque, with transparent resting control fills. After setup, show a single Start button centered beneath the wordmark and subtitle. Do not show project selection on the splash; projects are opened through the Projects → Add Project action after entry. Start and Escape enter without opening or switching a project. Focus Start when configured with a database, otherwise retain the database connection focus. Preserve setup/database gates, errors, theme controls and scrolling on short windows. Only the top strip is draggable. Forced colors use system colors for the wordmark and keyboard focus.

- On the splash, disable Start only for in-flight operations, not active runs. Returning to the workspace preserves projects, chats, drafts and active work.

- Put the circular Add Project icon action immediately left of the Projects heading’s circular chevron, separate from its heading tab. Keep it available when collapsed, with its accessible name, tooltip and native keyboard activation. Each project row also has a New Session + left of its red × and a disclosure chevron right of it. Remove the duplicate New Session row. Nest labelled conversations beneath their projects. Use 2px vertical navigation padding and shared fixed 40px rows, growing together only for larger saved navigation text. Share in-flight guards and visible errors between creation and conversation selection. Remember expansion; reveal externally selected conversations. Collapse never changes the conversation. Preserve independent drafts, transcripts and scroll positions; unread and approval counts remain visible on background conversations, with status/errors in accessible descriptions and the conversation itself. No secondary sidebar or standalone Files page.

- Present orchestration Chat as a conversation: right-aligned user messages, borderless assistant replies without repeated speaker labels, inline activity dropdowns for thoughts/tools/permissions, toggled by the live animation/status or completed turn timing, and a persistent composer. Show “Give Code60 a task.” in the empty conversation view. Keep session metadata inside the shared composer footer: mode at left, then context donut/model/harness logo/Send or Stop at right. Use N/A for unavailable metadata, shared keyboard-accessible tooltips, and a custom mode menu preserving advertised option groups and idle-only changes. Keep Code60 approval policy in the mode tooltip. Keep orchestrator progress visible with an activity row below the latest transcript message, with the animation on the left and a Normal Text-weight state name on the right, with a local current-activity timer after its ellipsis. Hide idle activity entirely; keep the name left-aligned within a fixed-width area, and fade ordinary activity changes while respecting reduced motion. Expand/collapse the activity row when opening/closing. Follow transcript size changes only while the user is already following the bottom. Present waiting_for_workers as Monitoring subagents with the radar artwork. Align status text with agent reply text and keep artwork in a reserved left gutter. Activity dropdowns smoothly expand/collapse with reduced-motion support and expand fully with no nested scrolling; preserve per-turn expansion and reading position, and support keyboard toggle/Escape. Composer and sidebar entries have no striped loader; replace Send with Stop during a turn. Errors stay outside collapsed activity.

- Plan tabs are plain React DOM, never a Markdown renderer or webview. Keep progress and actions in the toolbar outside the document. Task rows use a grid whose checkbox and status cells are one line box tall, so they stay centred on the first text line at any size or wrap; notes align with the task text. Completion checkboxes stay disabled indicators without the unavailable-control hatching.
- New and revised draft plans open in the existing side panel. Do not duplicate
  those tabs with Plan buttons in the chat header. Preserve plan progress,
  acceptance, revision, persistence and tab-closing behavior.
- Paint each conversation label, ellipsis action and worker disclosure on one
  square outer row background with straight internal seams. Keep the buttons independent, their enabled fills transparent and their
  focus, context-menu, disabled and keyboard behavior intact.

- Display automatic worker prompts as labelled activity, never as user messages. Do not show a paused-updates banner or Resume updates control in Chat; sending a message resumes delivery. Label orchestrator-owned worker chats by ownership and show the current shared approval policy. MCP contract descriptions must distinguish read-only tools from tools that change worker state.

- Group Configurations, Events, Logs, Memories, Messages, Polling, Sessions and Worktrees beneath Apps → Data Viewer. Give each child the Phosphor grid-nine icon, retaining the database icon on Data Viewer. Keep table children alphabetized and Settings last in normal navigation, without a bottom spacer. Nest Appearance, Table defaults, Text, Polling, Updates and About as individual pages beneath Settings. Build Settings pages from `SettingsHeader` (the specific page name as the sole main title at the standard upper-left inset, optional tip, page-wide actions; no extra Settings heading) and bordered `SettingsCard` rows or `settings-group` field cards, so no row or field sits outside a card; use the shared `segmented` control for short exclusive choices. Settings pages have no explanatory paragraphs: put explanations behind an `InfoTip` information button beside the setting or heading, keep them as the control's accessible description, and drop text that only restates the controls. Under Settings → Advanced, put Experiments → Episodic Memory and the sibling Contributor Tools placeholder page. Remember disclosures, reveal external destinations, and support arrow-key navigation without changing the active page on collapse.
- Logs is app-wide and available without a database. Reuse DataTable settings and
  saved filters, applying search/conditions to retained history through validated
  requests, not only the visible page. Use bounded cursors and stale-response
  rejection. Notices, never a fetch timer, drive updates. Preserve paused,
  selected, scrolled and older-page readers. Capture continues while viewing is
  paused; show pending records, retry, partial history and cursor expiry clearly.
  Details are text-only, Enter-accessible, with awaited icon-only Copy. Explain
  that diagnostic retention and Clear logs never affect transcripts or databases.
- Orchestrator rows use main-process titles with numbered fallbacks and offer Open, Rename, Archive via a labelled More icon button and keyboard-accessible context menus. The main header displays and edits the same name. Archive hides the orchestrator only, retaining session records and work. Worker rows remain accessible.

- Group prompt templates beneath a collapsible System disclosure. Keep saved edits in this group, preserve drafts on collapse, omit per-prompt Built-in labels, and use borderless items with blue hover and neutral gray selection.
- Nest Command Builder, Data Viewer and Prompt Builder under Apps, in alphabetical order. Command Builder and Prompt Builder remain disabled without a database. Data Viewer stays enabled and its Apps card opens Logs and reveals both groups. Apps uses the Phosphor app-window icon. Clicking Apps opens its database-independent home page, with a card for every nested app using shared Home card styles and each app's database gating. Clicking Apps toggles its children open and closed: opening also shows the Apps home page, while closing keeps the current page. Left/Right collapses/expands them without changing the active page. Start expanded, remember manual expansion using the existing code60.toolsExpanded key, and reveal it on external navigation to any child or Data Viewer page. Reuse the prompt-editor layout for a command list and labelled Name/Title/Description/Prompt fields, inline validation, Save/Discard and natively confirmed Delete. Preserve drafts across page and command switches, scoped to the database. The orchestrator composer alone offers a leading-dollar ARIA combobox filtered by name/title: Up/Down selects, Enter/Tab inserts and Escape dismisses without sending. Send only the recognized command name with the original text; main expands it. Mark recognized leading commands in user bubbles without changing Copy, and explain unknown dollar words as plain text. Slash-prefixed text is always plain text. Never expand commands in worker chats.
- Files uses Headless Tree and the shared read-only Monaco inspector. Keep filesystem access scoped through `setFileContext` and refreshed by the main-process Files poll source. Bundle Monaco workers and languages locally; its generated style elements use the build nonce, with `style-src-attr` allowing its per-token positioning. Never permit inline scripts or remote assets. Keep renderer-only blank, Explorer and file tabs separate from page navigation; clear them on project/database changes and reloads. Hide the panel outside Chat while preserving tabs, order, drafts and editor scroll/selection state in memory. Request filesystem context and polling visibility only for the selected Explorer/file tab while the panel is visible; discard stale reads.

- Files uses borderless page and inspector surfaces with `--chat-neutral` fill, neutral selection and blue hover. A plus immediately after the last tab creates blank tabs with a single centered, compact, left-aligned list of blank-tab choices, including Open Files and any Open Changes/saved-plan actions. Open Files replaces the blank with Explorer; multiple Explorers are allowed and share expansions and hidden-file preferences. Deduplicate file tabs by relative path. Every tab is closable and draggable; support arrow/Home/End selection, Delete close and Alt+Left/Right reorder, restoring focus after close/reorder. Closing the last tab returns to the empty panel. Keep file names and code case-preserving; resolve Monaco preview colors from the app theme tokens, including System appearance.

- Without a database, show Connect to database on the sidebar and preserve database warnings and connection controls. Relay remains available under the exceptions above. The Projects heading has a circular Add Project icon action immediately left of its circular chevron, opening the database connection flow before connection and the existing project picker afterward. Keep the list free of a duplicate Add Project row. The Open Project modal has no header bottom border, centers Open Folder below the list, and uses a labelled Carbon close icon at the upper-right of each project row for history-only removal. Keep open/remove buttons independent, with one row hover fill and no separately filled Remove region. Do not show a standalone Open Project header. Keep cancellation/errors in the modal and show a success toast after project opening. Retained projects may be opened or selected while other projects are active.

- Chat File Explorer always opens the current project root. Route legacy Files, palette and Browse project files through Chat to an existing or newly created Explorer tab; Search file sources open or select file tabs directly. Never select a worktree/private orchestration root; offer Open project when absent. Clear stale selections on project changes and discard stale reads. Put Show hidden files only in the native modal opened by the settings icon beside the Explorer title; changes apply immediately, Escape/Done closes and restores trigger focus, and workspace/page/tab changes and hiding the panel dismiss it. Do not show a Reveal in Files preview button.
- Show current-project worker sessions, including history, in the normal Chat hierarchy. Nest only known owned workers beneath their controlling orchestrator; unknown/manual sessions stay directly beneath Chat, except finished ones, which are hidden unless a current orchestrator owns them or the user opened them. Name workers, in rows and their chat heading, by the role label the orchestrator assigned at dispatch, falling back to provider / short run ID. Keep sidebar names as text beside their decorative icons, with role and status in accessible descriptions and tooltips, plus independent unread/approval counts. Separate worker disclosures expand on new children without changing selection; otherwise retain manual collapse. External navigation reveals ancestors. Preserve visible-row keyboard navigation, drafts, scroll, permissions, recovery, Copy, timing and shared file panel. No popup, dock, fullscreen, close/minimize or reorder controls. Worker selection must not change backend orchestrator selection. Load history on demand through the shared cache, never merely to populate rows.
- Use per-conversation current-project owned worker IDs for aggregate activity, not the global worker list or process existence. Keep sendability and Stop tied to the orchestrator alone.
- Both chat interfaces use shared turn timing and icon-only Carbon Copy controls with accessible labels. Show dispatch-to-completion timing with outcomes; persisted history gaps stay recorded in the snapshot without a Chat warning; current history-saving failures keep their warning. During an active orchestrator turn, use the activity animation/status/timer instead of a duplicate Working for line; retain completed Worked for summaries. Use the local ticker only in small displays, without per-tick announcements or scroll/focus changes. Copy exact message source at invocation, await clipboard success, then show “Copied.” through the shared application success toast, never a local success tooltip. Keep actionable inline failure feedback with Retry Copy. Keep the full runtime Code60 version at the bottom right of the application footer.
- Put a compact relative message age immediately before Copy, using the original prompt or first response-chunk timestamp, never replay time. Agent message ages align left with their message text and use their natural content width, without blank reserved width before Copy. Both message types share an 8px timestamp-to-button gap and 4px Copy glyph padding (12px visible text-to-icon spacing), retaining the 24px hit target. Human-message ages keep their existing reserved width and right alignment. Keep failure feedback out of flow so Copy actions, success, failure or toast dismissal/expiry do not move the icon. Fade the entire row in/out on message or controls hover, with keyboard focus also revealing it. Keep its layout space while hidden, stop local clocks in hidden chats/documents, and do not announce clock ticks. Give every mouse/keyboard Copy activation a brief glyph-only depression without moving the hit target. Respect reduced motion.

- Search shows square Type and Sort dropdowns with accessible names after the Search button, wrapping at narrow widths. Submit only on Enter or Search. Center the bundled Search GIF tinted with the current theme’s primary blue and a spotlight-animated Searching... label below the form while reads or overview generation are pending. Show AI overview paragraph placeholders followed by skeleton result rows with timestamp, title and snippet placeholders. Fade and collapse the loading content as the completed overview and results fade in. Use a static search icon, label and skeleton for reduced motion and forced colors. The overview heading appears after loading. Keep submitted criteria internal. Show an Unapplied Search Changes notification icon beside the dropdowns with a hover and keyboard-focus tooltip while draft edits are pending. Preserve filter choices when clearing the query. Capture results after database-wide reads settle, keep them stable until resubmission, and keep AI overview failures separate from usable results. Use single-column title actions and local numeric citations; never render generated markup or links. Start an overview even without literal matches, use relevant saved context for natural-language questions, and map citations to the exact returned evidence. File sources open the read-only file tab in the Chat panel. Cancel stale requests and preserve page-switch state.

- PanelShell owns only layout, tab interactions and focus; FilePanel retains file identities, reads and preview state. Keep tab descriptors stable across unrelated streamed updates. Changes lists revisions nested beneath review (task) titles, without a review dropdown. Each revision opens a separate tab deduplicated by review/revision identity. ReviewPanel/useReviewFile own pinned revision diffs and cancellable saved-file reads with local loading/errors and read Retry. Revision tabs show only the file list and read-only inline diff, without selectors, titles, counts, diff toolbar, review/worker/compare controls, capture, apply/undo or feedback actions. Show all captured files, including reviewed files, and leave empty revisions blank. Preserve pinned revisions and distinct same-path worker versions.

- Chat owns guided Git setup with selectable files and bounded previews. Preserve conversation/drafts, require explicit initial-commit confirmation and explicit task continuation. Show failures and partial completion honestly; never replay dispatch or suggest Refresh can recover a non-isolated run baseline.

- Changes lives beside orchestrator Chat in the shared panel. Preserve revision selection and
  view state on incoming captures. Keep worker sources distinct, including same-path files.
  The tab never changes files, review decisions or feedback. Source-aware
  review file tabs show saved content rather than silently opening project files.

- Worker headers place status as a subtitle beneath the agent name. Scale worker heading icons to 1em of the associated text; composer harness logos retain their dedicated size.

- Sidebar navigation rows and the project header have square button and highlight corners and fill the navigation area inside a shared 12px right gutter. Keep the tab list scrollable with the scrollbar hidden so the gutter stays consistent when content overflows. Apply hierarchy indentation inside labeled buttons instead, so nested page and conversation highlights remain full width. Use a 40px minimum base page inset that grows to fit larger icons, with 24px hierarchy steps; conversation labels retain their 4px alignment offset. Selected rows use the neutral selection fill without an underline or bottom border. When Chat is open, highlight the selected conversation rather than the parent Chat disclosure; clear conversation current state on other pages. Keep every navigation row, project header and adjacent row action at one shared fixed height: 40px at the default text size, growing together only for larger saved text. Selection, press, disclosure and animation must never resize a row; keep actions on one line and ellipsize long labels. Settings and orchestrator action controls share their row's highlight. Keep a labelled Carbon database icon action in the application footer, on the same line as the Last Message indicator and aligned to the sidebar's right edge as it resizes. Immediately to its left, put a separate Carbon back-arrow icon action with the tooltip and label “return to splash page”. Returning preserves the database, open project, chats, drafts and active work. Keep that explicit return visible even with an open project and across renderer reload; Start/Escape re-enters the app. Do not block return merely because project runs are active. Use the compact footer height, outside the scrolling tab list; reuse the database modal and project selector's busy/active-project-run restrictions. The right file panel has no top, bottom or left container padding.

- Chat bodies reserve 16px of bottom padding beneath the composer in both wide and narrow layouts, including worker conversations.
- Chat uses the local Neobrutalism Scroll Area native adapter: a compact solid,
  rounded, theme-contrasting thumb at the conversation Card's inner right edge,
  not beside the centered reading column. Retain native viewport identity, refs,
  wheel/keyboard/drag input, stable gutter, streaming follow and saved scroll state.
  Constrain inner messages, approvals and composer to the existing reading widths;
  keep the composer fixed with its 16px bottom inset. Worker chats use the same
  viewport and inner reading-column layout. Keep inspector scrolling independent,
  including stacked layouts. Do not restyle code, tables or other app scrollbars.
  Forced colors retains native system scrollbars and independent keyboard focus.
  This presentation change adds no capability, API, setting, schema or migration,
  so the self-knowledge catalog and generated capabilities need no change.
- Main Chat follows streamed growth with one retargetable scroll animation. Preserve
  follow across resize-generated scroll events between measurement and the next
  controller write. Upward input or reading activity details still cancels follow.
  This fix adds no capability, setting or self-knowledge catalog change.
  Restore history/reading positions
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

- Keep the left sidebar borderless from the drag strip through the footer; do not
  replace the removed border with a full-height divider overlay.
- New chat connections use a centered, non-interactive animated icon above
  spotlight “Connecting...” text, without a timer or duplicate inline status.
  Reuse activity fade timing for gentle entrance/exit. Hide the empty task prompt
  until the session is ready and the loader has faded out. Preserve Cancel, errors,
  drafts, transcript layout and scroll; stop animation in hidden/reduced-motion/
  forced-color views, using a static 16px Carbon fallback.
- Resolve the shared sidebar track width on `.app`, where the live sidebar width
  override is set, rather than inheriting a root-computed track width. Navigation,
  header breadcrumbs and the footer database action must all follow pointer/keyboard resize.
- Command Builder uses a table-controls header with an h1.table-title and New command action outside the scrolling list/editor body, so both stay visible on narrow and wide layouts.
- Include bundled commands in the orchestrator picker and command recognition through availableCommands, with saved commands taking precedence. Built-ins are not editable database rows or counted against the saved-command limit.

- Animate sidebar disclosure groups (Chat, Apps, Data Viewer, Settings, Advanced, Experiments
  and owned workers) with a 20ms delay and the shared 175ms height/opacity transition.
  Keep children mounted, closed groups immediately inert and ARIA-hidden, and
  rapid reversals continuous. Reduced motion and forced colors skip the transition
  and delay; reveal focused destinations immediately without clipping them.
  Preserve saved expansion, external reveals, keyboard navigation and
  selected-row fills. Regular and primary button borders must not change on
  mouse down; keep pressed fills and visible keyboard focus. Conversation rows
  retain their hover fill and text color on mouse down.

- Left-navigation fills and shared right-panel tab fills use the same 20ms delay
  and 175ms background fade on hover and off hover, except reduced motion and
  forced colors make them instant. Keep keyboard focus immediate. Paint each
  right-panel tab's selected/hovered background underneath its label and Close
  action; both controls stay separate and transparent, with glyph-only icon focus.
- Give human prompt bubbles in both chats 5px corners, 2px theme-aware outlines
  and solid pale-blue Light or dark-plum Dark/System-dark fills with contrasting
  text, through the local Bubble primitive, without a shadow. Keep automatic prompts
  and agent code blocks square. Use 8px response bottom margins, 4px timing top margins
  and visually equal 8px text / bubble gaps around the 1px separator after completed
  turn timing notices, outside activity disclosure buttons and absent for active
  timers. Human and agent bubbles share one 12px vertical / 18px horizontal
  padding rule. Keep the 8px external gap after a turn separator. Agent content
  starts 22px below that line after border and padding; align external timestamps
  with its 20px inset from the bubble edge (2px border + 18px padding).
  Apply Markdown first/last-child margin resets after general block spacing so
  paragraph/code/table margins cannot reopen that gap.
  Both composers use 2px outlines at rest and a distinct focus outline, with theme-surface fills,
  a subtle focus fill, no outer shadow and no geometry changes. Forced colors
  retain system-colored outlines.

- Reserve stable vertical scrollbar gutters on native scrolling surfaces such as
  textareas, dialogs, menus, settings, files, plans, Tactics
  and Glide scrollers, so overflow and width-dependent wrapping never shift the
  content sideways. Keep the property beside the overflow declaration, and reset
  it on clipped dialog/page frames. Horizontal tab strips, workflow diagrams and
  code/table blocks reserve scrollbar height too. Preserve scrolling and keyboard
  access and leave Monaco's overlay-scrollbar layout under Monaco's control.
  Apply in both themes and forced colors.

- After successfully archiving the currently displayed chat, show “Chat archived.”
  through the shared success toast and select Relay. Archiving other chats leaves
  the current page and conversation unchanged; failures retain inline feedback.

## Custom Assistants

The Custom Assistants section of `ARCHITECTURE.md` extends the Relay-only rules above.
Reuse the Relay runtime for custom application-owned conversations. Route all
requests by explicit conversation/generation ownership, including file previews,
worker controls, review reads, memory and cleanup. Keep built-in Relay unchanged.
Custom definitions are private, revision-checked and database-independent.
Put Edit/Archive in each active card’s upper-right More actions menu; archived
cards offer Restore. Use the shared anchored menu and a sibling trigger outside
the Open button. Remove the bottom duplicate names/actions. Preserve keyboard
navigation, focus restoration, dismissal and native archive consent; close menus
on page hide/view changes and reject stale catalog revisions.

## Chat activity artwork

Chat activity and connection indicators use static semantic icons only. Do not render
activity GIFs in Relay, project chats, workers or custom-agent chats. This supersedes
earlier animated-artwork guidance. Preserve activity labels, timers, attribution,
disclosures, theme behavior and transitions. Search loading artwork is unchanged.

## Animated navigation artwork

Use the supplied transparent Settings (options.gif), Search (search.gif), Apps (menu.gif),
Assistants (speech-bubble.gif), Custom Assistants, Home, Relay (pet.gif) and Projects (project-initiation.gif) GIFs and first-frame PNGs in shared
navigation icons. On navigation cards, play once per hover or keyboard focus;
clicking a card does not restart playback. In the left sidebar and breadcrumb
links, play once per click, including keyboard activation. Hover and focus alone
never play sidebar animations; noninteractive page headings stay still.
Preserve every frame and its timing, including the white foreground window in Projects.
Custom Assistants and each nested assistant sidebar item share the enlarged robot
artwork, including definitions without a conversation and connected conversations.
Individual projects use folder.gif, project orchestrator chats use labour-day.gif,
and subagents use drone.gif with matching first-frame PNGs. Preserve the folder
star while removing its exterior white background; the gear opening is transparent.
Keep the shared 40px row height and existing label indents; position project icons
independently of their text/activity so the artwork cannot enlarge the row.
Worker page headings retain their 1em role icon. Providers uses the supplied setting.gif artwork.
Reduced motion and forced
colors use the still frame. Reset when the document hides and clean up listeners
on disposal. Keep the icon decorative and retain the containing control's name,
focus behavior. Animated icons are twice the ordinary icon size: 2em in navigation
and breadcrumbs, 72px on navigation cards. Relay, Search, Projects and Custom Assistants are 20%
larger again: 2.4em and 86.4px respectively. Apps sidebar descendants, including
individual Data Viewer tables, use 2.5em icons (25% larger than their previous 2em).
Reserve the matching label inset without changing row height or navigation-card/breadcrumb sizes. Use the shared fixed row height for
all sidebar icons; let only the content header grow to fit enlarged artwork
without shifting navigation or clipping content. This adds no new
product capability.

## Left sidebar background controls

Settings → Appearance offers saved Background opacity (0–100%, default 100%) and
Background blur strength (0–100%, default 0), plus Reset sidebar. Persist the bounded values
in `code60.sidebarAppearance` without advancing migration markers, apply changes
live and report storage failure beside the controls. Style only the background;
text and icons stay sharp and fully visible. Cover the entire left region up to
the resizable divider, including margins, title strip and footer, and track the
existing width/collapse state. Keep this layer out of the splash, preserve native
drag areas and keep the whole left region interactive even at zero opacity.
Forced colors use an opaque system fill without blur. Explain in information tips
that sidebar opacity applies immediately independently of the restart-only
Transparent background setting for other margins. Keep body/app paint transparent
behind the left region, and keep the splash and other content opaque. Explain that
Native desktop blur is macOS-only and blends system-managed vibrancy, not a pixel radius. Report only bounded sidebar width, strength and visibility. Disable blur on Linux and hide its native backdrop for splash, collapsed navigation, opaque tint and forced colors. Do not expose these
preferences as agent-write tools or add their values to awareness.

## Neo-brutalist presentation

This section defines the current visual style and supersedes earlier visual-only
color, border, corner, shadow and weight descriptions. Layout and interaction
contracts continue to apply. This is a visual replacement, with no new theme
selector, bridge API, setting, prerequisite or execution capability.

Light uses a flat pale-blue canvas (`#e8eefb`), white surfaces, near-black
text/outlines (`#111111`) and electric-blue actions (`#2563eb`) with white labels.
Dark and System dark use a near-black canvas (`#111111`), charcoal reading surfaces
(`#202020`), darker inset fields/composers (`#161616`) and off-white text.
Deep plum (`#2f1d37`) header bands with pale text define structure without bright
fills. Black (`#050505`) panel edges and hard shadows replace white panel frames.
Bright blue (`#2563eb`) is reserved for primary actions and focus/link accents.
Control outlines remain distinct from decorative panel borders. Hover and
selection retain separate neutral fills. Text maintains 4.5:1 contrast; controls and
focus edges maintain 3:1. Semantic change colors and optional signal colors remain.

Controls use 2px outlines; unrelated controls retain square corners while migrated
chat action buttons use 5px corners. Radio buttons retain circular markers;
switches retain their On/Off labels with square tracks and thumbs. Neobrutalism
Card shells (sidebar, navigation, breadcrumb, primary content, conversation and
inspector) use 2px outlines, 5px corners and `--card-shadow`: a solid 4px right/down
offset with no blur (near-black in Light, ink black in Dark). Nested Settings
surfaces retain 3px square frames. Composer and approval Cards are quiet,
without shadows. Menus/dialogs retain their existing hard outlined edges and
offset shadows. Primary/destructive actions use a 2px hard shadow and
move 1px when pressed, reducing the shadow to 1px. Navigation cards move 1px with
a 3px shadow on press; sidebar rows and icon actions stay stationary. Transcript
text, nested rows and icon actions have no decorative shadows. No new cards,
headings, promotional text or decorative counts are introduced.

Page/Card Titles use bundled Space Grotesk Bold (700); body and chat use IBM Plex
Sans Regular (400); Button Text and Table Headings use IBM Plex Sans Semibold
(600). Keep all existing role sizes, independent navigation size and saved
role overrides. Do not advance appearance/typography migration markers or reset
preferences. The wordmark and all animated navigation artwork/playback remain.

Keep the existing panel widths, row heights, card gaps, retained views, transcript
scrolling and responsive inspector stacking. Account for panel borders inside
existing padding; leave clearance for hard shadows. On Chat, frame the conversation
and right inspector separately; the outer Chat layout remains transparent and
shadowless. The 5px page top margin and 11px sidebar-card gaps remain.

Sidebar opacity/blur still affect only the full-height background, independently
of restart-only transparent margins; never paint an opaque layer behind that
sidebar tint. Splash stays opaque and uses the same palette. Forced colors uses
system fills/outlines and removes decorative shadows; reduced motion disables
transitions. Keyboard focus uses a distinct solid outline/inset edge; the saved
Focus highlight border preference retains its stronger treatment.

This change adds no capability, so the self-knowledge catalog, availability rules
and generated capability artifacts need no changes.

All visible left-navbar artwork stays at 100% opacity at rest, on hover/focus,
and in unavailable destinations; unavailable labels retain muted text and native
disabled semantics. Artwork playback and reduced-motion rules are unchanged.

Offer Scientifica as a locally bundled Text typeface (regular, bold and italic)
with its upstream license and asset hashes. OCR-A is removed; stale saved OCR-A
choices fall back through the existing validated role-default behavior without
resetting other saved typography settings or migration markers.

About, Advanced, Providers and Memory share the supplied info.gif, laptop.gif,
setting.gif and books.gif navigation animations respectively, with transparent
exteriors and preserved enclosed white details. Use their still posters at rest,
click-only sidebar/breadcrumb playback and hover/focus-once navigation cards.

Polling, Appearance and Text use the supplied heartbeat.gif, painting.gif and
font-size.gif animations and transparent still posters through shared navigation
artwork. Text uses colored artwork, replacing the former monochrome SVG mask.
Keep click-only sidebar/breadcrumb playback and hover/focus-once card playback.

Updates uses the supplied download animation with transparent exterior and a
matching PNG poster, preserving original frames/timing and shared click-only
sidebar/breadcrumb and hover/focus-once navigation-card playback.

Breadcrumb cards scroll within 40% of the viewport height when large saved title
sizes wrap, preserving usable content below the header.

Transparent Linux windows use three renderer caption buttons in the native drag
strip because Electron hides its native caption controls for translucent windows.
A strict minimize/maximize/close enum targets only the owned main window. Close
must call the normal guarded close path, never destroy the window or kill work.
macOS retains native window controls. No arbitrary window IDs cross the bridge.

Breadcrumb right-edge measurement also follows the stacked transcript scrollbar
gutter, keeping its card aligned with the conversation at narrow widths.

Keep breadcrumb and conversation right edges aligned in stacked layouts too,
accounting for the transcript scrollport gutter without raising the inspector.

Native sidebar blur reports fixed application failures beside the Appearance
sliders independently of persistence status, including failures during owner events.
Send hidden visibility immediately; animation frames may stop in hidden documents.
Track macOS owner show/hide events and renderer visibility rather than Electron
45's inverted isVisible predicate. Keep the decorative backdrop out of Mission Control.
Linux caption controls remain accessible inside the splash and first-use setup modals.
At narrow sidebar widths and large text sizes, bound conversation indentation and
artwork to preserve readable labels and independent action targets.

Native sidebar backdrop visibility follows owner show/hide/minimize events and immediate
renderer hidden reports, without Electron's macOS native visibility predicate. Hide the
decorative window from Mission Control. A payload-free failure notice reports native
event failures beside Appearance controls, separately from preference save errors; a
successful adjustment clears the native error. Keep caption controls inside the active
splash/setup dialog on Linux so modal top-layer and inert rules cannot block them.
Conversation icon/label insets shrink at narrow sidebar widths to preserve readable names.

## Settings action icons and spacing

Appearance leaves 16px above the Left sidebar group. Chat bodies retain a 16px
bottom inset beneath composers at every width. Left-navbar disclosure chevrons
and the Add Project action have a visible 24px circle within their unchanged
28px hit target. Use black outlines and 2px hard black shadows with a theme-aware
fill; pressing offsets the circle 1px and reduces its shadow. Rotate only the
chevron glyph. Retain keyboard behavior, independent focus and accessible
expansion state. Reveal sidebar circles only while their own header/item is
hovered or contains keyboard-visible focus. Hovering a nested conversation does
not reveal its project/header actions. Keep action space reserved so labels stay
stationary and hidden actions remain keyboard-reachable. Forced colors use
system edges/fills without shadows. This visibility refinement adds no capability
and requires no self-knowledge catalog change.
Memory Refresh, About Copy version info, Updates Check for updates and global
Reset text use the shared named icon-button treatment and existing action handlers,
disabled states, feedback and tooltips. Memory and Updates omit their header help
icons; retain the explanations as accessible descriptions of the Memory switch
and Check for updates action. No capability or availability change is introduced,
so the self-knowledge catalog and generated capabilities do not change.

Breadcrumb changes use stable item identities for short entrance/exit fades and position
transitions in the shared header, including centered and wrapped trails. Only the new
trail is semantic/interactive; exiting snapshots are inert, aria-hidden and ID-free,
with no duplicate headings. Copy raster artwork into canvases rather than cloning
image elements, preserving the strict file CSP and live icon playback. Hand off portal ownership in React's layout phase and
initialize effects during mutation delivery before paint; never show the final trail
for a frame before rewinding its opacity/height. Preserve geometry through portal
handoffs and opacity through interrupted entrances.
Match identical visible breadcrumb items across changed chat identities without
entrance/exit fades; always use the destination's controls and navigation targets.
Reserve exact identities first and never match one old item more than once.
While selection is pending, keep the outgoing chat and breadcrumb visible but
inert, with detail reads inactive, until the selected snapshot arrives. Only this
explicit navigation-pending inert owner may keep publishing its title; all other
inert/hidden retained views stay excluded. Never collapse the header by hiding
every conversation during the asynchronous handoff.
Use the existing motion token; skip initial hydration, reduced motion, forced colors
and hidden documents. Cancel owned animations/snapshots
on rapid replacement, resizing, visibility changes and disposal. Preserve rename
controls, keyboard focus, icon playback and retained page state. This is presentation
only and adds no capability, setting or persisted schema.

Main-page entrances move only visible content over a fully opaque, stationary card.
Never dim the whole page panel: its fill, outline and hard shadow must not flash.
Use the shared motion token, target the visible Settings section or conversation
transcript, keep Chat's composer and inspector stationary, and retain hidden views and their drafts/scroll. Late initial chat/project identities
and background updates must not replay entrance motion. Cancel effects on
replacement, visibility/preference changes and disposal; skip initial hydration,
reduced motion and forced colors. No new preference or capability is introduced.


## Neobrutalism surfaces and chat

Use the local licensed Card primitives for shared main-content navigation,
creation cards, all six sidebar navigation containers, primary content,
breadcrumbs, conversation, composer and inspector shells. Chat uses the local
native Button, Textarea and human Bubble adapters; trails use Breadcrumb parts.
Tailwind v4 is build-only, `nb:`-prefixed, without Preflight or
automatic discovery; explicit sources are these primitives and the navigation
adapter. Keep its layer before app layout/components and accessibility last.
Map tokens to live Code60 themes/text settings, using `--nb-card-spacing` only
for layout to avoid the existing saved text-spacing variable. Shells own 5px corners,
2px outlines and 4px hard shadows; main-content cards retain the 224px grid while
sidebar cards fill the resizable column. Native Open/create
buttons use span parts and assistant menu actions stay siblings. Sidebar containers
retain direct-child headers, dedicated chevrons/plus and mounted inert children;
keep opaque header-band rounding within the Card and do not clip focus. Preserve artwork,
focus, disabled/pending state and 1px press feedback; honor reduced motion and
forced colors. Do not import upstream global palettes/fonts/resets or introduce
runtime fetching, Base UI, app-wide button changes or appearance migrations.
This presentation-only migration adds no capability and needs no catalog change.


Primary/content and inspector adapters retain their former combined 3px edge
with a 2px Card outline plus 1px inner padding; breadcrumb padding similarly
compensates the thinner border. Keep the breadcrumb portal, motion ownership and
right-edge/upward-extension observers unchanged. The outer Chat tabpanel stays
transparent and unframed: only its conversation and inspector are surface Cards.
All retained tabpanels, landmarks, refs, inert/hidden state and native controls
keep their existing DOM identity and behavior. Composer Cards use the existing
quiet inset fill, control edge and no decorative shadow; their embedded Textarea
is borderless and independently retains command/IME/Enter/Shift+Enter behavior.
Human Bubble content remains preformatted, safely escaped and theme-aware.
Agent Bubble content uses a div containing semantic safe Markdown, including code
and tables. Light agent fill is warm neutral (#f1f0e8); Dark is olive-charcoal
(#282b25), distinct from human pale-blue/plum fills, with >=4.5:1 text contrast.
Both use 5px corners/2px edges without shadows. Timestamp/Copy/Undo remain outside
bubbles; agent metadata aligns with the text inset. Automatic updates and tool
activity are not message bubbles. Forced colors uses Canvas/CanvasText.
Native chat buttons use saved control typography, stationary hover, 1px pressed
offset and independent focus. Quiet transcript/inline actions remain shadowless;
reduced motion removes movement and forced colors uses system fills/edges with
no decorative shadows. No Base UI, CVA or remote runtime dependency is introduced.
This expansion changes presentation only: no capability/catalog generation,
bridge contract, setting, schema, migration or appearance reset is required.

- Agent bubbles fill the existing reading column. Completed-turn dividers share
  their outer left/right edges and use visually equal 8px gaps from the
  visible timing text and following bubble border. Use a row-to-divider margin
  of `calc(8px - 0.15em)` for the remaining font descent after leading trim. Timing disclosure buttons
  retain a 24px minimum target without extra vertical padding; saved larger
  text grows the line height. Bottom-align their inner label and trim trailing
  font leading with text-box trim-end (cap/text), so the visible letters have
  the same 8px divider gap as the following bubble border. Keep source Copy, disclosure state, streaming and
  scroll behavior unchanged. Presentation only; no capability/catalog change.


## Providers

Follow the Providers navigation and management section of `ARCHITECTURE.md`.
Providers replaces the Agents settings destination. Preserve v1 verified membership,
model defaults, histories and external logins. Set-primary/disconnect are strict
human-only bridge actions, guarded in main against active desktop work, setup and
overlapping writes. The primary must be replaced before disconnecting. Publish
main-owned blocking reasons; keep sidebar/gallery/details state and actions aligned.

## Modal dialog surfaces

Use local Neobrutalism DialogContent for native in-app modal windows, with 10px
corners, 2px outlines and a hard 4px shadow. Keep native focus/Escape/busy behavior
and existing layouts. Equal compact side padding and border-box sizing must not
add outer padding to zero-padding layouts. Modal shells and their body panes use
auto scrollbar gutters rather than reserving empty right-side strips; other
reading panes keep stable gutters. Full-screen splash is separate. Honor live
themes and forced colors. This visual change adds no capability/catalog entry.

## Prompt workspace

Prompt Builder retains drafts per database path in AppPages-owned sessions. Keep original
effective text/source for conflict checks; always send expected metadata on save/reset.
Do not clear newer drafts from an older completion. Keep validation locations supplementary
to shared template validation. Native fields preserve Tab navigation, named merge fields,
sample-only preview, keyboard tabs and plain-text comparison. Reload blocks until all
database drafts are resolved; normal quit confirms through main's boolean-only close guard.
