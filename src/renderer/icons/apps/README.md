# App artwork

User-supplied SVGs, retaining their original colors and geometry. Only each root
`viewBox` is trimmed to the artwork bounds to remove unequal empty margins:

- `robotic-arm.svg`: Automation Studio (replaces `operation.svg`)
- `megaphone.svg`: Command Builder (supplied as `megaphone (2).svg`)
- `steering-wheel.svg`: Relay (supplied as `steering-wheel (5).svg`)
- `database.svg`: Data Viewer
- `ai.svg`: Prompt Builder
- `apps.svg`: Apps
- `cogwheel.svg`: Settings
- `backlog.svg`: Projects
- `home2.svg`: Home (supplied as `home (2).svg`)
- `color-palette.svg`: Settings → Appearance
- `folder.svg`: individual projects (supplied as `folder (1).svg`)
- `communication.svg`: individual orchestrator chats
- `down-right.svg`: individual subagents
- `text-size.svg`: Settings → Text
- `heart-rate.svg`: Settings → Polling
- `cloud-computing.svg`: Settings → Updates
- `analyze.svg`: Settings → Advanced
- `info.svg`: Settings → About
- `search.svg`: Search
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
Apps cards and Home cards. Title icons are 1em of the associated heading text.
Vite emits separate
assets so no remote request, inline markup or CSP exception is needed.
