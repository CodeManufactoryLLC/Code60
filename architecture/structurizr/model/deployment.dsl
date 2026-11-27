# Deployment Environment 1: Native macOS arm64 / Linux x64 Host
deploymentEnvironment "NativeHost" {
    deploymentNode "Developer Machine (macOS arm64 / Linux x64)" "User workstation with Node.js 24 (>=24.22.0 <25), Git, and launchd or systemd --user." "macOS / Linux" {
        deploymentNode "Local Web Browser" "Desktop browser accessing http://127.0.0.1:<ephemeral-port>" "Chromium / Safari / Firefox" {
            containerInstance code60.browserSpa
        }
        deploymentNode "User Terminal" "Interactive shell invoking ~/.local/bin/code60" "zsh / bash" {
            containerInstance code60.managementCli
        }
        deploymentNode "Per-User Login Service (launchd / systemd --user)" "Opt-in Node.js 24 service managed by OS supervisor" "Node.js 24" {
            containerInstance code60.gateway
            containerInstance code60.mcpSidecar
            containerInstance code60.mcpAdapter
            containerInstance code60.ragWorker
            containerInstance code60.memoryWorker
            containerInstance code60.credentialHelper
            containerInstance code60.ptyHelper
        }
        deploymentNode "Private Local Storage ($XDG_DATA_HOME / $XDG_STATE_HOME / $XDG_CONFIG_HOME)" "Mode 0700/0600 user-owned directories and local SQLite databases" "APFS / ext4" {
            containerInstance code60.projectDb
            containerInstance code60.memoryDb
            containerInstance code60.opsStores
            containerInstance code60.recordsAndLogs
            containerInstance code60.configAndMcpState
            containerInstance code60.embeddingModel
        }
    }
    deploymentNode "Trusted Private LAN Device (Optional Web Server Beta)" "Secondary browser on same RFC1918 LAN pairing via 60s 6-digit code" "Web Browser" {
        containerInstance code60.browserSpa
    }
}

# Deployment Environment 2: Docker Container (mjholliday/code60)
deploymentEnvironment "DockerContainer" {
    deploymentNode "Docker Host" "Host machine running Docker Engine with loopback port publishing 127.0.0.1:6060:6060" "macOS / Linux" {
        deploymentNode "Host Web Browser" "Accesses http://127.0.0.1:6060" "Web Browser" {
            containerInstance code60.browserSpa
        }
        deploymentNode "Container: mjholliday/code60 (linux/amd64)" "Debian 12 slim + Node 24.22.0 under /usr/bin/tini; non-root user node; CODE60_PORT=6060" "Docker (glibc + libgomp1)" {
            containerInstance code60.gateway
            containerInstance code60.managementCli
            containerInstance code60.mcpSidecar
            containerInstance code60.mcpAdapter
            containerInstance code60.ragWorker
            containerInstance code60.memoryWorker
            containerInstance code60.ptyHelper
            containerInstance code60.embeddingModel
        }
        deploymentNode "Named Volume (code60-home -> /home/node)" "Persistent databases, Relay state, MCP configs, and provider logins" "Docker Volume" {
            containerInstance code60.projectDb
            containerInstance code60.memoryDb
            containerInstance code60.opsStores
            containerInstance code60.recordsAndLogs
            containerInstance code60.configAndMcpState
        }
    }
}
