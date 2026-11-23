# Workflow QA report

- Revision / local diff:
- Environment (headless browser/native CI, runtime, fixture providers):
- Scope selected from behavior and reported starting state:
- Overall: PASS / FAIL / BLOCKED (any required blocked/failed journey prevents PASS)

## Scenario: descriptive user outcome

- Classification: full UI journey / supporting integration / static / authorized live-provider
- Status: PASS / FAIL / BLOCKED
- Prerequisites and actual starting state:
- Exact command:
- User actions and checkpoints reached:
- Expected outcomes and independent oracle:
- Actual outcomes (include intermediate invariants):
- Evidence paths (trace, synthetic files/index/process comparisons):
- Coverage gaps, blocker, and next safe action:

## Cleanup

- Owned app/provider/service processes and observed exit:
- Owned container removal:
- Owned exported image removal:
- Synthetic fixture cleanup:
- Intentionally retained artifacts and caches:
- Cleanup failures (do not claim success without checking):

## Checks outside the journey

List unit/static/collection results separately. State explicitly when native login-service
execution was not performed; these checks do not establish an E2E PASS.
