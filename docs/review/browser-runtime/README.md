# Browser runtime migration review

Implemented on `codex/browser-first-gateway`, based on origin/main
`7ea2c5429ec59d143696030ade0a518f15f0afd9`. The original checkout's 58
unrelated modified files were preserved; all implementation is in its separate
worktree. This record describes local validation, not a published release.

## Result

Electron and its native entrypoints, preload, updater, installers and packaging
harness are removed. The extracted application host and scheduler run in one
local Node 24 backend. The browser uses authenticated loopback operations and
an event stream, with explicit takeover, page-bound decisions and bounded host
selection. Browser closure preserves approved work; confirmed backend stop
quiesces both components before releasing ownership. A narrow management CLI
handles open/pair and opt-in per-user login service management. Development uses
Vite React Fast Refresh with backend-only restarts for compiled backend changes.

Existing stores and domain policies remain separate. Feature-slice restructuring
and SQLite consolidation were not included. The package version remains 0.4.1;
release preparation must make the required major bump before distribution.

## Validation

The full `npm run check` includes instruction, type, Biome, unused-code and
coverage gates. Browser tests drive the built renderer/backend with fake ACP
processes and isolated HOME/config/state, not a preverified provider setup.

- First-use setup, database creation and host project chooser; plan displayed
  before dispatch, explicit acceptance, automatic integration, read-only diff,
  code attachment, preserved draft on refresh and declined/confirmed Undo.
  Exact checkout/worker files, staged/unstaged edits, index bytes and HEAD are
  checked independently.
- Approved conversation and scheduled work continue without a browser. Explicit
  takeover reattaches without resubmission. Scheduled work stays in its own
  worktree and never changes the checkout/index/HEAD.
- Pending agent permission survives refresh, Deny reaches the provider, and Stop
  prevents a later write. Custom assistant creation, memory preferences, manual
  update information, two-project navigation and real file search work through UI.
- Confirmed backend stop closes connections; restart retains the database and
  restores history without launching workers. Declining stop preserves the backend.
- Transport contract checks exercise every browser API method against the fixed
  gateway operation surface and verify explicit authentication, same-origin fetch,
  unique request IDs and no retry after an uncertain consequential result.
- Injected supervisor tests cover consent, Node pinning, PID mismatch, drain before
  stop, partial enrollment metadata, original pause preservation after handoff
  failure and conservative launchd unload/uninstall verification.
- Clean-prefix tarball installation verifies CLI, bundled assets, foreground
  backend and actual offline embedding model. The separate offline model smoke
  checks relevance, persistence, cancellation and preservation after failure.
- A real development-browser smoke verifies React Fast Refresh retains an unsent
  field without document reload or backend restart, with no React/CSP errors.
  Direct SIGTERM shutdown of the development parent leaves no backend, compiler
  or Vite child. Startup emits one backend URL after watch compilation is ready.

Electron-specific UI/native assertions were retired with the removed shell.
The new browser suite covers critical user journeys; it is not a one-for-one port
of every historical native/visual assertion. Renderer replay and artwork tests
remain supporting integration tests, separate from the complete backend journeys.

## Coverage and retained limits

All surviving four-metric floors are unchanged, with application paths moved
from `src/desktop`. The deleted Electron preload's individual 100% floor is
retired. New per-file four-metric floors cover chooser, interactions, registration,
server, sessions and management CLI. No Knip exclusion was broadened.

Local verification used macOS arm64, Node 24.22.0 and headless Chromium. Actual
launchd/systemd installation, login/logout behavior, supervisor crash recovery and
native repair/update/uninstall were not exercised. Linux execution remains a CI
validation gate. No real service, live provider, Git hook or external release was
installed, invoked or published. No Docker resources were created.

The repository secret scan reports one historical false positive in commit
`dc3034642ccf550cbe4a6dfdeb8d540ac5bce9d1`,
`src/renderer/neobrutalism/README.md:121`: a documented registry SHA-256 was
classified as a generic API key. It was reviewed as a provenance digest; no
credential value was printed, no new finding was reported, and no scanner rule
or Git history was changed to hide it.

For the operating contract see [architecture](../../../ARCHITECTURE.md),
[the migration record](../../gateway-daemon-migration-plan.md),
[release requirements](../../../RELEASING.md) and
[workflow QA](../../../.factory/skills/qa/SKILL.md). Detailed local results and
screenshots are retained under ignored `test-results/`.
