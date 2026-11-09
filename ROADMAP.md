# Code60 roadmap

[GitHub roadmap tracker #79](https://github.com/CodeManufactoryLLC/code60/issues/79)
and [versioned milestones](https://github.com/CodeManufactoryLLC/code60/milestones)
are the source of truth for scope, dependencies, acceptance criteria and progress.
This page provides orientation and links. The versions below describe planned
outcomes; they do not claim that the capabilities have shipped.

## Version sequence

| Target milestone | Intended outcome |
| --- | --- |
| [v0.3.0 — Safe desktop baseline](https://github.com/CodeManufactoryLLC/code60/milestone/2) | Fix unsafe discard, file access, permission decisions, sensitive output and database waits; remove the public CLI. |
| [v0.4.0 — Durable local runtime](https://github.com/CodeManufactoryLLC/code60/milestone/3) | Introduce the app-managed runtime/store, shared contracts, bounded history and reliable review storage; separate controller and renderer responsibilities. |
| [v0.5.0 — Explicit task completion](https://github.com/CodeManufactoryLLC/code60/milestone/4) | Bind task goals, required outputs, verification and human acceptance to exact revisions. |
| [v0.6.0 — Reliable background execution](https://github.com/CodeManufactoryLLC/code60/milestone/5) | Supervise processes independently and support window close/reopen, explicit Quit and attention notifications. |
| [v0.7.0 — Scoped authority and optional Docker](https://github.com/CodeManufactoryLLC/code60/milestone/6) | Add scoped authority, credential delivery and optional Docker workers with enforced filesystem, network and resource boundaries. |
| [v0.8.0 — Global scheduling and usage accounting](https://github.com/CodeManufactoryLLC/code60/milestone/7) | Schedule and account for workers, helpers, verification and retries through shared limits and budgets. |
| [v0.9.0 — Reproducible context and provider adapters](https://github.com/CodeManufactoryLLC/code60/milestone/8) | Record context provenance and instruction delivery; publish tested provider/adapter capability differences. |
| [v0.10.0 — Safe reconciliation and bounded recovery](https://github.com/CodeManufactoryLLC/code60/milestone/9) | Reconcile interrupted effects and add bounded recovery, retries and useful-progress checks. |
| [v0.11.0 — Versioned workflows and extensions](https://github.com/CodeManufactoryLLC/code60/milestone/10) | Add immutable workflows with branches, joins, loops, durable waits and governed code/tool/retrieval steps. |
| [v0.12.0 — Operability and product readiness](https://github.com/CodeManufactoryLLC/code60/milestone/11) | Complete diagnostics, export/restore, performance, accessibility, quickstarts and operational disclosures. |
| [v1.0.0 — Supported release](https://github.com/CodeManufactoryLLC/code60/milestone/12) | Establish supported contracts and verify final native installers, provider/backend combinations and checklist claims. |

## Why this order

Correct existing safety and correctness failures first. Durable task identity,
state and execution ownership then provide the foundation for trustworthy
verification and background operation. Authority and execution boundaries must
be explicit before scheduling more work under shared budgets.

Context provenance and provider capability contracts make recovery decisions
reviewable. Reconciliation precedes richer workflows so branches, loops and
extensions inherit the same execution, approval and accounting rules. The final
milestones establish operational usability and evidence for supported claims.

The tracker links the architectural issues and the core-capability/checklist
crosswalk. Each milestone links its required implementation issues and a release
preparation issue.

## Product direction

- Deliver a desktop application with a private headless runtime API. Remove the
  public Code60 CLI in v0.3.0; provider CLIs remain supported prerequisites.
- Allow breaking changes before 1.0 without legacy migration support. Preserve
  existing repositories, worktrees and old application data.
- Use an app-managed local runtime and store, with project folders as the primary
  user concept.
- Keep execution running when its window closes. Explicit Quit cancels and stops
  owned execution.
- Keep native host execution as the default and add optional Docker Linux workers
  before 1.0. Container verification is distinct from native-platform verification.
- Retain Windows 11 x64, macOS Apple Silicon and Linux x64 targets, with exact
  tested environments and provider/backend limits recorded in GitHub.

## Using the backlog

Choose work from [GitHub issues](https://github.com/CodeManufactoryLLC/code60/issues)
whose dependencies are satisfied. Each implementation issue has one target
milestone. Implementing PRs close their issues after acceptance criteria pass
and changes merge; published releases establish which version shipped the work.

Follow [the release guide](RELEASING.md) for release preparation. Milestones stay
open until their final target version is published. Version targets have
acceptance gates and no committed dates.

Update this page when the intended outcomes or release sequence change. Routine
issue and PR activity is tracked in GitHub.
