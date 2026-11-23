# Gateway

Own one application host and scheduler. Depend on application, automation, bridge, contracts, core and platform through indexes. Bind only authenticated loopback HTTP; never expose generic commands or paths. Private management authentication is separate from browser sessions. Revoke page interactions on detach and never replay uncertain effects. Preserve cleanup ownership on failure.

Pairing codes are optional and off by default. Direct entry still requires a
same-origin JSON handshake and per-tab tokens; never remove auth checks from
application operations or events. Only private local management can change pairing
policy. Changes revoke page sessions/decisions, not approved work.

Explicit ports are a Node-only development option requiring development assets.
Production keeps allocated loopback ports; forwarded development access must use
the exact gateway origin. Never loosen Host/Origin validation for container access.

The private prepare-database management operation accepts no payload or browser
Origin and requires the management token. Call ApplicationHost serialization;
never initialize databases in ordinary startup or expose this route through the
browser bridge. Management status reports bounded database/engine availability
without provider probes, pairing codes or repair. Preserve XDG_DATA_HOME in the
registered runtime so setup and the backend use the same data location.
