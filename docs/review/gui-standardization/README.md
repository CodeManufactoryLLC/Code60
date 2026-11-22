# GUI standardization visual review

Synthetic project fixtures from the Linux Electron/Playwright harness; no real
workspace content or credentials. Before is current main at `053126a`. After
shows this branch's white reading surfaces, unified sidebar, navigation combobox,
main-card panel toggles, Files dropdown and file-only Close action below its header.

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
previous placement. Current breadcrumbs and keyboard parents use Apps; Settings
retains About, Advanced, Table defaults and Text. Existing preferences and update
check/download/install controls keep their state and permissions. The Data Viewer
Polling monitor remains separate from Apps → Polling controls.

| Apps in Light (narrow, scrolled to Update Manager) | Apps in Dark |
| --- | --- |
| ![Moved preferences in Apps and the Update Manager card in Light](after-apps-preferences-light.png) | ![Moved preferences in Apps and the Update Manager card in Dark](after-apps-preferences-dark.png) |
