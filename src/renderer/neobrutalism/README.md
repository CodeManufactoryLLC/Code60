# Neobrutalism primitives

The current-page Combobox adapts the [Combobox composition](https://www.neobrutalism.dev/docs/combobox)
of Popover and Command, retrieved 2026-11-20:

| Primitive | Registry | SHA-256 |
| --- | --- | --- |
| Popover | [popover.json](https://www.neobrutalism.dev/r/popover.json) | `2941de4bff4be28fd418570cabd4f04f28c12bb8e8e5798eff74879b16417a94` |
| Command | [command.json](https://www.neobrutalism.dev/r/command.json) | `337387f164dc6180b4b413ef5d62a3ff68b0a2a2cc356da1d255e60cb4a6b4cb` |

The existing MIT license covers these adaptations. The local combobox uses a
native button and top-layer popover, with a select-only ARIA listbox instead of
Base UI, cmdk or an icon dependency. Only the current page and its parents are
offered; current selection has a checkmark and selecting it does not navigate.
Arrow/Home/End, first-letter navigation, Enter/Space, Escape, Tab, native outside dismissal, hidden-owner cleanup,
focus restoration and viewport clamping stay local. Header fonts/colors inherit
Code60 preferences; the popup uses readable app surface colors, 1px edges, 5px
corners and no shadow on either trigger or popup. Native display/overlay CSS
transitions animate opening and dismissal over the shared motion duration; a
retained closing popup is inert and aria-hidden. There is no search field or JS
animation timer. Forced colors and reduced motion skip animation.
Chat Rename remains a sibling action. No remote runtime fetch or global reset.

Adapted from [Neobrutalism Card](https://www.neobrutalism.dev/docs/card),
[registry source](https://www.neobrutalism.dev/r/card.json), retrieved 2026-11-19.
Registry SHA-256: `32798f407f3faaaddf9ea12012ee1b131d0935eefe260f08ed081ee6d4a91347`.
Copyright (c) 2023 Samuel Breznjak. See [MIT license](LICENSE).

Card, CardHeader, CardContent, CardTitle and CardAction support the existing
navigation/sidebar, content, breadcrumb, conversation/composer and inspector
shells, and quiet worker approval Cards. Card accepts div, section or aside and forwards their native props/refs.
Local adaptations: `nb:` Tailwind prefix, `--nb-card-spacing` layout variable,
explicit border style/box sizing because Preflight is absent, span-compatible
parts inside native buttons, and simple class joining without runtime dependencies.
Code60's navigation adapters supply the main-content gallery and one sidebar
shell enclosing six plain accordion sections, preserving artwork and native actions,
text roles, pressed/focus and accessibility behavior. The Card owns the 1px outline with 5px corners, live theme fill/text and 4px hard shadow.

`theme.css` imports theme variables and utilities only, never Preflight. Explicit
sources limit generated classes to these primitives and the navigation adapter.
The dedicated neobrutalism layer precedes application components; accessibility
stays last. Inline aliases resolve against live Code60 theme/preferences, including
forced colors. The upstream layout spacing variable is renamed to avoid colliding
with Code60's saved `--card-spacing` letter spacing. No palette, font, reset,
remote asset, runtime CSS fetch, Base UI or global button replacement is installed.

Chat and breadcrumb primitives were adapted from the same MIT registry on
2026-11-19. Registry source and SHA-256:

| Primitive | Source | SHA-256 |
| --- | --- | --- |
| Button | [button.json](https://www.neobrutalism.dev/r/button.json) | `b6c59a12da75416229d85688aea63d4e5a2760d5d8ffa3c8f4eb8021e7b3df3b` |
| Textarea | [textarea.json](https://www.neobrutalism.dev/r/textarea.json) | `acbbabdef1930f9bf67a41bdc92994157c907bd2a709a6a8b728b115be414b0f` |
| Breadcrumb | [breadcrumb.json](https://www.neobrutalism.dev/r/breadcrumb.json) | `f956b4455da3f3fcab6b5506a67b16a0d98f76c45e28c16d27b44fbde3ec1c2a` |
| Scroll Area | [scroll-area.json](https://www.neobrutalism.dev/r/scroll-area.json) | `1ab9757d32e2e54311aef9f85104ffcb8502124683f5caf5a74cc23fd9294146` |
| Bubble | [bubble.json](https://www.neobrutalism.dev/r/bubble.json) | `8d0fe5ff307a918e4aa7b99b55bc33fca38e29762f48eba9ed1b0baa5aecd1e5` |

Only the used parts/variants are vendored. Button keeps native HTML semantics in
place of Base UI; variants use simple class joining instead of CVA. Hover stays
stationary, pressed offset stays 1px, and focus uses live system/theme colors.
No fixed upstream font sizes or opacity rules override saved Code60 text roles
or disabled treatment. Breadcrumb keeps the existing native navigation buttons,
heading/current-page semantics and inert portal marker; no anchor emulation or
ellipsis is introduced. BubbleContent defaults to a preformatted human element; its agent variant renders
a div around semantic ChatMarkdown. Separate live theme tokens color human and
agent fills/text. Both retain 5px corners and 2px outlines without shadows or
avatars, keeping timestamp/Copy/Undo outside. The agent inset preserves compact
divider spacing and metadata alignment. Composer fields remain borderless inside their Card, and
composer chrome aliases its existing fill/edge/shadow through local Card tokens.
Unrelated buttons/fields/menus are untouched. Accessibility overrides remain last;
forced colors removes shadows and reduced motion removes button displacement.
This adds no capability, setting or persistent schema; no catalog change is needed.

Scroll Area adapts the upstream compact solid rounded thumb to the native chat
viewport rather than introducing Base UI or replacing the existing scroll/ref
lifecycle. Native wheel, drag, keyboard, focus, streaming follow and saved positions
remain authoritative. Its visible thumb uses the live control edge for contrast;
forced colors keeps the system scrollbar. The viewport spans the conversation
Card to its inner edge while inner message/composer widths retain their reading
column. Other app scrollbars are unchanged.

Scheduled Jobs adapts [Accordion](https://www.neobrutalism.dev/docs/accordion)
from [accordion.json](https://www.neobrutalism.dev/r/accordion.json), retrieved
2026-11-19, SHA-256 `b7e04619023703b6fee740ad71c42c99e1bd31d615a1557fa349b64b5813f516`.
The MIT license above also covers this primitive. Local native disclosure buttons and
hidden panels replace Base UI, with controlled expansion, stable labelled panels,
and Arrow/Home/End navigation between triggers. Independent run/stop and delete
buttons precede the final circular disclosure beside the noninteractive heading,
never nested in its trigger. The name labels its expanded panel; the chevron
retains arrow/Home/End navigation and explicit expanded state. The prefixed
outline, main-color heading and hard shadow follow upstream; theme colors,
saved typography, native focus, reduced motion and forced colors remain Code60-owned.
Expanded job details and inline create/edit forms use Card, Button and Textarea.

Dropdown Menu adapts the [upstream registry](https://www.neobrutalism.dev/r/dropdown-menu.json)
(MIT, retrieved 2026-11-20, SHA-256
`ed66e3e704cf2659089924601e0916fdddbad5bf2423f206e3567a4166fd12d2`).
Only the used trigger, popup and item presentation is adapted. The local native
Button and shared AnchoredMenu supply keyboard activation, arrows/Home/End,
typeahead, Escape, focus restoration, viewport clamping and dismissal. There is
no Base UI or icon dependency, global palette/reset or remote runtime fetch.
Popup/items retain upstream 2px edges, rounded corners and blue item highlights,
with Code60's 5px radius, hard shadow, saved control typography and live theme
colors. Close on page hide, disable, window blur, anchor movement or document
hide. Scheduled Jobs alone uses the adapter; existing unrelated menus retain
their appearance. This rearranges existing actions and adds no capability.

Provider controls adapt the MIT Dropdown Menu and Checkbox registry presentation,
retrieved 2026-11-19:

| Primitive | Source | SHA-256 |
| --- | --- | --- |
| Dropdown Menu | [dropdown-menu.json](https://www.neobrutalism.dev/r/dropdown-menu.json) | `ed66e3e704cf2659089924601e0916fdddbad5bf2423f206e3567a4166fd12d2` |
| Checkbox | [checkbox.json](https://www.neobrutalism.dev/r/checkbox.json) | `8f4b35e7cdbdfebbaffade46c2fab7d49182f49ea77b1ea3376194d49adde790` |

ProviderDropdown retains native AnchoredMenu behavior instead of Base UI, with
2px outlined rounded items, inset padding, theme-aware highlighted fills and hard
shadow. Disabled items remain focusable with accessible reasons and never execute.
PrimaryProviderMark adapts the checked fill/check glyph into a circular read-only
status image, 36px in cards and 18px in rows, with the existing hover/focus tooltip.
It is not an input and cannot toggle membership. Styling lives in home.css and
uses live Code60 tokens, saved typography and forced-colors overrides.

DialogContent adapts [Neobrutalism Dialog](https://www.neobrutalism.dev/docs/dialog),
[dialog.json](https://www.neobrutalism.dev/r/dialog.json), retrieved 2026-11-19.
Registry SHA-256: `ad7c77988523e32e01d6cf23a9e3e7f86352d21e2c4066c0934bb3bc47a0e8a6`.
It uses the native dialog element, forwards its props/ref, and preserves each
caller's showModal, focus, Escape and pending-action ownership. Only the used
content surface is vendored: a 2px outline, hard 4px shadow, theme fill/text and
10px corners. Existing widths and header/body/footer layouts remain adapters;
border-box sizing bounds them to the viewport. Compact dialogs retain balanced
16px content padding, while table settings and the palette retain their own
padding. Empty scrollbar gutters are removed from modal shells and native modal
body panes; actual scrollbars remain available. Full-screen splash layout is
separate. Forced colors uses system fills/edges without shadows. No Base UI,
new dependency, remote runtime fetch, motion or capability is introduced.

Chat harness approval menus use the Dropdown Menu presentation above and retain
the native popover's grouped radio choices and keyboard navigation.
The adjacent [Toggle](https://www.neobrutalism.dev/r/toggle.json) adapts the
registry's small outlined, filled-when-pressed button to native aria-pressed
semantics and Code60 theme colors.

Registry SHA-256: `b42d88044834c0bbeb74b66148093b267907f6cc86894889e0823ea3a4fee517`.

Sidebar Card adapters use white #ffffff across their Light bodies and headers. Dark retains charcoal bodies and inherits the breadcrumb’s purple #2f1d37 headers
with light text. Light header labels stay dark and the sidebar Card uses 5px corners and the shared main content shadow. Nested rows
use normal readable theme colors, with #93c5fd selection in Light and distinct hover/focus.
Disclosure/add glyphs use blue on white circles; existing stop controls keep
semantic colors. Forced colors retains system fills and edges. Shared Card
defaults remain unchanged for other surfaces.

The Light workspace canvas is #f4f8fe; the sidebar backdrop, card bodies and
headers use white #ffffff over the separate #f4f8fe backdrop. The page-selector
header and dropdown trigger share the white fill and dark text; Dark retains its existing palette. The
Light muted and focus/link colors are darkened to retain canvas contrast.
Forced colors still uses system fills/text, and transparent-sidebar/window
preferences remain authoritative.

The page selector uses a 240px by 44px border-box trigger with 2px vertical margins, centered horizontally
and vertically in its header card with either sidebar state. Symmetric side tracks
keep the separate Rename action from shifting the selector. Narrow layouts shrink
the trigger only when required to fit the card and Rename; height stays fixed.
Long labels use ellipsis with their full text available to accessibility and the
native title tooltip. Trigger artwork is capped at 40px. The popup is 240px wide
within viewport bounds and grows vertically with its current path options.
This presentation change adds no capability, setting or availability rule.

Light sidebar, main-page/conversation and breadcrumb Card foreground surfaces
share white #ffffff with dark text, over the #f4f8fe app canvas. Light chat
composers use the same white at rest and focus, retaining their visible focus
outline. Nested cards, other fields and inspectors keep their existing fills.
Set reading-plane fill directly so it does not inherit into nested Cards.
Dark retains its existing palette; forced colors uses system surfaces. This is
presentation only; no capability, availability rule or catalog change is needed.

The sidebar has one scrollable Card shell with a 1px outline, 5px corners and the main
content Card shadow. Six plain section wrappers retain independent accordion state and header
actions; five 1px theme-border lines delimit sections. The shell owns the existing
6px horizontal row inset, and sections own 4px vertical padding, local icon
playback/actions and last-row spacing. Light/Dark palettes, forced colors and
saved disclosure/navigation state remain unchanged. This layout adds no capability.

The Light window and sidebar backdrops both use pale blue #f4f8fe; white Card
foregrounds remain #ffffff. The sidebar shell uses a 1px outline, 5px corners and the same 4px
hard shadow as main content, with bottom clearance for the shadow. The breadcrumb
containing Card uses 5px corners with no decorative shadow.
Its centered 240x44 selector with 2px vertical margins and separate Rename action retain their own geometry.
Dark backdrops keep their palette; forced colors removes decorative shadows.
This presentation change adds no capability, preference or catalog update.

Back/Forward use the user-supplied circular arrow GIFs with transparent exteriors
and static PNGs at rest. Back maps to arrows.gif; Forward maps to arrows (1).gif.
Playback runs once per click, including Enter/Space activation; hover and focus
alone stay still. Use still frames
for reduced motion/forced colors. Preserve history handlers, disabled state,
focus handoff and no-work navigation. Images remain decorative with labelled
buttons and a visible keyboard focus ring. Keep the group inside the breadcrumb
Card but outside the portalled/inert title owner. Symmetric reserved tracks keep
the selector centered; compact containers reduce button size and selector padding
to avoid overlapping Rename. The sidebar toggle stays in the main content Card’s upper-left corner.
Update the catalog access path without changing authority or availability.

Workspace shell adapters (sidebar navigation, breadcrumbs, main page/conversation
and right file panel) use 1px borders. Other Card defaults also use 1px borders.
Minimized file panels and the unframed outer Chat tabpanel remain borderless.

Monochrome icons are an optional Settings → Appearance → Icons preference, off
by default, with a native color selector defaulting to gray (#808080). Apply
immediately and save locally without altering theme, migration markers or
existing icon assets. Retain color when disabled, and surface failed persistence.
Map icon luminance into dark/middle/light shades of the selected color, preserving
alpha and animation timing. Cover shared navigation artwork, action glyphs,
provider logos and context indicator; leave text, surfaces and content images
unchanged. Forced colors bypasses the tint. This human-only, database-independent
setting is described in the self-knowledge catalog.

All Card shells now use a 1px border, including navigation/creation cards,
conversation composers, approval and job-detail cards, Settings cards/groups,
System Manager service cards and scheduled-job accordion items. Keep 1px
internal accordion dividers and 4px inner header corners within 5px outer corners.
Retain existing fills, shadows, focus indicators, padding and borderless retained
wrappers. This presentation change adds no capability or availability rule.

Panel toggles share a stationary row at the top of the main content Card: sidebar
open/close at the upper left, Files open/close at the upper right when an active
file-panel owner exists. The row overlays the Card's grid cell and follows the
measured conversation inset through sidebar and inspector resizing. Reserve 44px
above scrolling content; keep the native window strip and breadcrumb Card free of
panel toggles. The active PanelShell portals its existing action into the shared
right slot in both open/closed states, preserving labels, disabled state, tab
order, focus, draft/scroll state and read ownership. Inactive retained panels
never publish a toggle. Closing panels leaves both corner actions reachable;
stacked inspectors keep their action at the main conversation Card's corner.

Icon contrast in Appearance → Icons is a 0–200% slider, enabled with Monochrome,
applying and saving immediately alongside its color. Default/missing/invalid
contrast is 100%, preserving the existing palette; bound finite numbers to the
range and round to whole percentages without resetting other saved choices.
At 0%, all luminance maps to the selected color. At 100%, retain the existing
65% shadow/highlight spread. At 200%, endpoints reach black/white; the midpoint
always stays the selected color. Preserve alpha, playback and forced-color
bypass. Retain contrast when Monochrome is disabled and describe the control in
the self-knowledge catalog without changing authority or availability.

The breadcrumb selector keeps its 240px width and centered 48px outer vertical
footprint using a 44px trigger plus 2px top/bottom margins. Trigger and popup
corners are 5px and borders 1px, including the selected option outline. The
popup list trades 2px of vertical padding (6px to 4px) for 2px vertical margins;
horizontal padding remains 6px. Preserve popup anchoring, viewport bounds,
parent-only choices, focus, keyboard/typeahead and open/close animation.

The right Files panel uses a no-search Files view combobox listing all open views
in existing order, with icons and a current-selection checkmark. A final selectable
“+ New Tab” item creates and selects a blank view; it is an action, never a saved tab.
File Explorer, Changes and Memory Recall are always offered, including before
opening their views; selecting a missing destination creates it through existing
actions, without eager reads or cached fake tabs. Close appears only for file, plan,
revision and application document views, at the upper right below the header.
Blank and main views have no close symbol. The
header follows the measured breadcrumb Card height, including text/window changes.
The selector stays centered and fills the header, including narrow panels. It fills
available width at 36px height with 5px corners/1px borders; long labels ellipsize,
with full titles in tooltips.
Native popover keyboard/highlight/commit/dismiss behavior matches breadcrumbs.
Delete closes the selected view; Alt+Left/Right reorders it from the closed
selector, prevents browser navigation and announces the new position. Drag
reordering and the horizontal strip are removed. Adding focuses the selector;
closing selects the next neighbor, otherwise previous, and focuses the selector.
The final close keeps the empty panel open and focuses the enabled No open tabs
selector, which still offers the main pages and + New Tab. Content uses a named region rather than
obsolete tabpanel semantics. Keep all IDs, state, cached previews, reader and
conversation ownership, panel sizing and main-card corner toggle unchanged.
The shared combobox accepts optional trigger ref/keyboard handler, list label
and empty placeholder; existing breadcrumb defaults stay intact. The Files
catalog describes this UI without granting any new execution or read authority.
