dynamic code60 "flow-browser-session" "Browser connection, single-controller lease, SSE stream, and allowlisted RPCs." {
    developer -> code60.browserSpa "1. Opens localhost URL in browser"
    code60.browserSpa -> code60.gateway "2. Connects via POST /api/connect or /api/pair and claims /api/control"
    code60.browserSpa -> code60.gateway "3. Opens GET /api/events SSE stream and submits POST /api/operation"
    code60.gateway -> code60.projectDb "4. Reads/writes validated workspace state"
    autoLayout lr
}

dynamic code60 "flow-agent-orchestration" "Orchestrator prompt dispatch to ACP harness with isolated Git worktree and MCP sidecar." {
    code60.browserSpa -> code60.gateway "1. Submits user prompt and plan approval"
    code60.gateway -> localGit "2. Creates isolated worktree and checkpoint snapshot"
    code60.gateway -> acpProviders "3. Starts/resumes ACP session over stdio"
    acpProviders -> code60.mcpSidecar "4. Invokes code60_* orchestration or browser tools"
    code60.mcpSidecar -> code60.gateway "5. Forwards authenticated POST /v1/call to loopback gateway"
    code60.gateway -> code60.recordsAndLogs "6. Appends events.jsonl transcript and usage record"
    autoLayout lr
}

dynamic code60 "flow-mcp-oauth" "External MCP connector OAuth sign-in, OS Keychain storage, and capability-leased adapter." {
    developer -> code60.browserSpa "1. Initiates OAuth sign-in for HTTP MCP server"
    code60.browserSpa -> code60.gateway "2. Opens ephemeral loopback OAuth callback listener"
    developer -> externalMcp "3. Completes PKCE S256 consent in browser"
    code60.gateway -> code60.credentialHelper "4. Persists OAuth token over stdin pipe"
    code60.credentialHelper -> osSecretStore "5. Stores token in Keychain or Secret Service"
    acpProviders -> code60.mcpAdapter "6. Calls external MCP tool via fixed stdio adapter"
    code60.mcpAdapter -> code60.gateway "7. Proxies request over capability-leased loopback broker"
    code60.gateway -> externalMcp "8. Calls upstream MCP server with backend-resolved token"
    autoLayout lr
}

dynamic code60 "flow-cli-lifecycle" "Managed CLI setup, update, or state-preserving uninstall." {
    developer -> code60.managementCli "1. Runs code60 setup, update, or uninstall"
    code60.managementCli -> registries "2. Resolves release metadata and verifies SHA-256 payload"
    code60.managementCli -> code60.gateway "3. Checks idle ownership / requests graceful shutdown over /management/*"
    code60.managementCli -> osSupervisor "4. Registers, repairs, or unregisters launchd / systemd service"
    code60.managementCli -> code60.configAndMcpState "5. Writes atomic activation receipt and launcher"
    autoLayout lr
}

dynamic code60 "flow-scheduled-job" "In-process Scheduler executing recurring prompt or workflow jobs." {
    code60.gateway -> code60.opsStores "1. Polls automations/state.json and acquires lane/repo locks"
    code60.gateway -> localGit "2. Branches isolated worktree from saved base branch"
    code60.gateway -> acpProviders "3. Executes headless ACP turn (deny-by-default allowlist)"
    code60.gateway -> code60.recordsAndLogs "4. Persists execution transcript and changes evidence"
    autoLayout lr
}

dynamic code60 "flow-lan-pairing" "Web Server (Beta) private-LAN pairing from a trusted secondary device." {
    developer -> code60.browserSpa "1. Enables Web Server (Beta) on localhost and requests 60s code"
    code60.browserSpa -> code60.gateway "2. Activates RFC1918 IPv4 listener and generates 6-digit code"
    lanUser -> code60.browserSpa "3. Opens LAN URL and enters single-use pairing code"
    code60.browserSpa -> code60.gateway "4. Exchanges code at POST /api/pair for LAN-scoped session"
    autoLayout lr
}
