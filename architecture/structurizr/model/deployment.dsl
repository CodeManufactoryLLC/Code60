# Deployment Environment 1: Native macOS arm64 / Linux x64 Host
deploymentEnvironment "NativeHost" {
    deploymentNode "Developer Machine" "macOS arm64 or Linux x64 (Node 24)." "macOS / Linux" {
        deploymentNode "Local Browser" "http://127.0.0.1:<port>" "Web Browser" {
            containerInstance code60.browserSpa
        }
        deploymentNode "Local Terminal" "~/.local/bin/code60" "zsh / bash" {
            containerInstance code60.managementCli
        }
        deploymentNode "Login Service" "launchd or systemd --user." "Node 24" {
            containerInstance code60.gateway
            containerInstance code60.mcpSidecar
            containerInstance code60.mcpAdapter
            containerInstance code60.ragWorker
            containerInstance code60.memoryWorker
            containerInstance code60.credentialHelper
            containerInstance code60.ptyHelper
        }
        deploymentNode "Private Local Storage" "Mode 0700/0600 XDG directories." "APFS / ext4" {
            containerInstance code60.projectDb
            containerInstance code60.memoryDb
            containerInstance code60.opsStores
            containerInstance code60.recordsAndLogs
            containerInstance code60.configAndMcpState
            containerInstance code60.embeddingModel
        }
    }
    deploymentNode "Trusted LAN Device" "Optional Web Server (Beta) browser." "Web Browser" {
        containerInstance code60.browserSpa
    }
}

# Deployment Environment 2: Docker Container (mjholliday/code60)
deploymentEnvironment "DockerContainer" {
    deploymentNode "Docker Host" "Publishes 127.0.0.1:6060:6060." "macOS / Linux" {
        deploymentNode "Host Browser" "http://127.0.0.1:6060" "Web Browser" {
            containerInstance code60.browserSpa
        }
        deploymentNode "Container: mjholliday/code60" "Debian 12 + Node 24.22.0 + tini." "Docker (linux/amd64)" {
            containerInstance code60.gateway
            containerInstance code60.managementCli
            containerInstance code60.mcpSidecar
            containerInstance code60.mcpAdapter
            containerInstance code60.ragWorker
            containerInstance code60.memoryWorker
            containerInstance code60.ptyHelper
            containerInstance code60.embeddingModel
        }
        deploymentNode "Volume: code60-home" "Persistent /home/node state." "Docker Volume" {
            containerInstance code60.projectDb
            containerInstance code60.memoryDb
            containerInstance code60.opsStores
            containerInstance code60.recordsAndLogs
            containerInstance code60.configAndMcpState
        }
    }
}
