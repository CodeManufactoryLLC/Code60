# Security Policy

Code60 runs coding agents on your machine. Its browser safeguards protect the
application interface; they do not sandbox the agents you launch. Read the
limitations below before giving an agent access to sensitive repositories.
For quick answers on auto-approval, sandboxing, and secret handling, see the
[Security and Permissions FAQ](FAQ.md#security-and-permissions).

## Runtime safeguards and limits

- **Authenticated browser interface.** The Node backend binds only to
  `127.0.0.1` on an ephemeral port and serves bundled assets. By default a same-origin JSON handshake creates a tab session without a code.
  Local `code60 pairing on` can require a short-lived, single-use code instead;
  `code60 pairing off` restores direct entry. With pairing off, browsers on this
  computer can connect without private filesystem access. Session tokens remain
  in session storage and never enter a URL or cookie. Explicit headers authenticate API
  and event requests. Host/Origin checks and same-origin JSON mutation requests
  reject cross-site use. A CSP limits executable content to bundled assets.
- **Validated application requests.** A fixed operation map validates inputs and
  checks workspace/run ownership. One browser controls mutations; takeover is
  explicit and revokes pending page decisions. Host selection uses opaque IDs
  under locally configured roots. No generic shell or filesystem RPC is exposed.
- **Separate local management.** Private filesystem metadata authenticates the
  management CLI separately from browsers. Installation, repair, stop and uninstall
  require explicit local consent. Pairing policy changes are local management
  actions and revoke current browser sessions without cancelling approved work.
  Closing a tab preserves approved execution;
  stopping the backend stops application and scheduler work. Restart restores
  evidence without replaying uncertain work or approvals.
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

Technical details: [browser security](ARCHITECTURE.md#browser-security),
[module boundaries](ARCHITECTURE.md#modules), and
[runs without a worktree](ARCHITECTURE.md#runs-without-a-worktree).

## Agent permissions

Code60 answers permission requests reported by the agent through ACP. This
policy is not an operating-system sandbox and cannot constrain actions an
agent does not submit for approval.

- **Manual application runs:** the default policy allows `read`, `search`,
  `think`, and `edit`, and asks for other kinds. Configuration and explicit application permission choices can change these decisions.
- **Scheduled automations:** use the saved explicit allowlist and deny other
  requests. The internal headless executor never prompts.
- **Orchestration chats and their workers:** Code60 auto-approval defaults on.
  Turn it off beside **Harness mode** in the chat or worker composer to review each new ACP request
  in the originating Relay, custom assistant, project chat or worker. Choose **Allow
  once** or **Deny**. The setting persists across restarts and applies to live
  sessions. A request already awaiting review still requires a decision after
  you turn auto-approval back on.
- **Once-only decisions:** Code60 chooses the corresponding once-only
  allow/deny option, never an always-allow grant. If no matching once-only
  option exists, the request is answered as cancelled. Once-only does not
  mean harmless; orchestration can approve repeated requests automatically.

The provider's **Harness mode** is separate from Code60's approval policy.
Choosing an Ask mode does not turn off Code60 auto-approval in orchestration
chats or workers. Any provider sandbox or other restrictions depend on that
provider and its configuration.

Model and reasoning changes accept only current connector-advertised values
between turns. Saving a role default derives confirmed selections in main, not
from renderer-supplied values. Defaults do not change approval policy or grant
new worker authority.

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
`0600`. Filesystem permissions do
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

Tables → Logs is a local application operational history, available without a project
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
- User/project `mcp.json` definitions remain backend-owned. Each owning ACP session
  receives fixed local stdio adapters with ephemeral connector capabilities, never
  upstream commands, endpoints or credentials. Application policy limits authority
  to authorized owning turns; ACP permissions remain independent. Only tools are
  exposed. Stdio runs without a shell in owned process groups with an allowlisted
  environment; HTTP uses validated DNS/socket destinations, bounded requests and
  no automatic business-call replay. MCP tools run with the user's permissions and
  are not sandboxed. Only configure trusted servers/providers. Review project
  approval against its exact canonical identity/revision. Credentials use a bounded
  private-pipe Keychain/Secret Service helper or explicitly accepted temporary RAM;
  OAuth remains backend-owned. No browser secret-read endpoint exists.
  Recovery Complete/Roll back rechecks reviewed files/journal/owners; it cannot
  override newer edits or restore session/credential authority. Journals/backups
  retain exact user-entered bytes privately and must never be shared as reports.
  Optional reports contain only counts, fixed codes and states; no definitions,
  identifiers, paths, endpoints, references or raw errors. Cleanup verification
  retries only retained revoked handles, never process-name searches or lock deletion.
  See [MCP configuration](MCP.md) and the
  [recovery runbook](docs/runbooks/mcp-configuration.md).
- Desktop continuation may restore a provider session or send a handoff
  summary built from saved prompts, messages, and tool-call summaries.
  Search overviews and memory extraction also send selected evidence to
  the configured agent; search overviews can include project-file excerpts.
  Temporary working directories and denied helper permission requests are
  not filesystem sandboxes.
- Updates are manual npm tarball installations. The browser does not check for,
  download or install packages. Stop work, install the reviewed package, repair
  the local backend registration and start it again. Provider network access is
  independent of the update process.

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


## Scoped Codex setup

The authenticated controlling browser can explicitly request installation of the
fixed `@openai/codex@0.171.0` package from `https://registry.npmjs.org`. No browser
operation accepts a command, path, package name or environment override. This is
a narrow exception to application/package installation restrictions, not a general
installer. Installation runs as the non-root backend user, with npm lifecycle
scripts disabled, isolated npm configuration, private staging and atomic activation
under `~/.local/share/code60/providers/codex/0.171.0`. Existing CLIs and user
configuration are preserved. The managed copy is preferred by the standard connector.

A short-lived owned Codex app-server process performs only initialization and
structured ChatGPT device-code login over bounded stdio. Only the exact HTTPS
verification destination `https://auth.openai.com/codex/device` is accepted. The
provider owns credentials in its normal backend-user storage. Code60 receives a
temporary device challenge, not the account password or credentials. Challenges
are returned only by setup/attempt-bound requests owned by the controlling page;
they are excluded from shared snapshots, browser storage, diagnostics and transcripts.
Provider output and errors are discarded or mapped to fixed messages. Normal agent
work and the fresh post-login verification use ACP, without login-process tools.

One setup attempt runs at a time. Installation has a ten-minute deadline, login
fifteen minutes and protocol requests fifteen seconds. Cancel, dismissal, reload,
control loss, configuration replacement and shutdown abort owned work and await
process-group cleanup. Late/stale results cannot verify membership. Cancellation
does not log out the provider or erase credentials it has already issued. The
persistent dev-container home retains both managed binaries and credentials;
it must be treated as private user state, not a disposable cache. Custom commands
require manual authentication; standard catalog harnesses use the scoped provider setup policy below.


## Web Server Beta

An explicit localhost-only switch can publish the same Code60 application on the
host's primary RFC1918 IPv4 address and existing gateway port. This is a scoped
exception to loopback-only access; it does not bind wildcard/public addresses,
configure a router/firewall or install another service. HTTP is unencrypted and
intended only for trusted LANs. The switch is off by default and stores only the
enabled preference in private gateway settings.

LAN always requires a single-use 60-second pairing code, independently of local
pairing policy. Codes belong to an exact LAN activation/origin; rotation, disable,
address change and backend restart invalidate them. Ten pairing submissions per
minute are permitted. Codes use six cryptographically random digits, displayed
as `123-456`, and accept entry with or without the hyphen. Local pairing retains
its existing hexadecimal format. Rotation excludes the immediately previous code
and generation rejects active collisions with a finite retry limit.
Sessions are ingress/origin-bound, use the existing per-tab
session storage and require explicit control takeover. A local session cannot be
replayed on LAN, nor a LAN session on localhost. Only the controlling localhost
page can change LAN policy or generate a code; codes never enter shared snapshots,
diagnostics, transcripts, persistent settings or links. The LAN ingress rejects
private management routes even with a management token. Host/Origin/schema checks,
CSP and existing quotas remain enforced. Top-level LAN navigation serves only the
bundled asset manifest, with no maps, Vite/HMR or development filesystem proxy.

Paired devices receive the full application authority, including agent dispatch
and backend-owned file choosers, subject to the same confirmations and single
controller rules. Disabling LAN or losing its address cancels affected view reads
and pending human/setup interactions and invalidates remote sessions, while
approved execution and scheduled work continue. Local access remains available.

For dev containers, the owned host launcher derives the host address/port and
forwards to a separate loopback ingress in its own container. A private user-owned
Unix socket and bounded stdio channel carry fixed address/publish/withdraw/heartbeat
messages. No browser controls commands, ports, paths or environments. Protocol
requests have ten-second deadlines; the host withdraws unrenewed publication after
fifteen seconds and on backend/launcher loss. Cleanup uncertainty remains an error,
not a claim that exposure stopped. Provider storage and approved execution records
are independent of this policy. TLS, passwords, public hosting and automatic
firewall changes are outside this beta.

## Scoped provider setup

An explicit human setup action may install only the catalog harness release artifacts
fixed in application policy into versioned private Code60 storage. Verify integrity,
archive containment, ownership and executable layout before atomic activation; refuse
root, external overwrite, lifecycle scripts and shell-profile/service edits.
Authentication belongs to the controlling page's single setup attempt, including LAN.
Allow only fixed provider login operations and validated HTTPS destinations. Device
codes, OAuth URLs and pasted codes are ephemeral owner-bound responses/inputs, excluded
from shared state, request-receipt caches, diagnostics, transcripts and browser storage.
No generic terminal, shell, provider-server proxy, package selector or credential reader
is exposed. Providers own persistent credentials and container home retains them.
Cancelling never logs out or removes credentials. Cleanup failures block further setup
until owned processes stop. Custom launch overrides retain external setup.

## MCP fingerprint and guarded-file review

SHA-256 in MCP identity/review metadata binds configuration, public discovery,
client identity and scope. Authentication and credential-write replay fingerprints
that include secret inputs remain in backend memory only. They are never persisted
as password verifiers; tokens, client secrets and credential values use the secure
store or explicitly accepted temporary memory. This is separate from password
storage and its password-derivation requirements.

A guarded stage's pathname check is followed by O_NOFOLLOW open, full native
identity/content checks on that same handle, another target revision and stage
identity check before rename, and verification after publication. Replacement by a
regular file, symlink or hard link between lstat and open must fail without changing
the destination. Guarded writes do not claim atomic compare-and-swap against a
non-cooperating editor; uncertain publication retains recovery evidence.
