# App artwork

User-supplied SVGs, retaining their original colors and geometry. Only each root
`viewBox` is trimmed to the artwork bounds to remove unequal empty margins:

- `gear-wheel.gif` and `gear-wheel.png`: System Manager (63 frames, 2.52 seconds).
- `time-management.gif` and `time-management.png`: Scheduled Jobs (64 frames, 2.37 seconds).
- `robotic-arm.svg`: retained original Scheduled Jobs SVG and geometry reference.
- `speech-bubble.gif` and `speech-bubble.png`: Assistants sidebar section (35 frames,
  1.48 seconds), supplied as `speech-bubble (1).gif`. The exterior is transparent
  while the white bubble interior stays opaque. The animation runs once on click.
- `marketing-automation.gif` and `marketing-automation.png`: Command Builder (181 frames, 3.62 seconds).
- `megaphone.svg`: retained original Command Builder SVG and geometry reference (supplied as `megaphone (2).svg`).
- `pet.gif` and `pet.png`: Relay (120 frames, 2.4 seconds), with a transparent
  background and a non-looping animation.
- `steering-wheel.svg`: retained original Relay SVG source and geometry reference
  (supplied as `steering-wheel (5).svg`).
- `database-table.gif` and `database-table.png`: Data Viewer (85 frames, 2.22 seconds).
- `database.svg`: retained original Data Viewer SVG and geometry reference.
- `spell-book.gif` and `spell-book.png`: Prompt Builder (46 frames, 2 seconds).
- `ai.svg`: retained original Prompt Builder SVG and geometry reference.
- `menu.gif` and `menu.png`: Apps (55 frames, 2 seconds), replacing the earlier
  applications animation. The white background is transparent.
- `robot.gif` and `robot.png`: Custom Assistants (59 frames, 3 seconds), supplied
  as `robot (2).gif`. Only the exterior white background is transparent; the white
  head and chest details remain opaque. Playback runs once.
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
- `color-palette.svg`: Apps → Appearance
- `folder.gif` and `folder.png`: individual projects (79 frames, 2.12 seconds),
  supplied as `folder (1).gif`. Remove the exterior background, preserving the white star.
- `labour-day.gif` and `labour-day.png`: project orchestrator chats (100 frames,
  4 seconds), supplied as `labour-day (1).gif`. Exterior and gear opening are transparent.
- `drone.gif` and `drone.png`: subagents (109 frames, 2.4 seconds). Exterior is transparent.
- `folder.svg`, `communication.svg`, `down-right.svg`: retained original artwork
  and SVG geometry references for projects, orchestrator chats and subagents.
- `text-size.svg`: Settings → Text
- `heart-rate.svg`: Apps → Polling
- `cloud-computing.svg`: Apps → Update Manager
- `analyze.svg`: Settings → Advanced
- `info.svg`: Settings → About
- `search.gif` and `search.png`: Search (162 frames, 3.56 seconds), supplied as
  `search (1).gif`; white background and lens interior are transparent.
- `search.svg`: retained original Search SVG source and geometry reference.
- `table.gif` and `table.png`: individual Data Viewer tables and Settings → Table defaults (109 frames, 2.9 seconds).
- `table.svg`: retained original table SVG and geometry reference.
- `under-construction.svg`: Contributor Tools
- `bookshelf.svg`: Apps → Memory
- `helmet.svg`: Providers
- `chemical.svg`: Settings → Advanced → Experiments

The original Text SVG remains a geometry reference; the visible Text icon uses
the supplied colored font-size.gif and still poster.

`navigation-icon-viewboxes.json` records tight bounds measured by Chromium for all
52 supplied and Phosphor navigation icons. Icons fit their longest visible
dimension into the same 1em square without stretching. The desktop framing test
checks each viewport against the actual SVG geometry; integrity tests preserve the
original source checksums after restoring only the pre-crop viewports.
Toolbar icons and provider logos retain their existing sizing.

`NavigationIcon` shares this local artwork between sidebar navigation, page titles,
Apps cards and Home cards. Static title icons are 1em of the associated heading
text; animated icons use 2em and 72px on navigation cards, twice the ordinary size.
Project, orchestrator and subagent icons share the animated sizes; worker page
heading icons retain 1em. Apps sidebar descendants, including individual tables,
use 2.5em icons (25% larger); navigation cards and breadcrumbs keep their existing sizes.
Relay, Search, Projects and Custom Assistants use 2.4em and 86.4px, a further 20% increase.
System Manager, Prompt Builder, Scheduled Jobs, Command Builder, Data Viewer, tables, Assistants, Settings, Search, Apps, Custom Assistants, Home, Relay and Projects play once on hover
or keyboard focus in navigation cards, without restarting on the subsequent click.
The left sidebar and breadcrumb links play only on click, including keyboard
activation. Hover and focus alone never play sidebar animations; the Assistants
section header follows this click-only behavior.
noninteractive page headings stay still. Reduced motion and forced colors keep the still
frame; hidden documents stop playback. Interaction listeners are removed on disposal.
Vite emits separate
assets so no remote request, inline markup or CSP exception is needed.

The four scheduled-job/command/data GIFs remove only the exterior white background,
preserving enclosed white clock, megaphone and table details. Their 640px canvases,
frame counts and exact per-frame delays are preserved; playback runs once.

System Manager and Prompt Builder preserve enclosed white artwork details and their
640px canvases. Their exterior white backgrounds are transparent. Playback uses
the same hover/focus-once card and click-only sidebar behavior as other animated icons.

About uses `info.gif`/`info.png` (27 frames, 1.48 seconds); Advanced uses
`laptop.gif`/`laptop.png` (174 frames, 3.6 seconds); Providers uses
`setting.gif`/`setting.png` (180 frames, 3.6 seconds); Memory uses
`books.gif`/`books.png` (124 frames, 3 seconds). All supplied 640px canvases and
exact frame delays are preserved. Only exterior white background is removed;
white information glyphs, lenses, server labels and book details remain opaque.
Playback runs once through the shared navigation interaction rules. Original SVGs
remain as source/geometry references.

Polling uses `heartbeat.gif`/`heartbeat.png` (92 frames, 2.3 seconds); Appearance
uses `painting.gif`/`painting.png` (131 frames, 2.8 seconds); Text uses
`font-size.gif`/`font-size.png` (127 frames, 3.6 seconds). All original 640px
canvases and exact frame delays are retained; exterior white is transparent,
enclosed white details remain opaque, and playback runs once.

Updates uses `download.gif`/`download.png`, supplied as `download (3).gif`
(37 frames, 1.5 seconds, 640x640). Exterior white is transparent; all frames and
exact per-frame delays are retained. Playback runs once through shared controls.
`cloud-computing.svg` remains its original source/geometry reference.

- `history-back.gif` / `history-back.png`: Back, supplied as `arrows.gif`
  (45 frames, 2 seconds, 640x640).
- `history-forward.gif` / `history-forward.png`: Forward, supplied as `arrows (1).gif`
  (46 frames, 2 seconds, 640x640).
  Exterior white is transparent; foreground colors, canvas, frames and exact
  per-frame delays are retained. Looping is disabled for one playback per click,
  including Enter/Space activation. Hover and focus alone stay still; reduced
  motion/forced colors retain the poster.
