dynamic code60 "flow-browser-session" "Browser auth, controller lease, and SSE." {
    developer -> code60.browserSpa "1. Opens localhost UI"
    code60.browserSpa -> code60.gateway "2. Connects and takes control"
    code60.browserSpa -> code60.gateway "3. Opens SSE and sends RPCs"
    code60.gateway -> code60.projectDb "4. Reads/writes workspace"
    autoLayout lr
}

dynamic code60 "flow-agent-orchestration" "Prompt dispatch, worktree, and MCP sidecar." {
    code60.browserSpa -> code60.gateway "1. Sends prompt / accepts plan"
    code60.gateway -> localGit "2. Creates worktree + snapshot"
    code60.gateway -> acpProviders "3. Runs ACP session"
    acpProviders -> code60.mcpSidecar "4. Calls code60_* tools"
    code60.mcpSidecar -> code60.gateway "5. POST /v1/call (Bearer)"
    code60.gateway -> code60.recordsAndLogs "6. Appends events.jsonl"
    autoLayout lr
}

dynamic code60 "flow-mcp-oauth" "External MCP OAuth and capability-leased adapter." {
    developer -> code60.browserSpa "1. Starts OAuth sign-in"
    code60.browserSpa -> code60.gateway "2. Opens loopback callback"
    developer -> externalMcp "3. Approves PKCE consent"
    code60.gateway -> code60.credentialHelper "4. Sends token via stdin"
    code60.credentialHelper -> osSecretStore "5. Saves secret"
    acpProviders -> code60.mcpAdapter "6. Calls external MCP tool"
    code60.mcpAdapter -> code60.gateway "7. Proxies over leased broker"
    code60.gateway -> externalMcp "8. Calls upstream with token"
    autoLayout lr
}

dynamic code60 "flow-cli-lifecycle" "CLI setup, update, or state-preserving uninstall." {
    developer -> code60.managementCli "1. Runs setup/update/uninstall"
    code60.managementCli -> registries "2. Verifies SHA-256 payload"
    code60.managementCli -> code60.gateway "3. Checks idle / shuts down"
    code60.managementCli -> osSupervisor "4. Registers/stops service"
    code60.managementCli -> code60.configAndMcpState "5. Writes activation receipt"
    autoLayout lr
}

dynamic code60 "flow-scheduled-job" "In-process scheduler executing recurring jobs." {
    code60.gateway -> code60.opsStores "1. Polls jobs and locks lane"
    code60.gateway -> localGit "2. Branches isolated worktree"
    code60.gateway -> acpProviders "3. Runs headless ACP turn"
    code60.gateway -> code60.recordsAndLogs "4. Persists transcript"
    autoLayout lr
}

dynamic code60 "flow-lan-pairing" "Web Server (Beta) private-LAN pairing." {
    developer -> code60.browserSpa "1. Enables LAN & creates code"
    code60.browserSpa -> code60.gateway "2. Binds RFC1918 + 60s code"
    lanUser -> code60.browserSpa "3. Opens LAN URL + enters code"
    code60.browserSpa -> code60.gateway "4. Exchanges code at /api/pair"
    autoLayout lr
}
