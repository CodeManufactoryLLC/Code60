# One Command Setup and Distribution

Draft

## Motivation

Make Code60 easy for developers to try: one command should lead to a working
browser UI, with initial database setup handled automatically.

## Description

### Setup

Use npm as the primary distribution channel, with a proposed entry point such as
`npx --yes code60@latest setup`. Handle installation and Gateway setup together,
then open the browser for provider onboarding and project selection.

### Distribution

Deliver compatible Code60 and Transmission components together, while preserving
the workflow engine's independent execution lifetime. Make updates a single
explicit operation that preserves user data and unfinished work.

## Tradeoffs

### Pros

- A familiar developer entry point reduces setup and maintenance work.
- Coordinated releases remove the need to manage Transmission separately.

### Cons

- Node, npm, Git and provider setup remain prerequisites.
- Code60 takes responsibility for component compatibility and reliable updates.
