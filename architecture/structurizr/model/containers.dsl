code60 = softwareSystem "Code60" "Local browser app for orchestrating coding agents in Git worktrees." {

    # Executable Containers
    browserSpa = container "Browser SPA" "React and Carbon web interface." "React 19 / Carbon" "WebBrowser" {
        properties {
            src_module "renderer"
            code_path "src/renderer"
        }
        !include components-renderer.dsl
    }

    gateway = container "Code60 Gateway" "Unified backend, scheduler, and MCP broker." "Node 24 / HTTP+SSE" "Backend" {
        properties {
            code_path "src/gateway/main.ts, src/gateway/container.ts"
        }
        !include components-gateway.dsl
    }

    managementCli = container "Management CLI" "Local setup, service, update, and usage CLI." "Node 24 CLI" "CLI" {
        properties {
            src_module "management"
            code_path "src/management"
        }
    }

    mcpSidecar = container "Orchestration MCP Sidecar" "Exposes code60_* tools to orchestrators." "Node 24 / stdio" "Sidecar" {
        properties {
            code_path "src/application/mcp-server.ts"
        }
    }

    mcpAdapter = container "External MCP Adapter" "Capability-leased stdio proxy per session." "Node 24 / MCP SDK" "Sidecar" {
        properties {
            code_path "src/agents/mcp-adapter.ts"
        }
    }

    ragWorker = container "RAG Worker" "Indexes and searches chat history offline." "Node IPC / ONNX" "Worker" {
        properties {
            code_path "src/application/rag-worker.ts"
        }
    }

    memoryWorker = container "Memory Worker" "Runs episodic memory FTS5 and vectors." "Node IPC / ONNX" "Worker" {
        properties {
            code_path "src/application/memory-worker.ts"
        }
    }

    credentialHelper = container "Credential Helper" "Isolated OS keyring helper process." "Node 24 / keyring" "Helper" {
        properties {
            code_path "src/platform/credential-helper.ts"
        }
    }

    ptyHelper = container "PTY Helper" "Allocates POSIX shells for browser terminals." "C (POSIX PTY)" "Helper" {
        properties {
            code_path "native/posix/code60-pty.c"
        }
    }

    # Persistent Data Stores
    projectDb = container "Project DB & Sidecar" "Projects, prompts, commands, chats, plans." "SQLite / JSON" "Database"
    memoryDb = container "Memory DB" "Episodic memories, FTS5, and vectors." "SQLite FTS5" "Database"
    opsStores = container "Operational Stores" "Workflows, usage, schedules, Relay state." "SQLite / JSON" "Database"
    recordsAndLogs = container "Run Records & Logs" "Run transcripts and 7d diagnostic logs." "Private JSONL" "Database"
    configAndMcpState = container "Config & MCP State" "config.json, mcp.json, journals, installs." "Guarded JSON" "Database"
    embeddingModel = container "Embedding Model" "Bundled offline INT8 code embeddings." "ONNX (local)" "Database"

    # Container-to-Container Relationships
    browserSpa -> gateway "RPCs and live events" "HTTP / SSE"
    managementCli -> gateway "Lifecycle and pairing" "Loopback HTTP"
    managementCli -> configAndMcpState "Receipts and settings" "POSIX FS"
    managementCli -> opsStores "Reads usage stats" "SQLite"

    gateway -> projectDb "Project and chat data" "SQLite / FS"
    gateway -> opsStores "Workflows, usage, jobs" "SQLite / JSON"
    gateway -> recordsAndLogs "Transcripts and logs" "JSONL"
    gateway -> configAndMcpState "Configs and MCP state" "Guarded FS"
    gateway -> ragWorker "Index and search jobs" "Node IPC"
    gateway -> memoryWorker "Recall and extraction" "Node IPC"
    gateway -> credentialHelper "Secret operations" "stdin / stdout"
    gateway -> ptyHelper "Terminal shells" "POSIX PTY"

    mcpSidecar -> gateway "Forwards code60_* calls" "Loopback HTTP"
    mcpAdapter -> gateway "Proxies leased calls" "Loopback HTTP"
    ragWorker -> projectDb "RAG index snapshots" "JSON FS"
    ragWorker -> embeddingModel "Computes embeddings" "ONNX CPU"
    memoryWorker -> memoryDb "Memories and vectors" "SQLite"
    memoryWorker -> embeddingModel "Computes embeddings" "ONNX CPU"
}

# Person -> Code60 & External Relationships
developer -> code60.browserSpa "Uses localhost UI" "HTTP (127.0.0.1)"
developer -> code60.managementCli "Manages local service" "Terminal"
lanUser -> code60.browserSpa "Uses paired LAN UI" "HTTP (LAN)"
developer -> externalMcp "Approves OAuth login" "HTTPS"

# Code60 -> External System Relationships
code60.gateway -> acpProviders "Drives ACP sessions" "ACP stdio"
acpProviders -> code60.mcpSidecar "Calls Code60 tools" "MCP stdio"
acpProviders -> code60.mcpAdapter "Calls external MCP" "MCP stdio"
code60.gateway -> externalMcp "Connects upstream MCP" "Stdio / HTTPS"
code60.gateway -> chromeBrowser "Runs Playwright MCP" "MCP stdio"
code60.gateway -> localGit "Worktrees and diffs" "Git CLI / FS"
code60.gateway -> osSupervisor "Checks service health" "launchctl / systemctl"
code60.gateway -> registries "Installs catalog CLIs" "HTTPS"
code60.managementCli -> osSupervisor "Controls login service" "launchctl / systemctl"
code60.managementCli -> registries "Fetches signed releases" "HTTPS"
code60.credentialHelper -> osSecretStore "Stores MCP secrets" "Keychain / D-Bus"
code60.ptyHelper -> localGit "Runs workspace shell" "POSIX shell"
