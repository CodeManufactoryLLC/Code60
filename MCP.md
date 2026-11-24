# MCP configuration

Use **Apps → MCP Servers** to manage User or open-project definitions. The dedicated
files are `$XDG_CONFIG_HOME/code60/mcp.json` (default `~/.config/code60/mcp.json`)
and `<canonical-project>/.code60/mcp.json`. Missing files mean empty defaults.
`config.json.mcpServers` is no longer supported; no migration or fallback is provided.

```json
{
  "version": 1,
  "servers": {
    "docs": {
      "label": "Documentation",
      "enabled": false,
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/server.js"],
      "env": {}
    }
  }
}
```

Project IDs always shadow User IDs, even while disabled or unapproved. Project
approval binds the canonical/native project identity and exact saved revision.
Review commands, arguments and bindings before approval or a stdio connection test.
A test launches code and discovers tools, but never calls a business tool.

Enable/Disable and approval changes apply to future connections. Existing sessions
retain their captured configuration. **Disconnect** revokes selected connections
immediately without changing enablement. **Reconnect** previews all connectors
in the owning ACP session, requires an idle turn and provider load/resume support,
and obtains fresh capabilities without replaying work. Otherwise start a new session.
Unavailable servers warn while the agent and other available tools remain usable.

Configuration validity, enabled state, approval, authentication and connection
health are separate. Untested means **Not tested**. Unresolved credential references
and OAuth mean **Authentication required**. Use **Authentication** on a local
definition for credential entry or reviewed OAuth sign-in. Transaction-recovery GUI and
troubleshooting reports remain phase 7. Dedicated integrations, Code60-owned OAuth
registrations/client IDs/secrets, hosted authentication and legacy SSE are excluded.
See the [implementation plan](ad-hoc-plans/mcp-connectors-plan.md),
[architecture](ARCHITECTURE.md#mcp-connector-foundation-and-target-runtime) and
[recovery runbook](docs/runbooks/mcp-configuration.md).

## Browser modes in chat

Relay, Custom Assistants and project chats include the `code60_browser` tool.
You do not need an MCP configuration entry or a Settings selector. Tell the
assistant what you prefer:

- “Open this page headlessly and take a screenshot.”
- “Use a visible browser so I can watch.”
- “Use my existing browser where I’m already signed in.”

Headless is the default. Headless and Visible use separate in-memory profiles;
Existing Browser connects to Chrome through Microsoft's
[Playwright extension](https://github.com/microsoft/playwright/tree/main/packages/extension#readme).
Install the extension and approve its connection/tab selection when prompted.
Code60 does not bypass that approval or configure an extension token. This
controls web content, not native desktop applications.

Install Chrome and Node.js/npm on the machine running Code60. Playwright starts
only when needed through `npx -y @playwright/mcp@0.0.84`, which may download the
package on first use. Mode selection alone never downloads or launches it.
Each live chat owns its connection and preference. Switching modes closes its
previous connection and loses isolated state; there is no automatic fallback.
Cancel releases the browser connection; Stop, Undo, replacing the conversation
and quitting clean up its processes. External website changes are not reversed
by message Undo. App restart starts with Headless, preserving chat history.
The managed browser tool is not given to workers, setup probes, helpers or the
scheduler; your explicitly configured servers remain independent.

For agent integrations, use the provider's actual catalog path for
`code60_browser`. Call `{"action":"set-mode","mode":"visible"}` (or
`headless`/`existing-browser`), then `{"action":"list-tools"}`. Invoke a
discovered tool with, for example,
`{"action":"call","name":"browser_navigate","arguments":{"url":"https://example.com"}}`.
`status` reports the selected mode and connection; `close` releases it. Calls
must be sequential. A request is bounded to 100 seconds; errors require inspection
before retrying. Existing Browser prerequisites and real browser availability are
checked on use, never inferred from successful provider setup.

Managed Playwright launches in an application-controlled npm context outside
repositories, with fixed npm configuration and package pinning. Only product-allowed
browser tools are exposed; host-code execution, installation, file upload and
page-registered WebMCP tools are unavailable. Automatic captures have a 32 MiB
budget and are temporary. Use an explicit filename directly in the conversation
workspace to retain a requested file across mode changes. Browser authority ends
on cancellation, turn failure/timeout or process exit. Cleanup waits for isolated
Chromium to acknowledge closing; unverified cleanup is reported for retry.

## Bundled starter file

[`mcp.default.json`](mcp.default.json) is a disabled version-one document containing
optional pinned Playwright and Context7 templates. Guided Add offers the same
reviewable definitions. Nothing is loaded or launched automatically. Explicitly
adding and enabling a template allows a new approved session to run its configured
command, including any downloads requested by npx. Install prerequisites yourself.
These templates are distinct from dedicated integrations and the built-in browser.

## Fields and provider support

Require version 1, a servers object, label, enabled and the transport's fields.
Server IDs use lowercase alphanumerics/hyphens, begin with an alphanumeric, and
have at most 64 characters; code60 is reserved. Stdio uses command, args and env;
Streamable HTTP uses url, headers and auth. Bindings explicitly use `{ "value":
"non-secret literal" }` or `{ "credentialRef": "reference" }`; header references may
have a non-secret prefix. OAuth metadata contains scopes and optional clientId and
clientSecretRef, never tokens or discovered endpoints. Transport-owned HTTP headers
cannot be overridden. Stdio processes use an allowlisted base environment, not the
backend's private credential environment. Relative paths resolve from the actual
owning session/worktree; configuration still comes from the canonical project.

Files are strict JSON with bounded safe validation. Prototype record keys are rejected
rather than silently dropped. Comments, duplicate decoded
keys, unknown/transport-mismatched fields, SSE and URL user information are rejected.
Both transports are exposed to ACP through fixed local stdio adapters, so optional
ACP HTTP support is unnecessary. Tools only: no resources, prompts, sampling or
elicitation. Existing ACP permission handling remains in place; annotations never
grant authority. Calls require the owning active turn and are never automatically
replayed after transport/authentication failure.

### Using a separately configured Playwright server in Chat

After enabling Playwright, start a **new chat** and ask:

> Use the configured playwright server, rather than the managed browser tool, to
> open https://example.com, take an accessibility snapshot,
> report the page title and main heading, and save a screenshot as example-com.png.
> Report the screenshot's full path. Do not substitute shell commands or webfetch.

Providers choose how models call MCP tools. OpenCode 2.2.6 exposes them inside
its Code Mode `execute` tool, not as direct top-level `playwright_browser_*`
calls. The default operating contract explains this wrapper. For example,
when listed in the provider's catalog, navigation is an `execute` call with
`{"code":"return await tools.playwright.browser_navigate({url:'https://example.com'})"}`.
Use the actual catalog names if you renamed the server. A model claiming
unavailability without trying discovery or the wrapper is not proof of a server
failure. Custom operating-contract overrides may need the same guidance.

## Which sessions receive servers?

Project chats/workers resolve their bound canonical project, independent of sidebar
selection and copied worktree configuration. Relay/custom assistants use User;
their project-targeted workers resolve the target project. Every ACP session has
separate upstream instances and fresh capabilities, including load/resume, handoff
and continuity replacement. Scheduler, provider verification, memory/search and
other isolated helpers receive no managed connectors. Invalid/unsafe/recovery-blocked
configuration blocks managed connections in that context and never falls back to a
shadowed definition.

## Credentials and trust

Literal bindings are explicitly non-secret. Credential references remain unverified
in phase 5 and block connection until secure authentication is available. Moving a
definition copies neither credentials nor approval. Providers receive ephemeral
connector capabilities, never upstream commands, URLs or credentials. Browser detach
cancels page-owned tests/decisions but preserves approved work; Stop/replacement and
backend shutdown revoke capabilities and drain owned cleanup. Reconnect creates
fresh authority. A failed or uncertain call must be reviewed, never silently replayed.

## MCP activity attribution

Identified MCP tool calls show an **MCP** badge and provider-reported server name
in orchestration, worker and manual chat activity, including saved history.
The Events table has a sortable, filterable **Server** column. An explicitly
identified MCP call with no usable server name shows `Unknown`; other events
leave the column blank.

ACP adapters do not all expose this information. Code60 supports structured
programmatic names using Claude's `mcp__<server>__<tool>` convention (the ACP
`name` field or `_meta.claudeCode.toolName`), the Claude adapter's
`_meta.jetbrains.air.mcp` object, and its explicit `_meta.is_mcp_tool_call`
marker. Server names may be normalized by the provider rather than exactly
matching config keys. Titles, tool arguments and configured server lists are
never used to guess attribution. Older history without metadata stays unlabelled.
This display metadata does not grant permission or prove that a server connected
or a task succeeded. Only the marker and server name are added to typed events,
not server definitions. Raw ACP events retain the provider's original payload
under the existing transcript rules.

## Orchestrator commands

Start a project chat message with the built-in `$create-command`, followed by instructions
for the command you want. For example, `$create-command Make a review command that
checks changes for bugs.` The bundled prompt guides the agent to infer the fields,
ask for missing details, and use the creation tool without executing the saved
prompt. It is available in the dollar-command picker without adding a database row; a saved
command with the same name takes precedence.

Ask the desktop orchestrator to create a reusable command. Its
`code60_create_command` tool takes `name` (without `$`), `title`, optional
`description`, and `prompt`. It saves immediately in the connected database,
shared across projects, and returns the saved command. It does not run the prompt.
Use `$name` at the start of a project orchestrator message to invoke it.

Names use 1–64 lowercase letters, digits or hyphens, starting with a letter or
digit. Titles are single-line and at most 120 characters, descriptions at most
500, and prompts nonempty and at most 100,000. A database holds at most 200 commands.
The tool is create-only: duplicate names fail rather than overwrite. Edit or delete
commands in Command Builder. Workers and CLI runs do not receive this capability.

## Orchestrator plans

The desktop orchestrator can use `code60_create_plan` to save an optional task list.
Its tab opens in Chat's right panel. Ask for revisions in chat, then select **Accept**
to start the displayed revision. The progress bar and **X out of Y** count above the
document give each task equal weight; only completed tasks count. They are not part
of the saved Markdown.

Documents live in `plans/<id>.md` under the conversation's private working directory
beside the connected database. Code60 owns these files and their private sidecar records;
use chat for revisions rather than editing the files externally. Closing a tab does not
delete its plan: reopen it from the plan link in the conversation.

`code60_read_plan` returns the latest revision. `code60_update_plan` revises a draft
or reports task progress with an evidence note after acceptance. These tools are limited
to their owning conversation and cannot accept plans. Drafts block that conversation's
new worker work until accepted or dismissed. During execution, `planTaskId` associates
worker dispatch and follow-ups with an unfinished task. Existing ownership, Git readiness,
parallelism, and review rules still apply.

Stop pauses plan continuation; running workers retain their own stop controls. A blocked
task or failed worker leaves tasks unchecked and requires **Resume plan** after inspecting
previous work. Resuming a plan may continue existing work, so inspect any delivery error
before retrying. Project changes pause accepted plans. Restarting or replacing a conversation
retains its documents on disk but never restores execution authority or resumes work.


## Guided configuration management

Open **Apps → MCP Servers**. Choose User, or an open project, then Add server.
Start blank, choose the optional pinned Playwright/Context7 template, or paste one
version-one server definition and review its fields. Choose a stable lowercase
server ID and an editable label. New definitions are saved disabled. Edit preserves
the existing enabled state. Enable/Disable controls apply to future connections.

Use argument rows for stdio and explicit non-secret literals or credential
references for environment/header bindings. References remain unverified; this
page never stores or resolves credentials. OAuth fields are registration metadata,
not a sign-in flow. Saving or viewing a template never launches its command or
contacts its endpoint. A future approved npx launch may download its package.

User configuration needs no database and writes to the dedicated configuration
folder's mcp.json. Project configuration writes to .code60/mcp.json in the canonical
open project. These files do not feed active agent sessions yet. The current
config.json loader remains unchanged during this intermediate phase.

Project entries shadow user IDs even while disabled or unapproved. Inherited
entries link to their user configuration. Remove previews any inheritance revealed;
Move previews source/destination, collisions and unverified references. It moves
no credentials or approvals. Closed repositories are not scanned.

Conflicts retain the draft; reload explicitly before saving against the new
revision. Invalid files and pending recovery block guided changes. Preserve evidence
and follow [configuration recovery](docs/runbooks/mcp-configuration.md). The direct
JSON editor, backup restore and reset are described below; transaction recovery
controls remain backend-only.


## JSON editing, backups and reset

In Apps → MCP Servers, choose **Servers** for immediate guided saves or **JSON**
for the dedicated file. JSON Save preserves valid text exactly; **Format JSON**
explicitly produces two-space indentation and a final newline. Invalid syntax,
duplicate keys and schema issues disable Save, including its keyboard shortcut.
Completion and validation run locally. Never paste secrets; use credential references.

Before guided edits or scope changes, choose Save, Discard or Cancel for dirty JSON.
Ordinary page navigation retains the draft and editor position in memory; browser
reload/close can lose it and shows a warning. Project close/replacement disables
submission until explicit reload/discard. External changes retain dirty text: use
**Compare saved and draft** to inspect the latest file, then explicitly discard
or revise your draft. Discard reads the latest file without writing or backing up.

**Restore backup** lists private preimages. Preview a valid, unpinned configuration
and confirm against both its reviewed identity and the current file revision. An
absent-file backup removes the dedicated file, revealing inheritance where applicable.
Malformed/pinned preimages remain recovery evidence. Failed operations retain drafts.

**Reset this configuration** clears only this configuration; project scope also offers
**Reset User and this project**. Review removed definitions, inherited User entries,
open-project effects and unsaved-draft loss before confirmation. Clearing User affects
other projects using User entries, without scanning closed repositories. Safe bounded
malformed originals can be reset or repaired in JSON; their exact bytes are backed up.
Unsafe/oversized originals remain blocked. Missing/empty targets are not rewritten.

Reset preserves other project files, unrelated settings, built-ins, credentials and
running agents/connections. Interrupted changes require explicit backend Complete or
Roll back; preserve evidence and follow the recovery runbook. Runtime activation is described above; sign-in and transaction recovery GUI remain
later phases.


## Credentials and sign-in

Credential bindings contain references, never secret values. Authentication controls
are human-only and never expose a credential-read API. Enter a value in the
transient authentication dialog; it clears on submission or dismissal. Select
**Persistent** for macOS Keychain or Linux Secret Service, or explicitly select
**Temporary** to keep it only in backend memory until restart or sign-out.
Locked/unavailable persistent storage blocks the operation; it never silently
becomes temporary storage or Linux keyutils. Unlock/configure the operating-system
store separately, or make a new explicit temporary choice.

Credentials bind this installation, canonical configuration source, server ID,
security-relevant definition, reference and account/grant. Label and enabled edits
do not rebind them. Commands, arguments, endpoint, bindings, registration and scopes
require review and new entry/authorization. Moving a definition transfers neither
credentials nor approval. An interrupted credential operation may require fresh
entry; an older stored version is never reactivated as a fallback.

For OAuth, select an advertised issuer, then review issuer, resource, scopes,
endpoints and registration before starting. Supply your own client ID and optional
client-secret reference, or use advertised per-installation dynamic registration.
A user-hosted HTTPS client-metadata URL requires **Metadata URL** client ID type
and server support; ordinary client IDs remain opaque even when they look like URLs.
Code60 does not host metadata or distribute a shared client registration. Discovery
is anonymous; private issuer destinations require explicit approval. MCP endpoints
may be explicitly configured local/LAN addresses, but credentials require HTTPS
except loopback. Application-private listeners and metadata-service addresses are
blocked. Transport-owned headers and OAuth/Authorization conflicts are rejected.

Continue authorization in the browser. The single-use loopback callback is bound
to the initiating page, configuration/revision and attempt, expires in five minutes,
and uses S256 PKCE and issuer/resource checks. Cancel, page detach, owner replacement
or shutdown invalidates pending attempts. Ordinary in-app navigation preserves
pending sign-in and JSON drafts. Completed temporary credentials survive navigation
and browser detach while the backend runs.

Sign-out revokes affected connection capabilities immediately, clears temporary
material, closes owned upstreams and attempts persistent removal and advertised
remote revocation. Local deletion and remote revocation have separate outcomes;
locked storage can leave **deletion uncertain**, with private tombstones preventing
reuse after restart. Explicitly retry cleanup after unlocking. Forgetting one
reference preserves other manual references but invalidates that server's OAuth
grant and closes its connections. Enablement and configuration are unchanged.
No business request is replayed after authentication failure. An uncertain refresh
requires explicit reauthorization. Reconnect remains an idle, reviewed action.

Native/package QA uses `npm run test:mcp:credentials` against the packaged tarball.
Linux requires a disposable private D-Bus and Secret Service (`dbus-run-session`,
`gnome-keyring-daemon`, `gdbus` for this QA harness); macOS uses only a unique
synthetic service/account namespace. The production helper needs no QA commands.
Never enumerate unrelated credentials or lock a shared service for a test.
