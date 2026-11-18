# App artwork

User-supplied SVGs, retaining their original colors and geometry. Only each root
`viewBox` is trimmed to the artwork bounds to remove unequal empty margins:

- `robotic-arm.svg`: Automation Studio (replaces `operation.svg`)
- `megaphone.svg`: Command Builder (supplied as `megaphone (2).svg`)
- `pet.gif` and `pet.png`: Relay (120 frames, 2.4 seconds), with a transparent
  background and a non-looping animation.
- `steering-wheel.svg`: retained original Relay SVG source and geometry reference
  (supplied as `steering-wheel (5).svg`).
- `database.svg`: Data Viewer
- `ai.svg`: Prompt Builder
- `menu.gif` and `menu.png`: Apps (55 frames, 2 seconds), replacing the earlier
  applications animation. The white background is transparent.
- `labour-day.gif` and `labour-day.png`: Custom Agents (100 frames, 4 seconds),
  supplied as `labour-day (1).gif`; the exterior and central white opening are transparent.
- `home.gif` and `home.png`: Home (59 frames, 2 seconds).
- `apps.svg`: retained original Apps SVG source and geometry reference.
- `options.gif` and `options.png`: Settings (57 frames, 2 seconds), replacing the
  earlier gear animation. The white background is transparent. The GIF has no loop
  extension, so each playback runs once; the PNG is its transparent first frame.
- `cogwheel.svg`: retained original Settings SVG source and geometry reference.
- `project-initiation.gif` and `project-initiation.png`: Projects (97 frames,
  2.22 seconds). Only the exterior white background is removed; the rocket's
  white window stays opaque.
- `backlog.svg`: retained original Projects SVG source and geometry reference.
- `home2.svg`: retained original Home SVG source (supplied as `home (2).svg`).
- `color-palette.svg`: Settings → Appearance
- `folder.svg`: individual projects (supplied as `folder (1).svg`)
- `communication.svg`: individual orchestrator chats
- `down-right.svg`: individual subagents
- `text-size.svg`: Settings → Text
- `heart-rate.svg`: Settings → Polling
- `cloud-computing.svg`: Settings → Updates
- `analyze.svg`: Settings → Advanced
- `info.svg`: Settings → About
- `search.gif` and `search.png`: Search (162 frames, 3.56 seconds), supplied as
  `search (1).gif`; white background and lens interior are transparent.
- `search.svg`: retained original Search SVG source and geometry reference.
- `table.svg`: individual Data Viewer tables and Settings → Table defaults
- `under-construction.svg`: Contributor Tools
- `bookshelf.svg`: Settings → Memory
- `helmet.svg`: Settings → Agents
- `chemical.svg`: Settings → Advanced → Experiments

The monochrome Text icon uses the supplied SVG as a mask and inherits its label's
color, including in dark and forced-color themes. Its source geometry is unchanged.

`navigation-icon-viewboxes.json` records tight bounds measured by Chromium for all
52 supplied and Phosphor navigation icons. Icons fit their longest visible
dimension into the same 1em square without stretching. The desktop framing test
checks each viewport against the actual SVG geometry; integrity tests preserve the
original source checksums after restoring only the pre-crop viewports.
Toolbar icons and provider logos retain their existing sizing.

`NavigationIcon` shares this local artwork between sidebar navigation, page titles,
Apps cards and Home cards. Static title icons are 1em of the associated heading
text; animated icons use 2em and 72px on navigation cards, twice the ordinary size.
Relay, Search and Projects use 2.4em and 86.4px, a further 20% increase.
Settings, Search, Apps, Custom Agents, Home, Relay and Projects play once on hover
or keyboard focus in navigation cards, without restarting on the subsequent click.
The left sidebar and breadcrumb links play only on click, including keyboard
activation. Hover and focus alone never play sidebar animations;
noninteractive page headings stay still. Reduced motion and forced colors keep the still
frame; hidden documents stop playback. Interaction listeners are removed on disposal.
Vite emits separate
assets so no remote request, inline markup or CSP exception is needed.
