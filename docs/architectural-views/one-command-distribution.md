# One Command Setup and Distribution

Draft

## Motivation

Make Code60 easy for developers to try: one command should lead to a working
browser UI, with initial database setup handled automatically.

## Description

### Setup

Use npm as the primary distribution channel, with a proposed entry point such as
`npx --yes code60@latest setup`. Handle installation and backend setup together,
then open the browser for provider onboarding and project selection.

### Distribution

Deliver Code60 as a single self-contained payload with workflows built directly
into the backend. Make updates a single explicit operation that preserves user
data and unfinished work.

## Tradeoffs

### Pros

- A familiar developer entry point reduces setup and maintenance work.
- Shipping a single backend removes the need to package or manage a separate
  workflow daemon.

### Cons

- Node, npm, Git and provider setup remain prerequisites.
- Code60 takes responsibility for component compatibility and reliable updates.
