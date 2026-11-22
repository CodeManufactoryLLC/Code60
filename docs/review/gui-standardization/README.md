# GUI standardization visual review

Synthetic project fixtures from the Linux Electron/Playwright harness; no real
workspace content or credentials. Before is current main at `053126a`. Historical After images below show intermediate stages. The latest header images
show the current layout: white reading surfaces, unified sidebar, page artwork
beside each content title, a history/appearance header without a page selector,
main-card panel toggles, and the Files dropdown.

| Before | After |
| --- | --- |
| ![Before: separate navigation cards and file tabs](before-light.png) | ![After: unified navigation and Files dropdown](after-light.png) |

Appearance also adds optional locally saved Monochrome icons, a color picker
(gray by default), and a 0–200% contrast slider. Colored artwork remains the
default; system colors bypass the tint. Back/Forward artwork plays once on click.

![Monochrome icons with a selected color and 200% contrast](after-monochrome.png)

Dark sidebar headers share the breadcrumb Card's purple fill (`#2f1d37`) and
light foreground; Light and forced colors retain their own palettes.

![Dark sidebar headers matching the breadcrumb Card](after-dark.png)

Primary pages share a centered text-only page title and adjacent chevron menu
for existing page commands, using saved Page Titles typography. Scheduled Jobs
uses its page name. Table tools, creation cards and corner panel toggles stay
visible; pages without commands show only their title. Headers grow with larger
text and remain in their own content card through navigation.

![Scheduled Jobs title and command dropdown beside the corner controls](after-scheduled-jobs.png)

| Shared header in Light | Shared header in Dark |
| --- | --- |
| ![Home title with no empty command menu in Light](after-page-headers-light.png) | ![Home title with no empty command menu in Dark](after-page-headers-dark.png) |

The conversation header and both corner toggles remain reachable after scrolling
a stacked chat with enlarged composer text. Automatic chat naming keeps an open
command menu attached to its owner without resetting keyboard focus.

![Stationary header above a scrolled stacked chat with enlarged text](after-page-header-stacked.png)


The right edge of the breadcrumb Card has one Color theme button. It shows the
selected preference and cycles System → Dark → Light → System. System remains
the default; saved selections and the Appearance Theme selector stay synchronized.
Artwork plays once on activation; hover/focus stays still and reduced motion or
forced colors uses the poster. The current-page selector stays centered. Main page and conversation backgrounds
also have a subtle stationary 24px grid with 1px lines, using faint black in Light
and faint white in Dark. Nested reading surfaces remain solid; forced colors
suppresses the grid.

| Light mode | Dark mode |
| --- | --- |
| ![Sun theme button at the right of the breadcrumb Card](after-theme-light.png) | ![Night theme button at the right of the breadcrumb Card](after-theme-dark.png) |

The supplied [eclipse](../../../src/renderer/icons/apps/theme-eclipse.gif),
[night](../../../src/renderer/icons/apps/theme-night.gif) and
[sun](../../../src/renderer/icons/apps/theme-sun.gif) assets retain all 48 / 107 / 46
frames and their exact per-frame delays (2.0 / 2.4 / 2.4 seconds). Background-only
white removal preserves enclosed moon detail; source files remain untouched.


Icon animations has its own toggle immediately left of Color theme. It freezes
playing artwork app-wide and adds a transparent block symbol over the still wheel.
Re-enabling plays the wheel once, then restores each icon's normal click/hover
behavior. The setting is saved with icon color/contrast; ordinary application
transitions and status text motion retain their existing settings.

![Icon animations disabled, with the wheel visible through the block symbol](after-icon-animations-off.png)

The supplied [wheel](../../../src/renderer/icons/apps/animation-wheel.gif) retains
all 94 frames, exact delays (2.04 seconds), and its 640×640 canvas, with a
one-shot loop for activation. White gaps/background are transparent. The supplied
[block SVG](../../../src/renderer/icons/apps/animation-block.svg) already has
transparent cutouts and is retained unchanged. Source Downloads files are untouched.


Both breadcrumb appearance controls are 50% opaque at rest and fully opaque on
hover or keyboard focus; forced colors keeps them fully visible. The wheel/block
composite fades as one control. The main-content grid is slightly more visible:
7% black lines in Light and 8% white in Dark, retaining 1px lines and 24px spacing.


Memory, Polling controls, Appearance and Update Manager are now direct Apps
children in both the sidebar and Apps home. Earlier snapshots above show the
previous placement. Keyboard parents use Apps; Settings
retains About, Advanced, Table defaults and Text. Existing preferences and update
check/download/install controls keep their state and permissions. The Data Viewer
Polling monitor remains separate from Apps → Polling controls.

| Apps in Light (narrow, scrolled to Update Manager) | Apps in Dark |
| --- | --- |
| ![Moved preferences in Apps and the Update Manager card in Light](after-apps-preferences-light.png) | ![Moved preferences in Apps and the Update Manager card in Dark](after-apps-preferences-dark.png) |

## Current header simplification

The top Card now contains history and global appearance buttons only. Its horizontal
padding is half its previous value, with the controls using the same inset. The
current-page combobox and its ancestor menu have been removed; use navigation cards,
the sidebar or Back/Forward. Each content title includes its navigation artwork on
the left, including actual project/provider/chat names and unavailable-page headers.
The shared title/action group remains centered and grows for enlarged text.

Information-tooltip icons are removed across Settings, Memory, polling, transitions,
commands and Search. Settings retain their assistive descriptions and described-control
IDs; Search shows unapplied changes as status text. Ordinary action tooltips remain.
These images supersede earlier screenshots containing a current-page selector.

| Current Light header | Current Dark header |
| --- | --- |
| ![History and appearance header with a Home title icon in Light](after-simplified-header-light.png) | ![History and appearance header with a Home title icon in Dark](after-simplified-header-dark.png) |

![Title artwork and wrapping at the maximum supported text size](after-title-icons-large.png)

## Current flat surfaces and navigation density

The main content and chat conversation Cards and the left navigation Card are now
shadowless. Nested cards and the right Files inspector keep their existing
presentation. Sidebar dividers reach both inner border edges, while row labels
retain their horizontal inset and accordion behavior.

Navigation row height scales with saved Button Text size, including below the
default. It remains 40px at 15px text and shrinks to roughly 22px at 8px text; row
actions and circular glyphs shrink to fit. Larger text grows every page, project,
chat and worker row through the shared height. This supersedes earlier snapshots
showing main/sidebar shadows and inset separators. No capability or availability
change is introduced.

| Current Light surfaces | Current Dark surfaces |
| --- | --- |
| ![Shadowless main/sidebar and edge-to-edge dividers in Light](after-shadowless-surfaces-light.png) | ![Shadowless main/sidebar and edge-to-edge dividers in Dark](after-shadowless-surfaces-dark.png) |

![Compact navigation rows with 8px Button Text](after-sidebar-rows-8px.png)

## Current flush highlights and history placeholders

The Files inspector now joins the main and left navigation Cards without a drop
shadow. Active sidebar fills meet the inner border edges and adjacent rows, with
no surrounding white gutters. Labels retain their internal inset, proportional
row heights and accordion controls. These images supersede earlier inset-row
snapshots.

Unavailable Back/Forward directions keep labelled disabled buttons with empty
placeholder circles; available directions show their supplied click-only arrow
artwork. Their positions and navigation/focus behavior are unchanged. The workspace
header has half its former vertical padding (2px instead of 4px per side), with a
54px minimum height; the right header follows the existing measurement.

| Flush navigation in Light | Flush navigation in Dark |
| --- | --- |
| ![Full-row Home selection and empty Forward placeholder in Light](after-flush-navigation-light.png) | ![Full-row Home selection and empty Forward placeholder in Dark](after-flush-navigation-dark.png) |

![Shadowless Files inspector, full-row chat highlight and empty Forward circle](after-flat-files-history-placeholder.png)

## Current permanently open navigation cards

Home/Search, Assistants, Projects, Providers, Apps and Settings now have separate
shadowless Cards, each with a full-width 1px border beneath its heading. All six
Cards stay open, including when legacy preferences previously saved them closed.
Their heading disclosure buttons are removed; Add Project and Add Provider remain.
The global navigation-panel toggle remains in the main content Card. These images
supersede the unified sidebar shell shown in earlier phases.

Immediate child labels align vertically with their header title. A shared bounded
artwork gutter preserves that alignment at small and enlarged text sizes without
overlapping row actions. Deeper Data Viewer, Advanced/Experiments, project and chat
accordions retain their own controls and persistence. Left from an immediate child
returns focus to its heading without collapsing the Card; Right enters its children.
All earlier history circles, flush selection fills, reduced header padding and flat
main/right-panel shells remain in place.

| Persistent Cards in Light | Persistent Cards in Dark |
| --- | --- |
| ![Separate navigation Cards with aligned immediate child labels in Light](after-persistent-cards-light.png) | ![Separate navigation Cards with aligned immediate child labels in Dark](after-persistent-cards-dark.png) |

| Small navigation text | Maximum supported text |
| --- | --- |
| ![All six open Cards with small text](after-persistent-cards-8px.png) | ![Cards and aligned labels at the maximum text size](after-persistent-cards-64px.png) |

## Current sidebar header colors and case

The six sidebar Card headers now use #5494fd with bold white titles in Light mode
and retain their purple #2f1d37 palette in Dark mode. Only their title spans are
always uppercase, including when Button Text is set to Lowercase. Child labels
keep the saved typography, and child selection keeps its independent highlight.
The breadcrumb Card remains white in Light mode. These images supersede the
header colors and casing in earlier screenshots.

| Blue headers in Light | Purple headers in Dark |
| --- | --- |
| ![Blue sidebar headers with uppercase titles in Light](after-sidebar-header-palette-light.png) | ![Purple sidebar headers with uppercase titles in Dark](after-sidebar-header-palette-dark.png) |

## Transparent titles, wider card spacing and chat provider marks

The shared content title header now has a transparent background, allowing the
main Card's stationary grid to continue behind the title and its action dropdown.
Top-level sidebar Card gaps are 16px, twice the former 8px. Project chat sidebar
entries show the provider logo from their own chat run, including on the leading
worker disclosure. Changing the global primary provider does not relabel saved
chats. Unknown provider artwork uses the existing terminal fallback. Relay,
custom-assistant and worker navigation artwork retain their identities.

| Transparent title and provider marks in Light | Transparent title and provider marks in Dark |
| --- | --- |
| ![Grid behind title with wider sidebar gaps and chat provider logo in Light](after-transparent-header-provider-light.png) | ![Grid behind title with wider sidebar gaps and chat provider logo in Dark](after-transparent-header-provider-dark.png) |

## Plan navigation and execution progress

View Plan now appears only in the centered blank/empty Files action list beside
Open Files and Open Memory Recall, reached through + New Tab from other views.
It reopens the current conversation's latest saved plan without accepting it or
creating another plan tab. The redundant button above the plan itself is gone.
The blank action list wraps and scrolls at narrow widths and enlarged text.

The bar is 12px tall and its equally weighted task count includes an integer
percentage: 33% (1 out of 3). Execution time appears above it, adding only running
intervals and continuing on Resume. Main owns the timer and persists five-second
checkpoints without changing plan revisions or Markdown. Restart preserves the
last recorded total and excludes downtime; legacy execution history is labelled
Not recorded until new, recorded-only time becomes available. Undo restores the
checkpoint's timing without reviving execution authority.

| Plan completion and execution time | Centered Files choices |
| --- | --- |
| ![Plan with rounded percentage, thicker progress bar and saved execution time](after-plan-execution-time.png) | ![View Plan beside Open Files and Open Memory Recall in the centered blank tab](after-plan-blank-actions.png) |

[Extreme narrow plan view with enlarged Button Text](after-plan-blank-narrow.png).
