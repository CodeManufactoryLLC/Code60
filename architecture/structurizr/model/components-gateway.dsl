# Level 3 Components inside Code60 Gateway (aligned 1:1 with test/boundaries.test.ts)
gatewayTransport = component "Gateway Transport & Auth" "HTTP/SSE server, static SPA hosting, session/pairing auth, single-controller lease, operation router, Web Server Beta LAN ingress, private MCP capability broker, and ephemeral OAuth callback listener." "src/gateway" {
    properties {
        src_module "gateway"
        code_path "src/gateway"
    }
}

applicationHost = component "Application Host & Services" "ApplicationHost orchestrating projects, Relay, Custom Assistants, conversations/workers, MCP management/auth/recovery, browser automation, workflows facade, terminals, Health Check, Logs, Memory/RAG, and provider setup." "src/application" {
    properties {
        src_module "application"
        code_path "src/application"
    }
}

coreDomain = component "Core Domain & Engines" "Pure domain orchestration (Orchestrator, Run lifecycle, TaskLoop), permission policy, config loader, run record store, crash recovery, native WorkflowEngine (SQLite), UsageStore/estimator, and RAG/Memory domain logic." "src/core" {
    properties {
        src_module "core"
        code_path "src/core"
    }
}

scheduler = component "In-Process Scheduler" "1s tick scheduler loop, recurrence evaluator, per-type lanes (1 prompt / 2 workflow), per-repo locks, and headless deny-by-default prompt executor." "src/automation" {
    properties {
        src_module "automation"
        code_path "src/automation"
    }
}

acpAndMcpAgents = component "ACP & MCP Protocol Agents" "Owns @agentclientprotocol/sdk client connections, session state/usage collection, and @modelcontextprotocol/sdk upstream stdio/Streamable HTTP transports." "src/agents" {
    properties {
        src_module "agents"
        code_path "src/agents"
    }
}

gitAdapter = component "Git & Worktree Adapter" "Safe Git CLI execution, isolated code60/* worktree lifecycle, diffs, disposable-index snapshots, 3-way merges, and repository initialization." "src/git" {
    properties {
        src_module "git"
        code_path "src/git"
    }
}

platformLayer = component "Platform & OS Primitives" "POSIX process groups, launchd/systemd unit control, guarded atomic file writes, SSRF network policy, private IPv4 detection, PTY/keyring child launchers, and payload SHA-256 verification." "src/platform" {
    properties {
        src_module "platform"
        code_path "src/platform"
    }
}

bridgeContract = component "Typed RPC Bridge Contract" "Typed ApplicationClient interface and domain request/response parsers shared between Renderer, Gateway, and Application." "src/bridge" {
    properties {
        src_module "bridge"
        code_path "src/bridge"
    }
}

sharedContracts = component "Shared Contracts & Schemas" "Browser-safe Zod v4 (jitless) schemas, navigation definitions, 44-prompt catalog, self-knowledge capability registry, and MCP/workflow/usage/health contracts." "src/contracts" {
    properties {
        src_module "contracts"
        code_path "src/contracts"
    }
}

# Module dependency edges matching test/boundaries.test.ts ALLOWED
gatewayTransport -> applicationHost "Dispatches validated UI operations and subscribes to host events"
gatewayTransport -> scheduler "Starts in-process scheduler and binds workflow action handler"
gatewayTransport -> acpAndMcpAgents "Injects upstream MCP transport connector and adapter descriptors"
gatewayTransport -> coreDomain "Reads config, usage store, and domain types"
gatewayTransport -> bridgeContract "Validates ApplicationClient RPC payloads"
gatewayTransport -> sharedContracts "Validates Zod schemas and navigation/MCP contracts"
gatewayTransport -> platformLayer "Uses private-state locks, LAN IPv4 detection, and service status"

applicationHost -> coreDomain "Drives runs, workflow engine, usage store, and config"
applicationHost -> scheduler "Reads/mutates schedules and live execution state"
applicationHost -> bridgeContract "Implements ApplicationClient handlers"
applicationHost -> platformLayer "Spawns owned processes, guarded writes, keyring helper, and PTYs"

scheduler -> coreDomain "Runs headless prompt turns and recurrence evaluation"
scheduler -> sharedContracts "Validates schedule schemas and limits"
scheduler -> platformLayer "Uses private CAS state persistence and process safety"

coreDomain -> acpAndMcpAgents "Drives ACP agent sessions and collects turn usage"
coreDomain -> gitAdapter "Manages worktrees, diffs, snapshots, and repo setup"
coreDomain -> sharedContracts "Uses Zod schemas, limits, and prompt/workflow contracts"
coreDomain -> platformLayer "Uses process groups, atomic storage, and diagnostic redaction"

acpAndMcpAgents -> sharedContracts "Uses ACP/MCP schema definitions"
acpAndMcpAgents -> platformLayer "Spawns agent/MCP process groups and enforces network policy"

gitAdapter -> platformLayer "Invokes Git subprocesses safely with argument arrays"
bridgeContract -> sharedContracts "Composes shared Zod schemas"
bridgeContract -> coreDomain "References core domain types (type-only)"
