# Workflow player QA

Base: `origin/main` at `7ea2c54`. The tests used an isolated Linux desktop profile, fake drafting provider, scripted Transmission HTTP engines, and a temporary Git repository with staged, unstaged, and untracked files. The renderer, preload, bridge, registry, and Git operations were real.

| Journey | Result | Observations |
| --- | --- | --- |
| Create, run, interrupt, and finish a staging.20 workflow | PASS | Manual and prompt-assisted entry required human review and Start. Clarification preserved the fields; refinement updated them. The run survived desktop exit. Pause and resume kept the run ID and excluded confirmed pauses from the timer. The player displayed rejection, repair, verification and acceptance, queued guidance, and handled an offered permission choice. It retained state while disconnected. Stop required confirmation and could settle a lost acknowledgement. |
| Open an existing staging.18 workflow | PASS | An unversioned record remained readable. Reconnect and supported actions used the original engine. The player disabled pause/resume and omitted the pause suggestion from the stop warning. Linux's normal execution restriction was checked before connecting the fixture. |

Original validation used the former Electron container runner (2 passed). The browser branch ports these journeys; see [browser runtime QA](../browser-runtime/README.md) for current validation. Independent checks confirmed the same run after quit, unchanged source HEAD and index, retained worktree output, and worker exit after cancellation. No session-owned Docker test containers or exported images remained. Dependency and BuildKit caches were retained.

Supporting validation: 82 focused tests passed; `npm run check` passed with 2,804 tests and all four coverage gates. `npm run generate:capabilities` and `npm run build` succeeded. Packaged macOS and live provider execution were not tested. The scripted journeys exercise the client integration; they do not establish how the published engine behaves under a real Codex workload. The known staging.18 retry limitation across restarts remains.

| Layout | Dark | Light |
| --- | --- | --- |
| Desktop (1400 px) | [Desktop, dark](workflow-1400-Dark.png) | [Desktop, light](workflow-1400-Light.png) |
| Narrow (640 px) | [Narrow, dark](workflow-640-Dark.png) | [Narrow, light](workflow-640-Light.png) |

Local logs, independent outcomes and cleanup evidence are retained in `test-results/qa/workflow-player/` in the prototype worktree.
