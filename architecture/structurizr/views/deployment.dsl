deployment code60 "NativeHost" "deploy-native" "Native macOS arm64 (launchd) and Linux x64 (systemd --user) host deployment." {
    include *
    autoLayout lr
}

deployment code60 "DockerContainer" "deploy-docker" "Containerized Linux x64 Docker deployment (mjholliday/code60 on port 6060)." {
    include *
    autoLayout lr
}
