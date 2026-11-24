# Code60 terminology

Use these names in the UI, CLI, documentation, and code reviews.

| Term | Meaning |
| --- | --- |
| **Code60 Gateway** | The per-user Node.js process that serves the React app and its API, hosts interactive work, and runs the scheduler. Use **the Gateway** after first mention. Closing a browser tab leaves approved work running. Stopping the Gateway stops interactive agents and scheduled work. Approved Transmission workflows have their own engine and can continue. |
| **`gateway` module** | The source module that starts the Code60 Gateway, authenticates clients, and connects browser and management requests to application operations. |
| **`ApplicationHost`** | The object in the `application` module that owns interactive application state and coordinates projects, conversations, and agent execution inside the Gateway. |
| **Scheduler runtime** | The component in the `automation` module that schedules jobs and manages their execution inside the Gateway. Jobs can be paused while the Gateway runs. |
| **Session-scoped agent gateway** | An interface through which an agent session receives its authorized tools. Its authority ends with the owning session. Qualify the term with its scope, such as “Relay’s MCP gateway.” |

Manage the Gateway with `code60 service`. Its macOS launchd label is `com.codemanufactory.code60.gateway`, and its Linux systemd user unit is `code60-gateway.service`. The `gateway` field in `code60 status` describes the service. See [Gateway management](README.md#gateway-management) and the [runtime architecture](ARCHITECTURE.md#browser-runtime).
