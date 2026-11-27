# Persons (Actors)
developer = person "Developer" "Uses local browser UI and code60 CLI." "Person"
lanUser = person "LAN User" "Paired private-LAN browser user." "Person,LAN"

# External Systems
acpProviders = softwareSystem "ACP Agent Harnesses" "External coding-agent CLIs and LLM clouds." "External"
externalMcp = softwareSystem "External MCP Servers" "User/project stdio, HTTP, and OAuth servers." "External"
chromeBrowser = softwareSystem "Chrome (Playwright)" "Automated browser via Playwright MCP." "External"
osSupervisor = softwareSystem "OS Service Supervisor" "macOS launchd or Linux systemd --user." "External"
osSecretStore = softwareSystem "OS Secret Store" "macOS Keychain or Linux Secret Service." "External"
localGit = softwareSystem "Local Git & Workspaces" "Host repositories and approved folders." "External"
registries = softwareSystem "Package Registries" "npm, GitHub Releases, CDNs, Docker Hub." "External"
