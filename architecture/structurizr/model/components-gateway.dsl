# Level 3 Components inside Code60 Gateway (aligned 1:1 with test/boundaries.test.ts)
gatewayTransport = component "Gateway Transport" "HTTP/SSE, auth, LAN, MCP broker, OAuth." "src/gateway" {
    properties {
        src_module "gateway"
        code_path "src/gateway"
    }
}

applicationHost = component "Application Host" "Projects, Relay, MCP, workflows, terminals." "src/application" {
    properties {
        src_module "application"
        code_path "src/application"
    }
}

coreDomain = component "Core Domain" "Runs, policy, WorkflowEngine, UsageStore." "src/core" {
    properties {
        src_module "core"
        code_path "src/core"
    }
}

scheduler = component "Scheduler" "1s tick loop, lanes, headless prompt runs." "src/automation" {
    properties {
        src_module "automation"
        code_path "src/automation"
    }
}

acpAndMcpAgents = component "ACP & MCP Agents" "ACP client SDK and MCP transports." "src/agents" {
    properties {
        src_module "agents"
        code_path "src/agents"
    }
}

gitAdapter = component "Git Adapter" "Worktrees, diffs, snapshots, repo setup." "src/git" {
    properties {
        src_module "git"
        code_path "src/git"
    }
}

platformLayer = component "Platform" "Processes, services, guarded FS, PTYs." "src/platform" {
    properties {
        src_module "platform"
        code_path "src/platform"
    }
}

bridgeContract = component "Bridge Contract" "Typed ApplicationClient RPC contract." "src/bridge" {
    properties {
        src_module "bridge"
        code_path "src/bridge"
    }
}

sharedContracts = component "Shared Contracts" "Zod schemas, prompts, capabilities." "src/contracts" {
    properties {
        src_module "contracts"
        code_path "src/contracts"
    }
}

# Module dependency edges matching test/boundaries.test.ts ALLOWED
gatewayTransport -> applicationHost "Dispatches RPCs"
gatewayTransport -> scheduler "Runs scheduler"
gatewayTransport -> acpAndMcpAgents "Injects MCP transports"
gatewayTransport -> coreDomain "Config and usage"
gatewayTransport -> bridgeContract "Validates RPCs"
gatewayTransport -> sharedContracts "Uses schemas"
gatewayTransport -> platformLayer "Locks, LAN, status"

applicationHost -> coreDomain "Runs and workflows"
applicationHost -> scheduler "Manages schedules"
applicationHost -> bridgeContract "Implements client"
applicationHost -> platformLayer "Processes and FS"

scheduler -> coreDomain "Executes runs"
scheduler -> sharedContracts "Schedule schemas"
scheduler -> platformLayer "CAS state and procs"

coreDomain -> acpAndMcpAgents "Drives ACP sessions"
coreDomain -> gitAdapter "Worktrees and diffs"
coreDomain -> sharedContracts "Domain schemas"
coreDomain -> platformLayer "Procs and storage"

acpAndMcpAgents -> sharedContracts "Protocol schemas"
acpAndMcpAgents -> platformLayer "Process groups"

gitAdapter -> platformLayer "Spawns git CLI"
bridgeContract -> sharedContracts "Shared schemas"
bridgeContract -> coreDomain "Domain types"
