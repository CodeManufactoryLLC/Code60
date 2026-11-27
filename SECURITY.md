# Security Policy

Code60 runs coding agents on the local machine. Its browser safeguards protect the application interface; they do not sandbox the agents launched by the user. For quick answers on auto-approval, sandboxing, and secret handling, see the [Security and Permissions FAQ](FAQ.md#security-and-permissions).

> The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119), as mandated by [CONSTITUTION.md](CONSTITUTION.md). Each normative stipulation appears on its own line with a unique identifier (`SEC-<section>.<subsection>.<number>`).

## Contents

1. [Runtime safeguards and trust boundaries](#1-runtime-safeguards-and-trust-boundaries)
2. [Agent permissions and execution policy](#2-agent-permissions-and-execution-policy)
3. [Local data, transcripts, and diagnostic logs](#3-local-data-transcripts-and-diagnostic-logs)
4. [External providers, MCP connectors, and updates](#4-external-providers-mcp-connectors-and-updates)
5. [Security governance and vulnerability reporting](#5-security-governance-and-vulnerability-reporting)

## 1. Runtime safeguards and trust boundaries

### 1.1 Authenticated browser interface

- `SEC-1.1.1` By default, the Node backend MUST bind only to `127.0.0.1` on an ephemeral port and serve bundled assets.
- `SEC-1.1.2` When local pairing is off, a same-origin JSON handshake MAY create a tab session without a code, allowing any browser on the local computer to connect without private filesystem access.
- `SEC-1.1.3` Operators MAY run `code60 pairing on` to require a short-lived, single-use pairing code for local browser connections, and MAY run `code60 pairing off` to restore direct entry.
- `SEC-1.1.4` Browser session tokens MUST remain in session storage and MUST NOT enter a URL or cookie.
- `SEC-1.1.5` API and event requests MUST authenticate using explicit request headers.
- `SEC-1.1.6` The gateway MUST enforce Host/Origin checks and same-origin JSON mutation checks to reject cross-site requests.
- `SEC-1.1.7` A Content Security Policy (CSP) MUST limit executable content to bundled assets.

### 1.2 Validated application requests and local management

- `SEC-1.2.1` The gateway MUST validate all inputs against a fixed operation map and MUST verify workspace and run ownership.
- `SEC-1.2.2` The gateway MUST allow only one controlling browser to perform mutations at a time.
- `SEC-1.2.3` Control takeover MUST be explicit and MUST revoke pending page decisions.
- `SEC-1.2.4` Host file selection MUST use opaque IDs scoped to locally configured roots.
- `SEC-1.2.5` The gateway MUST NOT expose any generic shell or filesystem RPC.
- `SEC-1.2.6` Private filesystem metadata MUST authenticate the management CLI separately from browsers.
- `SEC-1.2.7` Service installation, repair, stop, and uninstall MUST require explicit local consent.
- `SEC-1.2.8` Pairing policy changes MUST be executed as local management actions and MUST revoke active browser sessions without cancelling approved work.
- `SEC-1.2.9` Closing a browser tab MUST preserve approved execution, whereas stopping the backend MUST stop application and scheduler work together.
- `SEC-1.2.10` Backend restart MUST restore persisted evidence without replaying uncertain work or approvals.

### 1.3 Scoped local agent controls and non-sandbox limits

Non-sandbox boundary: these safeguards do not sandbox agent processes. Agents run with the local user's operating-system permissions. A Git worktree separates repository changes, not filesystem or network access; without a Git repository containing an initial commit, agents work directly in the selected directory and parallel runs can overwrite each other's changes. Prompts, repository content, agent responses, and tool output can be malicious or misleading, and behavioral instructions such as the Operating Contract are not security boundaries. See [ARCHITECTURE.md](ARCHITECTURE.md) for system architecture and module boundaries.

- `SEC-1.3.1` The orchestration MCP sidecar MUST connect only to a token-authenticated gateway bound to `127.0.0.1`.
- `SEC-1.3.2` Orchestration MCP requests MUST enforce size and time limits.
- `SEC-1.3.3` Worker mutations MUST enforce current chat and project scope and ownership.
- `SEC-1.3.4` Worker agents MUST NOT receive the Code60 orchestration MCP server.
- `SEC-1.3.5` Newly created run directories and files MUST use restrictive filesystem permissions (see [3.1 Run records and transcripts](#31-run-records-and-transcripts)).
- `SEC-1.3.6` Users SHOULD read these non-sandbox limitations before granting an agent access to sensitive repositories.
- `SEC-1.3.7` Users SHOULD review agent changes themselves; a `finished` run indicates only that the agent ended its turn normally, not that its changes were verified.

### 1.4 Web Server (Beta) private-LAN access

Scope: LAN HTTP traffic is unencrypted; TLS, passwords, public hosting, and automatic firewall changes are out of scope for this beta. Paired LAN devices receive full application authority (including agent dispatch and backend-owned file choosers), subject to the same confirmations and single-controller rules. Provider storage and approved execution records remain independent of this policy.

- `SEC-1.4.1` An explicit localhost-only switch MAY publish the Code60 application on the host's primary RFC1918 IPv4 address and existing gateway port.
- `SEC-1.4.2` The LAN switch MUST default to off and MUST store only the enabled preference in private gateway settings.
- `SEC-1.4.3` The gateway MUST NOT bind wildcard or public addresses, configure a router or firewall, or install another service when LAN access is enabled.
- `SEC-1.4.4` Operators SHOULD enable LAN access only on trusted private networks.
- `SEC-1.4.5` LAN access MUST always require a single-use 60-second pairing code, independently of local pairing policy.
- `SEC-1.4.6` LAN pairing codes MUST be bound to an exact LAN activation and origin, and MUST be invalidated on rotation, disable, address change, or backend restart.
- `SEC-1.4.7` The gateway MUST rate-limit LAN pairing submissions to at most ten per minute.
- `SEC-1.4.8` LAN pairing codes MUST use six cryptographically random digits displayed as `123-456` and MUST accept entry with or without the hyphen (local pairing retains its hexadecimal format).
- `SEC-1.4.9` LAN code rotation MUST exclude the immediately previous code, and code generation MUST reject active collisions within a finite retry limit.
- `SEC-1.4.10` Sessions MUST be ingress- and origin-bound, MUST use per-tab session storage, and MUST require explicit control takeover.
- `SEC-1.4.11` A local session MUST NOT be replayable on LAN, and a LAN session MUST NOT be replayable on localhost.
- `SEC-1.4.12` Only the controlling localhost page MUST be permitted to change LAN policy or generate a pairing code.
- `SEC-1.4.13` Pairing codes MUST NOT enter shared snapshots, diagnostics, transcripts, persistent settings, or links.
- `SEC-1.4.14` The LAN ingress MUST reject private management routes even when presented with a management token.
- `SEC-1.4.15` The LAN ingress MUST continue enforcing Host/Origin/schema checks, CSP, and existing quotas.
- `SEC-1.4.16` Top-level LAN navigation MUST serve only the bundled asset manifest and MUST NOT expose source maps, Vite/HMR, or a development filesystem proxy.
- `SEC-1.4.17` Disabling LAN or losing the host address MUST cancel affected view reads and pending human/setup interactions and MUST invalidate remote sessions while approved execution, scheduled work, and local access continue.
- `SEC-1.4.18` In dev-container forwarding, the owned host launcher MUST communicate with the container loopback ingress over a private user-owned Unix socket and bounded stdio channel carrying only fixed address, publish, withdraw, and heartbeat messages.
- `SEC-1.4.19` Browser requests MUST NOT control dev-container forwarding commands, ports, paths, or environments.
- `SEC-1.4.20` Dev-container forwarding protocol requests MUST enforce ten-second deadlines, and the host MUST withdraw unrenewed publication after fifteen seconds or upon backend or launcher loss.
- `SEC-1.4.21` Dev-container forwarding cleanup uncertainty MUST be reported as an error rather than claiming exposure stopped.

## 2. Agent permissions and execution policy

Scope: Code60 answers permission requests reported by an agent through ACP. This policy is not an operating-system sandbox and cannot constrain actions an agent does not submit for approval.

### 2.1 Approval modes by execution context

- `SEC-2.1.1` For manual application runs, the default policy allows `read`, `search`, `think`, and `edit` and prompts for other kinds; configuration and explicit application permission choices MAY alter these decisions.
- `SEC-2.1.2` Scheduled jobs MUST enforce their saved explicit allowlist and MUST deny all other permission requests.
- `SEC-2.1.3` The internal headless scheduler executor MUST NOT prompt for interactive approval.
- `SEC-2.1.4` For orchestration chats and their workers, auto-approval defaults to on; users MAY turn off **auto-approve** in the top **Workspace** header to review each new ACP request in the originating Relay, custom assistant, project chat, or worker and choose **Allow once** or **Deny**.
- `SEC-2.1.5` The **auto-approve** setting MUST persist across restarts and MUST apply to live sessions.
- `SEC-2.1.6` A permission request already awaiting review MUST still require an explicit user decision even after **auto-approve** is turned back on.

### 2.2 Once-only decisions, harness modes, and model defaults

- `SEC-2.2.1` When answering an ACP permission request, Code60 MUST select the matching once-only allow or deny option and MUST NOT grant an always-allow option.
- `SEC-2.2.2` If no matching once-only option exists for an ACP permission request, Code60 MUST answer the request as cancelled.
- `SEC-2.2.3` The provider's **Harness mode** MUST remain independent of Code60's approval policy; selecting an Ask mode MUST NOT be treated as disabling Code60 auto-approval, and any provider-side sandbox depends on that provider and its configuration.
- `SEC-2.2.4` Model and reasoning changes MUST accept only current connector-advertised values between turns.
- `SEC-2.2.5` Saving a role default MUST derive confirmed selections in the backend and MUST NOT trust renderer-supplied values.
- `SEC-2.2.6` Saved model and reasoning defaults MUST NOT alter approval policy or grant new worker authority.

## 3. Local data, transcripts, and diagnostic logs

### 3.1 Run records and transcripts

Code60 stores run records and transcripts as unencrypted local `run.json` and `events.jsonl` files, plus project metadata and saved configurations in the connected SQLite database (for non-Git runs, the directory key is derived from the directory's absolute path). Filesystem permissions do not protect against processes running as the same user, administrator access, backups, or copies. Records can contain initial and follow-up prompts, agent messages, thoughts, raw ACP updates, tool inputs/outputs, stderr, and process metadata.

| Run type | Record directory |
| --- | --- |
| Project runs in a Git repository | `<git-common-dir>/code60/runs/<run-id>/` |
| Runs outside a Git repository | `$XDG_STATE_HOME/code60/dirs/<key>/runs/<run-id>/` (default state home: `~/.local/state`) |
| Orchestration chats | `.code60_workspace/<chat-folder>/.code60/runs/<run-id>/` beside the connected SQLite database |

- `SEC-3.1.1` On macOS and Linux, newly created run directories MUST use mode `0700` and record files MUST use mode `0600`.
- `SEC-3.1.2` Transcripts are private records and MUST NOT be automatically scrubbed, rewritten, or expired.
- `SEC-3.1.3` Operational errors and stderr MUST receive best-effort credential redaction before clipping, covering common credential assignments, authorization headers, URL user information, known token formats, and private-key blocks (this is not a general secret detector, PII anonymizer, or guarantee against disclosure).
- `SEC-3.1.4` Stored stderr MUST retain at most a 64 KiB scrubbed tail, and oversized lines MUST be omitted.
- `SEC-3.1.5` CLI progress output MUST omit tool/permission titles and status reasons, and ACP provider failures MUST use generic messages rather than echoing raw provider error text (preserving result fields and exit-code semantics).
- `SEC-3.1.6` Users SHOULD NOT attach whole run directories or raw logs to public issues.
- `SEC-3.1.7` Users SHOULD inspect and redact any shared material (including prompts, tokens, private paths, source code, and personal information) before sharing it.
- `SEC-3.1.8` Users SHOULD NOT place credentials in prompts or configured command arguments; agents authenticate through their own CLIs.

### 3.2 Application diagnostic logs

**Apps → Data Viewer → Logs** stores local operational history as unencrypted JSONL files under `$XDG_STATE_HOME/code60/logs` (default `~/.local/state/code60/logs`), separate from the Events table and `events.jsonl` transcripts. Diagnostic capture can lose data after a crash, storage failure, or queue overflow; it is not an audit or recovery authority, and failure/drop counts describe the current launch only.

- `SEC-3.2.1` Diagnostic logs MUST enforce a seven-day, 20 MiB total retention cap (including active files); reads and writes MUST prune retained data and queries MUST hide expired records.
- `SEC-3.2.2` Clearing diagnostic logs MUST require explicit confirmation and MUST delete diagnostic logs only.
- `SEC-3.2.3` Diagnostic retention and log clearing MUST NOT expire, scrub, or delete transcripts, run records, reviews, or SQLite data.
- `SEC-3.2.4` Diagnostic records MUST use only fixed messages and allowlisted identifiers, event names, severity, outcomes, durations, and error categories/codes (project IDs are hashes, not a guarantee of anonymity).
- `SEC-3.2.5` Diagnostic records MUST NOT contain prompts, transcripts, raw ACP/tool payloads, environment values, command arguments, absolute paths, or arbitrary exception text.
- `SEC-3.2.6` Free-form diagnostic text MUST NOT be accepted without explicit policy approval; any future approved diagnostic text MUST receive credential redaction before bounded UTF-8 truncation.
- `SEC-3.2.7` Diagnostic storage MUST enforce private POSIX mode and ownership checks and MUST reject unsafe storage paths or links.
- `SEC-3.2.8` Concurrent diagnostic log rotation and quota enforcement MUST be protected by cross-process locking.
- `SEC-3.2.9` Diagnostic queues, records, queries, and shutdown flushing MUST be bounded; persistence failures and dropped records MUST be surfaced visibly, and malformed or truncated records MUST be skipped with a partial-history notice.
- `SEC-3.2.10` Only narrow, validated gateway query, detail, and clear operations MUST be allowed to access diagnostic logs.
- `SEC-3.2.11` The gateway MUST NOT expose generic path/filesystem log access or grant agent or MCP log access.

## 4. External providers, MCP connectors, and updates

### 4.1 Provider data transmission and continuation

Local record storage does not mean task data remains on the local machine: Code60 sends prompts and context to the configured agent process, which can transmit prompts, repository content, and tool output to external services. Search overviews and memory extraction also send selected evidence (including project-file excerpts for search overviews) to the configured agent; temporary working directories and denied helper permission requests are not filesystem sandboxes.

- `SEC-4.1.1` Users SHOULD review each configured provider's privacy, retention, and training policies separately.
- `SEC-4.1.2` Session continuation MAY restore a provider session or send a handoff summary built from saved prompts, messages, and tool-call summaries.

### 4.2 Scoped provider and Codex setup

Custom launch overrides retain external setup. Providers own their persistent credentials, and dev-container homes retain managed binaries and credentials.

- `SEC-4.2.1` An explicit human setup action MAY install only the catalog harness release artifacts fixed in application policy into versioned private Code60 storage.
- `SEC-4.2.2` Before atomic activation of a catalog harness, Code60 MUST verify integrity, archive containment, ownership, and executable layout.
- `SEC-4.2.3` Catalog harness setup MUST refuse root execution, external overwrites, lifecycle scripts, and shell-profile or service edits.
- `SEC-4.2.4` Provider authentication MUST belong to the controlling page's single setup attempt (including over LAN) and MUST allow only fixed provider login operations and validated HTTPS destinations.
- `SEC-4.2.5` Device codes, OAuth URLs, and pasted authorization codes MUST be treated as ephemeral owner-bound values and MUST NOT enter shared state, request-receipt caches, diagnostics, transcripts, or browser storage.
- `SEC-4.2.6` Provider setup MUST NOT expose a generic terminal, shell, provider-server proxy, package selector, or credential reader.
- `SEC-4.2.7` Operators MUST treat persistent dev-container homes containing managed binaries and provider credentials as private user state, not a disposable cache.
- `SEC-4.2.8` Cancelling provider setup MUST NOT log out the provider or remove already-issued credentials.
- `SEC-4.2.9` Provider setup cleanup failures MUST block further setup attempts until owned processes stop.
- `SEC-4.2.10` As a narrow exception to package installation restrictions, the authenticated controlling browser MAY explicitly request installation of the fixed `@openai/codex@0.171.0` package from `https://registry.npmjs.org`.
- `SEC-4.2.11` Browser setup operations MUST NOT accept a command, path, package name, or environment override.
- `SEC-4.2.12` Managed Codex installation MUST run as the non-root backend user with npm lifecycle scripts disabled, isolated npm configuration, private staging, and atomic activation under `~/.local/share/code60/providers/codex/0.171.0`, preserving existing CLIs and user configuration.
- `SEC-4.2.13` The owned Codex app-server process MUST perform only initialization and structured ChatGPT device-code login over bounded stdio and MUST accept only `https://auth.openai.com/codex/device`.
- `SEC-4.2.14` The backend MUST run at most one setup attempt at a time and MUST enforce deadlines of ten minutes for installation, fifteen minutes for login, and fifteen seconds for protocol requests.
- `SEC-4.2.15` Cancel, dismissal, reload, control loss, configuration replacement, and shutdown MUST abort owned setup work and await process-group cleanup.
- `SEC-4.2.16` Normal agent work and fresh post-login verification MUST use ACP without login-process tools.

### 4.3 MCP connectors, credentials, and guarded file writes

Scope: MCP tools run with the local user's permissions and are not sandboxed. SHA-256 in MCP identity/review metadata binds configuration, public discovery, client identity, and scope. Guarded writes do not claim atomic compare-and-swap against a non-cooperating editor. See [MCP configuration](MCP.md), [MCP storage recovery](knowledge/operations/runbooks/mcp-storage.md), and [MCP runtime and auth recovery](knowledge/operations/runbooks/mcp-runtime-auth.md).

- `SEC-4.3.1` User and project `mcp.json` definitions MUST remain backend-owned.
- `SEC-4.3.2` Each owning ACP session MUST receive only fixed local stdio adapters with ephemeral connector capabilities and MUST NOT receive upstream commands, endpoints, or credentials.
- `SEC-4.3.3` Application policy MUST restrict MCP connector authority to authorized owning turns while keeping ACP permissions independent.
- `SEC-4.3.4` MCP session adapters MUST expose tools only.
- `SEC-4.3.5` Stdio MCP connectors MUST run without a shell in owned process groups with an allowlisted environment.
- `SEC-4.3.6` HTTP MCP connectors MUST use validated DNS and socket destinations, MUST enforce bounded requests, and MUST NOT automatically replay business calls.
- `SEC-4.3.7` Users SHOULD configure only trusted MCP servers and providers and SHOULD review project approval against its exact canonical identity and revision.
- `SEC-4.3.8` MCP credentials MUST use a bounded private-pipe Keychain/Secret Service helper or explicitly accepted temporary RAM.
- `SEC-4.3.9` MCP OAuth flows MUST remain backend-owned, and the gateway MUST NOT expose a browser secret-read endpoint.
- `SEC-4.3.10` Recovery Complete and Roll back MUST recheck reviewed files, journals, and owners, and MUST NOT override newer edits or restore session or credential authority.
- `SEC-4.3.11` MCP journals and backups retain exact user-entered bytes privately and MUST NOT be shared as troubleshooting reports.
- `SEC-4.3.12` OPTIONAL MCP troubleshooting reports MUST contain only counts, fixed codes, and states, and MUST NOT contain definitions, identifiers, paths, endpoints, references, or raw errors.
- `SEC-4.3.13` MCP cleanup verification MUST retry only retained revoked handles and MUST NOT perform process-name searches or lock deletion.
- `SEC-4.3.14` Authentication and credential-write replay fingerprints containing secret inputs MUST remain in backend memory only and MUST NOT be persisted as password verifiers.
- `SEC-4.3.15` Guarded file staging MUST validate pathnames, open with `O_NOFOLLOW`, perform full native identity and content checks on that same handle, re-check target revision and stage identity before rename, and verify after publication.
- `SEC-4.3.16` Guarded writes MUST fail without modifying the destination if the staged path is replaced by a regular file, symlink, or hard link between `lstat` and `open`.
- `SEC-4.3.17` Uncertain guarded-write publication MUST retain recovery evidence.

### 4.4 Application updates

- `SEC-4.4.1` The browser MUST NOT silently download or install application updates.
- `SEC-4.4.2` Managed installations MUST update explicitly via `code60 update` using verified release metadata and checksums (see [updates](knowledge/operations/distribution/updates.md)), while manual tarball installations stop work, install the reviewed package, repair local backend registration, and restart the service.
- `SEC-4.4.3` Provider network access MUST remain independent of the application update process.

## 5. Security governance and vulnerability reporting

### 5.1 Supported versions

- `SEC-5.1.1` Only the latest released version of Code60 is REQUIRED to receive security fixes.
- `SEC-5.1.2` Reporters SHOULD upgrade to the latest release before reporting an issue when practical.

### 5.2 Reporting a vulnerability

- `SEC-5.2.1` Reporters MUST submit suspected vulnerabilities privately to **[support@code60.dev](mailto:support@code60.dev)**.
- `SEC-5.2.2` Reporters MUST NOT open a public issue or publish exploit details before coordinated disclosure.
- `SEC-5.2.3` Vulnerability reports SHOULD include the affected version, platform, steps to reproduce, potential impact, and a minimal example when possible.
- `SEC-5.2.4` Vulnerability reports MUST NOT include credentials, private prompts, or other sensitive data.
- `SEC-5.2.5` Maintainers SHOULD acknowledge vulnerability reports within five business days, then share an assessment and coordinate fixes and disclosure with the reporter (this target is not a guarantee of a fix date).

### 5.3 Automated security reviews

The **Security review** workflow (`.github/workflows/security-review.yml`) runs on every pull request, every push to `main`, Mondays at 07:23 UTC, and manual dispatch. CodeQL (`security-extended`, SARIF in `codeql-security-report`) and the lockfile dependency audit (`npm-security-report`) retain artifacts for 30 days even on failure; secret-scan locations appear in workflow logs. GitHub's native secret scanning and push protection are not enabled by this repository configuration.

- `SEC-5.3.1` CodeQL MUST scan JavaScript and TypeScript with the `security-extended` query suite without building or running the application.
- `SEC-5.3.2` The dependency security report MUST audit the lockfile (including development dependencies) without installing packages or running lifecycle scripts.
- `SEC-5.3.3` High or critical dependency advisories and registry errors MUST fail the dependency security job and MUST NOT be treated as clean scans.
- `SEC-5.3.4` Secret scanning MUST use checksum-pinned Gitleaks across all fetched Git history and current files (including untracked files in local scans), excluding only generated directories.
- `SEC-5.3.5` Inline allow comments and ignore fingerprints MUST NOT bypass secret scanning.
- `SEC-5.3.6` Secret-scan findings MUST report rule, path, line, and commit, and MUST NOT output matched credential values.
- `SEC-5.3.7` Any secret-scan finding or incomplete scan MUST fail the job.
- `SEC-5.3.8` Maintainers SHOULD review and triage CodeQL findings before merging; automation supplements, but does not replace, manual security review.
- `SEC-5.3.9` Operators running local scans MUST NOT treat a download, checksum, execution, or report error (exit code `2`) as clean (`0` = no findings, `1` = findings, `2` = incomplete).

Local reproduction commands:

```sh
npm audit --package-lock-only --ignore-scripts --include=dev --audit-level=high
npm run scan:secrets
```
