# MCP configuration

Code60 passes configured [Model Context Protocol](https://modelcontextprotocol.io/)
servers to your coding agent through ACP. Edit
`$XDG_CONFIG_HOME/code60/config.json`, or `~/.config/code60/config.json` when
`XDG_CONFIG_HOME` is unset. Code60 only reads this file; there is no MCP Settings
editor. Merge the following optional field into your existing configuration:

```json
{
  "mcpServers": {
    "local-tools": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/server.js"],
      "env": {}
    },
    "remote-tools": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": {}
    },
    "legacy-tools": {
      "type": "sse",
      "url": "https://example.com/sse"
    }
  }
}
```

These are placeholders. Install and configure your own servers before using them.
On Windows use an installed executable and JSON-escaped absolute paths such as
`C:\\tools\\server.js`. Code60 does not install MCP servers.

## Bundled starter file

[`mcp.default.json`](mcp.default.json) includes two **opt-in** stdio servers:

- **Playwright MCP** (`@playwright/mcp@0.0.84`) for browser automation. It uses
  `--isolated --headless`, so each session gets a separate in-memory profile
  without opening browser windows. Profile isolation is not a security sandbox.
- **Context7** (`@upstash/context7-mcp@4.5.1`) for current library documentation.
  Queries go to an external service. Keyless use has rate limits; optionally
  supply `CONTEXT7_API_KEY` through the server's environment or its supported
  authentication workflow. Never put keys in command arguments.

The file is in the source/CLI package root and the desktop installation's
`resources` directory (`Code60.app/Contents/Resources` on macOS). Code60 does
not load it automatically. To enable either server, open your user `config.json`
at the path above and merge the desired entries into its `mcpServers` object.
Keep other configuration and existing server entries; do not replace the whole
file. Remove an entry to disable it for subsequent sessions.

These commands require Node.js and npm (`npx`) on the provider's PATH. The pins
above require Node.js 20.18.1 or newer; Code60's supported Node.js versions
satisfy this. After opt-in, `npx -y` may download and execute the named packages
when the agent launches them. No packages or browsers are installed by Code60.
Playwright MCP uses Chrome by default; install Chrome separately or follow
[Playwright MCP's browser setup](https://github.com/microsoft/playwright-mcp)
to select/install a supported browser. Verify your provider forwards client MCP
servers and any inherited environment variables it needs.

## Fields and provider support

- `mcpServers` defaults to `{}`. Server names must contain non-whitespace text.
  `code60` is reserved for the built-in orchestration gateway.
- Every server requires `type`: `stdio`, `http`, or `sse`.
- Stdio requires a nonempty `command` string. Optional `args` is an array of
  strings and `env` maps variable names to string values; they default to `[]`
  and `{}`. Prefer absolute server paths: each agent runs in its session directory,
  which may be a worktree or a private chat directory.
- HTTP and SSE require an HTTP(S) `url`. Optional `headers` maps header names to
  string values and defaults to `{}`. Use HTTPS outside trusted local development.
- Unknown fields, fields belonging to another transport and malformed values
  are configuration errors, reported through the existing usage-error path
  (CLI exit code 2), without environment/header values.

The provider's ACP adapter must support client-supplied MCP servers. Stdio is
part of baseline ACP. HTTP requires advertised
`agentCapabilities.mcpCapabilities.http: true`; SSE requires
`agentCapabilities.mcpCapabilities.sse: true`. A missing/false capability fails
session startup with an explicit transport error. Code60 never drops unsupported
servers. Use another compatible provider or change the configuration.
Server connection and authentication failures are handled by the agent.

### Using Playwright in Chat

After enabling Playwright, start a **new chat** and ask:

> Use Playwright MCP to open https://example.com, take an accessibility snapshot,
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

Headless CLI runs, desktop manual sessions and dispatched workers receive only
your configured servers. Orchestration chats receive those servers **plus**
their private built-in `code60` stdio server. That built-in server provides scoped
Code60 table and worker-control tools; it is never given to workers or manual/CLI
sessions. User servers do not receive its gateway token.

Setup/connection probes, episodic-memory extraction and search-summary helpers
receive no user MCP servers. A successful setup probe therefore does not establish
HTTP/SSE capability or test your MCP connections.

Changes apply to subsequent runs/workers, new or retried chats, and explicit
recovery of ended runs. Existing active or idle sessions keep their original
servers across follow-up turns and config reloads. Desktop config polling or
manual refresh loads edits for new chats; CLI invocations read the file directly.
Recovery sends the current definitions with ACP resume/load, or with the fresh
session used for a handoff. No definitions are recovered from run records.

## Credentials and trust

Only configure servers and providers you trust. Stdio commands run under your
agent's permissions, not in a Code60 sandbox. The agent owns MCP processes and
connections; ordinary Code60 agent cleanup and permission policies are unchanged.
Orchestration chats and their workers retain once-only allow-all behavior.

Environment and header values are literal strings, with no `${VARIABLE}`
expansion. Code60 does not write credentials, manage OAuth or supply a credential
store. Authenticate through the provider/server's supported workflow. If you
manually add credentials to the file, keep it private and out of source control.
Prefer provider-managed credentials where supported.

Definitions are sent to your selected agent provider, but Code60 does not add
them to run records, transcripts, renderer snapshots or CLI output. This does
not redact arbitrary agent/tool output: providers or tools can print sensitive
content, which ordinary transcripts may retain. Do not ask agents to print secrets.

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

Start a Chat message with the built-in `/create-command`, followed by instructions
for the command you want. For example, `/create-command Make a review command that
checks changes for bugs.` The bundled prompt guides the agent to infer the fields,
ask for missing details, and use the creation tool without executing the saved
prompt. It is available in the slash picker without adding a database row; a saved
command with the same name takes precedence.

Ask the desktop orchestrator to create a reusable slash command. Its
`code60_create_command` tool takes `name` (without `/`), `title`, optional
`description`, and `prompt`. It saves immediately in the connected database,
shared across projects, and returns the saved command. It does not run the prompt.
Use `/name` at the start of an orchestrator message to invoke it.

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
