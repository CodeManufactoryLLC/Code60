# Tactics validation and live evaluation

Tactics are versioned orchestration prompts, not an enforced workflow engine.
Worker turns ending, prompt routing tests, and passing application tests do not
prove that a model followed a tactic or completed a task.

## Deterministic checks

Run `npm run check`. It covers catalog/schema validation, selection and clear
without dispatch, immutable task prompts, interleaved worker turns and correction
updates, command expansion, persistence failures, bounded/link-rejecting reads,
and explicit ACP restore and handoff. Stopped history restores no worker ownership,
gateway, inbox or plan execution authority. Existing plan acceptance and reviewed
application tests remain authoritative.

Run production UI checks only in Docker:

```sh
npm run test:desktop:container -- --grep "Tactics preview|Chat.*stopped startup|read-only task revisions"
```

The Tactics scenario exercises search/no matches, preview versus Apply, full shared
instructions, Home/End/arrow keys, focus containment/restoration, Escape, a real
storage failure and successful retry, unchanged drafts, explicit removal, Light
and narrow Dark layouts, Send, restart, and explicit continuation. The container
runner removes its containers/images and retains caches and test artifacts.

## Opt-in live evaluation

```sh
npm run test:tactics:live
```

This uses the desktop's already verified, configured ACP provider and can incur
provider charges. It does not install tools, change credentials or update the
user's preferences. Git must already have a configured identity. It runs the
real desktop controller and authenticated worker gateway without opening Electron.

The runner creates private synthetic repositories in a generated temporary
directory. Fixture commits use the existing Git identity; it never commits to this
product repository, applies worker changes or touches a real project. Generated
fixtures/worktrees remain available for inspection. Private reports and synthetic
transcript evidence go to `test-results/tactics-evaluation/<timestamp>`.

Each task runs once with ordinary orchestration and once with its tactic, using
fresh, identical files and the same human request, provider, four-worker capacity,
and three-minute turn/evaluation deadlines:

| Task | Independent verification |
| --- | --- |
| Independent review | Pending `>` to `>=` ledger change rejects valid `withdraw(10, 10)`. Confirm the cited line/trigger and check that review did not repair files. |
| Diagnose a bug | Reproduce the boundary error. Independently run each worker's tests and check full/zero balance withdrawal, negative amounts and overdrafts. Inspect the added regression and reported fail/pass evidence. |
| Explore the codebase | Verify handler → ledger → storage and test references against the actual fixture files. Check that files stayed unchanged. |

Reports retain elapsed orchestration time, worker counts, timeouts, human
corrections (zero unless an operator intervenes), independently checked worker
results and returned references/findings. Total tokens/cost stay unavailable when
ACP reports only context occupancy. Do not reinterpret occupancy as usage totals.

The quiet/ended-turn condition only stops observation. It does not establish task
success. Inspect the evidence and recorded checks before scoring a result.
One small matched sample per task is a smoke evaluation, not a general quality,
speed or cost claim. Record blocked, incomplete and timed-out results as such.

## Recorded live results

Configured provider: Droid. One ordinary/tactic pair per task, no operator
corrections, four available worker slots, and a 180-second observation deadline.
Elapsed times exclude setup and the independent post-run checks.

| Task | Ordinary | Tactic |
| --- | --- | --- |
| Independent review | 96.5 s, one worker. Delivered the supported equality-boundary finding. | 180.0 s, two workers. Captured the pending change and started a fresh reviewer, but delivered no final findings before the deadline. Incomplete. |
| Diagnose a bug | 99.1 s, one worker. Minimal fix, added regression, final evidence delivered. | 180.1 s, one investigator reused for correction. Correct fix and added regressions were present, but final orchestration evidence was not delivered before the deadline. Incomplete orchestration. |
| Explore the codebase | 63.3 s, one worker. Supported handler, ledger, storage and test references. | 86.8 s, separate code/test scouts. Supported the same four file references and coverage gaps. |

Independent checks reproduced the original equality bug in all six untouched
project checkouts. Review/Explore workers made no source repairs; the tactic
review's capture worker retained an untracked factual snapshot directory.
Both Diagnose workers passed separately authored assertions for full/zero
balance withdrawal, partial withdrawal, negative/nonfinite amounts and overdraft.
Their actual suites passed 3/3 and 7/7 tests respectively. Running those same
added tests against a scratch copy of the original broken implementation failed
1/3 and 3/7 tests respectively, confirming useful regression coverage. Nothing
was applied to the project checkouts.

This sample does **not** demonstrate improved quality or speed. The two extra
stage-oriented tactic runs exceeded the shared deadline; their available worker
evidence must not be presented as completed orchestration. Total token/cost usage
was not available and was not estimated.

Local private artifacts:
`test-results/tactics-evaluation/2026-11-11T00-54-46.960Z/summary.json`,
the six event/report pairs, and `independent-verification.json`.
The verification directory preserves the scratch red-test inputs. Non-Diagnose
reports' automated regression/test flags were not exercised; they are not failed
test results.
