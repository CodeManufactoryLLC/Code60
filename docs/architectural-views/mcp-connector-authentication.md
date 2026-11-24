# MCP Connector Authentication

## Motivation

MCP servers may need credentials or OAuth while agent providers must receive only
session capabilities. A failed secure store or lost token exchange must not cause
plaintext fallback, a replayed tool call or restored authority.

## Description

Application owns credential namespaces, private non-secret operation metadata,
registration review, PKCE, grants and serialized refresh. Platform owns a bounded
native keyring helper using private pipes and explicitly requires Secret Service on
Linux. Gateway owns single-use page-bound loopback callbacks and private listener
registration. Agents implement MCP and owning-call HTTP cancellation, with no SDK
auth helper or business replay. Contracts and renderer expose only narrow human
writes and metadata; transient secret inputs never enter configuration drafts.

Secure OS storage and explicitly accepted backend RAM are distinct choices.
Namespace heads bind canonical source/server/security definition/reference/grant;
label or enablement edits do not rebind them. Revocation precedes deletion, and
uncertain or interrupted operations cannot select an older credential version.
A dirty prior backend epoch requires fresh entry/authorization. OAuth discovery is
anonymous and destination-checked; issuer/scopes/registration are reviewed before
S256 authorization. No Code60 registration, hosted metadata or shared client ID is
provided. Phase 7 recovery presentation remains separate.

## Tradeoffs

### Pros

- Provider setup, configuration files and ordinary snapshots remain credential-free.
- Native storage failures and temporary consent are explicit; secret deletion and
  remote provider revocation have honest, independent outcomes.
- Per-grant refresh and turn cancellation preserve authority without retrying work.

### Cons

- A locked/missing OS store requires user action or explicit temporary selection.
- A crash conservatively requires fresh credentials even when the previous OS entry
  may still exist; stale entries remain owned cleanup evidence.
- Providers must support native loopback callbacks and a compatible registration;
  Code60 supplies no shared registration to remove that setup requirement.

Protocol references: [MCP authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
defines resource indicators and issuer-response checks; [the SDK redirect advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6prh-2h8m-c8cw)
identifies 1.32.0 as the fixed 1.x release (we pin 1.32.2 and also enforce our own
redirect policy). [Keyring backend selection](https://github.com/Brooooooklyn/keyring-node/blob/main/README.md#linux-backend-selection)
requires explicit Secret Service selection to prevent automatic keyutils fallback.
