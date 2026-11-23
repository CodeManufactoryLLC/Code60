# Gateway

Own one application host and scheduler. Depend on application, automation, bridge, contracts, core, platform and agents through indexes. Bind only authenticated loopback HTTP; never expose generic commands or paths. Private management authentication is separate from browser sessions. Revoke page interactions on detach and never replay uncertain effects. Preserve cleanup ownership on failure.

MCP connector phase 1 defines contracts and protocol fixtures only. The target
composition injects agents-owned transports into application through a narrow
port; gateway owns any private loopback listener. No connector management routes
or production runtime are enabled yet. Never expose adapter capabilities or
upstream credentials to browser pages.

Pairing codes are optional and off by default. Direct entry still requires a
same-origin JSON handshake and per-tab tokens; never remove auth checks from
application operations or events. Only private local management can change pairing
policy. Changes revoke page sessions/decisions, not approved work.

Explicit ports are a Node-only development option requiring development assets.
Production keeps allocated loopback ports; forwarded development access must use
the exact gateway origin. Never loosen Host/Origin validation for container access.
