# Persons (Actors)
developer = person "Developer / Local Operator" "Runs Code60 locally via browser on 127.0.0.1, manages lifecycle via the code60 CLI, and approves confirmations and permissions." "Person"
lanUser = person "LAN Paired User" "Accesses Code60 Web Server (Beta) over a trusted private RFC1918 LAN using a 60-second single-use pairing code." "Person,LAN"

# External Systems
acpProviders = softwareSystem "ACP Coding-Agent Harnesses" "External ACP CLI harnesses (Antigravity, Claude, Codex, Copilot, Droid, Kiro, OpenCode, or custom overrides) and their upstream LLM and auth clouds." "External"
externalMcp = softwareSystem "External MCP Servers & OAuth IdPs" "User- or project-configured stdio and Streamable HTTP MCP servers plus OAuth 2.1/PKCE identity providers." "External"
chromeBrowser = softwareSystem "Chrome / Chromium (Playwright MCP)" "Browser automated per live conversation via pinned @playwright/mcp@0.0.84 in headless, visible isolated, or extension mode." "External"
osSupervisor = softwareSystem "OS Service Supervisor" "macOS launchd (LaunchAgent) or Linux systemd --user managing the opt-in per-user Code60 backend login service." "External"
osSecretStore = softwareSystem "OS Secret Store" "macOS Keychain or Linux Secret Service (D-Bus) persisting MCP credentials and OAuth tokens." "External"
localGit = softwareSystem "Local Git & Workspaces" "Host Git repositories, worktrees, and workspace directories constrained to locally configured roots." "External"
registries = softwareSystem "Package & Release Registries" "npm Registry, GitHub Releases, provider artifact CDNs, and Docker Hub (mjholliday/code60)." "External"
