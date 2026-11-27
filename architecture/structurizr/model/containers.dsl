code60 = softwareSystem "Code60" "Local Node.js 24 backend and React/Carbon browser application for orchestrating coding agents in isolated Git worktrees." {

    # Executable Containers
    browserSpa = container "Browser SPA" "Interactive React 19 + IBM Carbon interface (Chat, Plans, Reviews, Files, Terminal, Workflows, Scheduled Jobs, MCP, Health Check, Usage, Settings)." "TypeScript, React 19, Carbon, Vite" "WebBrowser" {
        properties {
            src_module "renderer"
            code_path "src/renderer"
        }
        !include components-renderer.dsl
    }

    gateway = container "Code60 Gateway (Unified Backend)" "Long-lived Node.js 24 backend serving static SPA assets, HTTP/SSE API, single-controller sessions, LAN Web Server Beta, ApplicationHost, in-process Scheduler, MCP Gateway/Broker, and ephemeral OAuth callbacks." "Node.js 24, TypeScript ESM, HTTP/SSE" "Backend" {
        properties {
            code_path "src/gateway/main.ts, src/gateway/container.ts"
        }
        !include components-gateway.dsl
    }

    managementCli = container "Management CLI (code60)" "Local CLI for setup, status, open, service install/start/stop/repair/uninstall, pairing on/off/status, usage, update, and state-preserving uninstall." "Node.js 24 CLI" "CLI" {
        properties {
            src_module "management"
            code_path "src/management"
        }
    }

    mcpSidecar = container "Orchestration MCP Sidecar" "Per-orchestrator stdio MCP bridge exposing code60_* worker, table, activity, knowledge, and browser tools to ACP orchestrator sessions." "Node.js 24, stdio JSON-RPC" "Sidecar" {
        properties {
            code_path "src/application/mcp-server.ts"
        }
    }

    mcpAdapter = container "External MCP Stdio Adapter" "Per-session capability-leased stdio MCP proxy forwarding tool calls to Gateway's loopback MCP broker without receiving upstream configs or secrets." "Node.js 24, @modelcontextprotocol/sdk" "Sidecar" {
        properties {
            code_path "src/agents/mcp-adapter.ts"
        }
    }

    ragWorker = container "RAG Worker" "Forked Node.js worker running single-flight conversation indexing and retrieval with offline ONNX embeddings." "Node.js 24 IPC, Transformers.js" "Worker" {
        properties {
            code_path "src/application/rag-worker.ts"
        }
    }

    memoryWorker = container "Memory Worker" "Forked Node.js worker owning memory.sqlite (FTS5 + 768-dim vectors) and offline ONNX recall; retires after 60s idle." "Node.js 24 IPC, node:sqlite, Transformers.js" "Worker" {
        properties {
            code_path "src/application/memory-worker.ts"
        }
    }

    credentialHelper = container "Credential Helper" "Short-lived isolated Node.js child process accessing OS Keychain or Linux Secret Service over stdin/stdout pipes." "Node.js 24, @napi-rs/keyring" "Helper" {
        properties {
            code_path "src/platform/credential-helper.ts"
        }
    }

    ptyHelper = container "POSIX PTY Helper (code60-pty)" "Compiled native C binary allocating PTYs for interactive browser xterm.js shells rooted in workspaces or worktrees." "C (POSIX PTY)" "Helper" {
        properties {
            code_path "native/posix/code60-pty.c"
        }
    }

    # Persistent Data Stores
    projectDb = container "Project SQLite DB & Workspace Sidecar" "User-selected or default.sqlite (SCHEMA 6: projects, configs, prompts, commands) plus .code60_workspace/ (chats, plans, reviews, checkpoints, RAG index)." "SQLite (node:sqlite) & JSON" "Database"
    memoryDb = container "Memory Database" "Episodic memory records, revisions, FTS5 index, and 768-dim vectors under $XDG_STATE_HOME/code60/memory/memory.sqlite." "SQLite (node:sqlite, FTS5)" "Database"
    opsStores = container "Operational Stores" "workflows.sqlite, usage.sqlite (90d/500k turns), automations/state.json, relay/state.json, and custom-agents definitions." "SQLite & Private JSON" "Database"
    recordsAndLogs = container "Run Records & Diagnostic Logs" "Private 0600/0700 run.json and events.jsonl transcripts plus bounded 7d/20 MiB typed JSONL diagnostic logs." "JSON & JSONL" "Database"
    configAndMcpState = container "Config, MCP & Install State" "config.json, User/Project mcp.json + transactional journals/backups, gateway/*.json, managed activations/, and provider binaries." "Guarded JSON & Filesystem" "Database"
    embeddingModel = container "Offline Embedding Model" "Bundled read-only INT8 ONNX model (jina-embeddings-v2-base-code, 768 dims) with remote fetches disabled." "ONNX / Tokenizer Assets" "Database"

    # Container-to-Container Relationships
    browserSpa -> gateway "Calls allowlisted RPCs and subscribes to live events" "Same-origin HTTP + SSE"
    managementCli -> gateway "Issues local lifecycle, pairing, status, and shutdown commands" "Loopback HTTP /management/* + connection.json token"
    managementCli -> configAndMcpState "Reads/writes installation receipts, gateway settings, and activation links" "Private POSIX FS"
    managementCli -> opsStores "Queries local usage telemetry for code60 usage" "Read-only SQLite"

    gateway -> projectDb "Reads/writes project metadata, commands, prompts, plans, reviews, and checkpoints" "node:sqlite & FS"
    gateway -> opsStores "Persists workflows, usage telemetry, schedules, Relay state, and custom assistants" "node:sqlite & CAS JSON"
    gateway -> recordsAndLogs "Appends run transcripts and bounded typed diagnostic logs" "Private JSONL (0600)"
    gateway -> configAndMcpState "Loads/saves config.json, guarded mcp.json, journals, backups, and gateway state" "Guarded POSIX FS"
    gateway -> ragWorker "Dispatches single-flight RAG index rebuild and query jobs" "Node IPC"
    gateway -> memoryWorker "Dispatches episodic memory extraction, recall, and maintenance" "Node IPC"
    gateway -> credentialHelper "Reads, writes, and deletes MCP secrets without exposing them to browsers" "Bounded stdin/stdout JSON"
    gateway -> ptyHelper "Spawns interactive workspace/worktree login shells (up to 16 PTYs)" "POSIX stdio/PTY"

    mcpSidecar -> gateway "Forwards code60_* tool calls with ephemeral Bearer token" "Loopback HTTP POST /v1/call"
    mcpAdapter -> gateway "Holds streaming capability lease and forwards external MCP tool calls" "Loopback HTTP /lease + /request"
    ragWorker -> projectDb "Reads/writes derived RAG index snapshots in .code60_workspace/rag/" "JSON FS"
    ragWorker -> embeddingModel "Computes offline text embeddings" "ONNX CPU (local)"
    memoryWorker -> memoryDb "Reads/writes episodic memories, FTS5 index, and vector blobs" "node:sqlite"
    memoryWorker -> embeddingModel "Computes offline memory embeddings" "ONNX CPU (local)"
}

# Person -> Code60 & External Relationships
developer -> code60.browserSpa "Uses interactive UI on localhost (127.0.0.1)" "HTTPS/HTTP (local)"
developer -> code60.managementCli "Runs setup, service, pairing, usage, update, and uninstall" "Local terminal"
lanUser -> code60.browserSpa "Uses paired Web Server (Beta) UI on trusted LAN" "HTTP (RFC1918 + 60s code)"
developer -> externalMcp "Completes browser OAuth 2.1/PKCE consent when configuring HTTP MCP servers" "HTTPS"

# Code60 -> External System Relationships
code60.gateway -> acpProviders "Spawns and drives ACP agent sessions over stdio; streams updates and permissions" "ACP JSON-RPC over stdio"
acpProviders -> code60.mcpSidecar "Invokes Code60 orchestration, table, knowledge, and browser tools" "MCP stdio"
acpProviders -> code60.mcpAdapter "Invokes user/project external MCP tools via capability-leased adapter" "MCP stdio"
code60.gateway -> externalMcp "Connects to upstream stdio or Streamable HTTP MCP servers and OAuth endpoints" "Stdio / HTTPS + PKCE"
code60.gateway -> chromeBrowser "Runs pinned @playwright/mcp@0.0.84 lazily for code60_browser calls" "MCP stdio / CDP"
code60.gateway -> localGit "Creates/merges isolated worktrees, snapshots, diffs, and workspace file reads" "Git CLI & POSIX FS"
code60.gateway -> osSupervisor "Queries login-service health status (read-only from browser)" "launchctl / systemctl"
code60.gateway -> registries "Installs explicitly approved pinned catalog provider harnesses" "HTTPS (npm/CDNs)"
code60.managementCli -> osSupervisor "Installs, starts, stops, repairs, and uninstalls per-user login service" "launchctl / systemctl"
code60.managementCli -> registries "Resolves stable updates and downloads SHA-256 verified platform payloads" "HTTPS (npm / GitHub)"
code60.credentialHelper -> osSecretStore "Stores and retrieves MCP credentials and OAuth tokens" "macOS Keychain / D-Bus Secret Service"
code60.ptyHelper -> localGit "Runs user login shell rooted in approved project or worktree directory" "POSIX shell"
