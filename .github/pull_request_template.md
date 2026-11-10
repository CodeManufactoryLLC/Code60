<!--
Complete each section. Use "Not applicable" with a reason where needed.
Remove credentials, private prompts, repository content, and personal information
from logs and screenshots before attaching them.
-->

## Description

<!-- Explain what changed, why it is needed, and the expected behavior.
For a bug fix, describe the original problem and how this change resolves it. -->

## Testing done

<!-- Record exact commands and results, not just "tested".
Run `npm run check` before each commit. For desktop changes, also run
`npm run test:desktop:container` (Docker with a Linux engine). Include
regression coverage for behavior changes and manual reproduction steps where
relevant. -->

- Automated checks and results:
- Manual verification and environment (OS, architecture, Node.js version):
- Checks not run and why:

## Relevant context

<!-- Link issues, design decisions, and supporting evidence.
Use `Closes #<issue-number>` only when this PR meets the issue's acceptance criteria.
For visual changes, include redacted before/after screenshots or a recording.
Call out changes to CLI flags, output, exit codes, config files, or run records,
including migration or rollback steps when needed. -->

- Related issues or design:
- Affected interfaces, modules, and platforms:
- Compatibility changes, risks, and follow-up work:

## Review checklist

<!-- Check completed items. Explain any item that does not apply in the
Testing done or Relevant context section rather than implying it was tested. -->

- [ ] `npm run check` passes.
- [ ] Tests cover changed behavior, including a regression test for bug fixes.
- [ ] Desktop changes have been verified with `npm run test:desktop:container`.
- [ ] CLI help and relevant documentation reflect user-visible changes.
- [ ] Changes follow `ARCHITECTURE.md` and the applicable `AGENTS.md` instructions.
- [ ] Each commit includes the Developer Certificate of Origin sign-off required by `CONTRIBUTING.md`.
