# Security Policy

Code60 runs coding agents on your machine. Its desktop safeguards protect the
application interface; they do not sandbox the agents you launch. Read the
limitations below before giving an agent access to sensitive repositories.

## Runtime safeguards and limits

- **Desktop interface isolation.** The Electron renderer uses the Chromium
  sandbox, context isolation, no Node.js integration, and a restrictive Content
  Security Policy. External navigation, new windows, and webviews are blocked.
- **Validated desktop requests.** A fixed preload API exposes specific
  capabilities, not raw IPC or arbitrary command execution. The main process
  checks the sender, validates requests, and checks workspace/run ownership.
- **Scoped local agent controls.** The orchestration MCP sidecar connects to a
  token-authenticated gateway bound to `127.0.0.1`. Requests have size and time
  limits. Worker mutations require the current chat/project scope and ownership;
  workers do not receive the Code60 MCP server.
- **Private run records.** Newly created run directories and files use
  restrictive filesystem permissions. See [local data](#local-data-and-sensitive-records)
  for what they contain and where they live.

These controls are not a guarantee that agent actions are safe. An agent runs
with your operating-system permissions. A worktree separates Git changes, not
filesystem or network access. Without a Git repository containing a commit,
agents work directly in the selected directory; parallel runs can overwrite
each other's changes.

Prompts, repository content, agent responses, and tool output can be malicious
or misleading. Behavioral instructions such as the Operating Contract are not
security boundaries. Review agent changes yourself; a `finished` run means the
agent ended its turn normally, not that its changes were verified.

Technical details: [desktop security](ARCHITECTURE.md#desktop-security),
[module boundaries](ARCHITECTURE.md#modules), and
[runs without a worktree](ARCHITECTURE.md#runs-without-a-worktree).

## Agent permissions

Code60 answers permission requests reported by the agent through ACP. This
policy is not an operating-system sandbox and cannot constrain actions an
agent does not submit for approval.

- **CLI and manual desktop runs:** the default policy allows `read`, `search`,
  `think`, and `edit`, and asks for other kinds. In the headless CLI, `ask`
  means deny, never an interactive prompt. Configuration and the CLI's
  `--allow` and `--allow-all` flags can change these decisions.
- **Orchestration chats and their workers:** Code60 automatically allows
  permission requests using the agent's supported `allow_once` option. These
  sessions do not use the manual-run policy to ask you for each action.
- **Once-only decisions:** Code60 chooses the corresponding once-only
  allow/deny option, never an always-allow grant. If no matching once-only
  option exists, the request is answered as cancelled. Once-only does not
  mean harmless; orchestration can approve repeated requests automatically.

The provider's **Harness mode** is separate from Code60's approval policy.
Choosing an Ask mode does not turn off Code60 auto-approval in orchestration
chats or workers. Any provider sandbox or other restrictions depend on that
provider and its configuration.

See [permissions](ARCHITECTURE.md#permissions) and
[harness modes](ARCHITECTURE.md#session-information-and-harness-modes).

## Local data and sensitive records

Code60 stores run records and transcripts as local `run.json` and
`events.jsonl` files:

| Run type | Record directory |
| --- | --- |
| Project runs in a Git repository | `<git-common-dir>/code60/runs/<run-id>/` |
| Runs outside a Git repository | `$XDG_STATE_HOME/code60/dirs/<key>/runs/<run-id>/` (default state home: `~/.local/state`) |
| Desktop orchestration chats | `.code60_workspace/<chat-folder>/.code60/runs/<run-id>/` beside the connected SQLite database |

The directory key for non-Git runs is derived from the directory's absolute
path. Desktop project metadata and saved configurations also live in the
user-selected SQLite database. See [files](ARCHITECTURE.md#files) for the full
storage contract.

On macOS and Linux, new run directories use mode `0700` and record files use
`0600`. On Windows, Code60 uses private owner/SYSTEM ACLs for new private
objects and rejects unsafe existing private ACLs. Filesystem permissions do
not protect against processes running as you, administrator access, backups,
or copies you make. The JSON transcript files are not encrypted by Code60.

Records can contain your first prompt, later prompts, agent messages,
thoughts, raw ACP updates, tool inputs/outputs, stderr, and process metadata.
**Transcripts are private records, not automatically scrubbed or expired.**
Prompts, messages, tool payloads, and raw ACP updates remain intact; existing
records are not rewritten.

Operational errors and stderr receive best-effort credential redaction before
clipping. This covers common credential assignments, authorization headers,
URL user information, known token formats, and private-key blocks. Stderr keeps
at most a 64 KiB scrubbed tail; oversized lines are omitted. CLI progress omits
tool/permission titles and status reasons, and ACP provider failures use generic
messages rather than echoing provider error text. Result fields and exit-code
semantics are unchanged, but diagnostic reasons may be redacted.

This is not a general secret detector, PII anonymizer, or guarantee against
disclosure. Per-update and stderr limits are not a total log-size or retention
limit. Diagnostics and screenshots can still expose sensitive data.

Do not attach whole run directories or raw logs to public issues. Inspect
and redact any material you share, including prompts, tokens, private paths,
source code, and personal information. Avoid putting credentials into
prompts or configured command arguments; agents authenticate through their
own CLIs.

## Desktop diagnostic logs

Tables → Logs is a desktop-only operational history, available without a project
database. It is separate from the Events table and `events.jsonl` transcripts.
Local JSONL files live under `$XDG_STATE_HOME/code60/logs` (default
`~/.local/state/code60/logs`) and persist across app restarts.

**Only diagnostic logs** have a seven-day, 20 MiB total retention cap, including
active files. Reads and writes prune retained data and queries hide expired
records. Clear logs requires native confirmation and deletes diagnostic logs
only. Existing transcripts, run records, reviews and SQLite data are not expired,
scrubbed or deleted by either policy.

Diagnostic records use fixed messages and allowlisted identifiers, event names,
severity, outcomes, durations and error categories/codes. They do not contain
prompts, transcripts, raw ACP/tool payloads, environment values, command arguments,
absolute paths or arbitrary exception text. Project IDs are hashes, not a promise
of anonymity. No free-form diagnostic text is currently accepted. Any future
approved diagnostic text must receive existing credential redaction before bounded
UTF-8 truncation. Redaction is best effort, not a secret detector or PII anonymizer.

Private POSIX modes/ownership and Windows owner/SYSTEM ACL checks reject unsafe
storage and links. Cross-process locking protects concurrent rotation and quota
enforcement. Queues, records, queries and shutdown flushing are bounded; failed
persistence and dropped records are visible, and malformed/truncated records are
skipped with a partial-history notice. Diagnostic capture can lose data after a
crash, storage failure or queue overflow; it is not an audit or recovery authority.
Counts of write failures/drops describe this app launch, not a durable audit total.
Logs are unencrypted and readable by processes running as you. Inspect copied
records and screenshots before sharing.

Only narrow, validated preload query/detail/clear methods can access logs.
There is no generic path/filesystem method and no agent/MCP log access. The CLI
does not enable capture and gains no flags, output or recording changes.

## Providers and network access

Local record storage does not mean that your task data stays on your machine:

- Code60 sends prompts and context to the configured agent process. Depending
  on that agent's tools, provider, and configuration, prompts, repository
  content, and tool output may be transmitted to external services. Review
  the provider's privacy, retention, and training policies separately.
- Optional user-managed `mcpServers` definitions are also sent to the selected
  provider through ACP, including any configured environment/header values.
  The agent owns stdio processes and HTTP/SSE connections. Only configure
  trusted providers and servers; Code60 does not sandbox MCP tools, implement
  OAuth, or write credentials. Definitions are not added to run records,
  transcripts, renderer snapshots or CLI results, but arbitrary agent/tool
  output can still disclose sensitive content. Keep the config private.
  User servers cannot replace or inherit the built-in `code60` gateway.
  See [MCP configuration](MCP.md) for transport support and session lifecycle.
- Desktop continuation may restore a provider session or send a handoff
  summary built from saved prompts, messages, and tool-call summaries.
  Search overviews and memory extraction also send selected evidence to
  the configured agent; search overviews can include project-file excerpts.
  Temporary working directories and denied helper permission requests are
  not filesystem sandboxes.
- Supported packaged desktop builds check GitHub for updates automatically
  by default. You can disable automatic checks in **Settings > Updates**.
  Downloads and installation require explicit user actions. Disabling
  update checks does not disable provider network access.

See [ended-run recovery](ARCHITECTURE.md#ended-run-recovery),
[consolidated search](ARCHITECTURE.md#desktop-app), and
[desktop distribution](ARCHITECTURE.md#desktop-distribution).

## Supported versions

Only the latest released version of Code60 receives security fixes. Upgrade to
the latest release before reporting an issue when practical.

## Reporting a vulnerability

Report suspected vulnerabilities privately to
**[support@code60.dev](mailto:support@code60.dev)**.
Do not open a public issue or publish exploit details before coordinated disclosure.

Include the affected version, platform, steps to reproduce, and the potential
impact. Provide a minimal example when possible, without credentials, private
prompts, or other sensitive data.

We aim to acknowledge reports within five business days. After reviewing the
report, we will share our assessment and coordinate fixes and disclosure with
you. This is a response target, not a guarantee of a fix date.

## Automated security reviews

The **Security review** workflow (`.github/workflows/security-review.yml`) runs
on every pull request, every push to `main`, Mondays at 07:23 UTC, and manual
dispatch. Scheduled scans also catch newly published advisories when the code
has not changed.

- **CodeQL** scans JavaScript and TypeScript with the `security-extended` query
  suite, without building or running the application. Findings include locations,
  explanations, and remediation guidance in **Security > Code scanning** and
  the pull request's code scanning check. The `codeql-security-report` artifact
  retains the full SARIF assessment, including scans with no findings.
- **Dependency security report** audits the lockfile, including development
  dependencies, without installing packages or running lifecycle scripts. The
  Actions job summary contains the readable npm report with affected packages,
  advisory links, dependency paths, and available fixes. The
  `npm-security-report` artifact retains the full text report.
- **Secret scanning** uses checksum-pinned Gitleaks to scan all fetched Git
  history and current files, including untracked files during local scans.
  Only generated directories are excluded; tests and environment files are
  scanned. Inline allow comments and ignore fingerprints cannot bypass it.
  Findings report rule, path, line, and commit, never matched credential values.
  A finding or an incomplete scan fails the job. GitHub's native secret scanning
  and push protection are not enabled by this repository change.

CodeQL and dependency reports are retained for 30 days, including when a scan
fails. Secret-scan locations appear in workflow logs. High or critical
dependency advisories fail the dependency job; lower-severity advisories remain
visible in the report. Registry errors also fail the job and are not treated as
clean scans. CodeQL findings are reviewed in code scanning; successful query
execution alone does not mean that there are no findings. Review and triage
findings before merging. Automation supplements, but does not replace, manual
security review.

To reproduce the dependency assessment locally:

```sh
npm audit --package-lock-only --ignore-scripts --include=dev --audit-level=high
```

To scan secrets locally, with full Git history, GitHub access, and `tar` available:

```sh
npm run scan:secrets
```

The command downloads the pinned scanner without installing npm dependencies.
Exit code 0 means no findings, 1 means findings, and 2 means the scan could not
complete. Do not treat a download, checksum, execution, or report error as clean.
