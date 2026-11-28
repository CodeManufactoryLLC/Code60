---
id: KB-REF-012
title: "FAQ: Security Measures and Secrets"
domain: reference
kind: reference
status: active
summary: Frequently asked questions on Code60's browser, API, process, MCP, and packaging safeguards and how Code60 handles secrets.
updated: 2026-11-27
code_refs:
  - src/gateway/server.ts
  - src/application/mcp-gateway.ts
  - src/platform/credential-store.ts
related:
  - KB-REF-011
  - KB-OPS-006
tags:
  - faq
  - security
  - secrets
---

# FAQ: Security Measures and Secrets

> **Applies to:** Code60 `v1.0.0-alpha.1` · **Last update:** `2026-11-27`
> Open **Manage → About** or run `code60 status` to check the local Code60 version.

## Security Measures

### What security measures does Code60 take?

Code60 protects the browser interface, local API, orchestration gateway, files, processes, and credentials, while agents still run with the user's operating-system permissions. See the [Security Policy](../../../SECURITY.md) for full details.

#### Browser, local network, and API boundaries

- **Localhost interface:** Code60 Gateway listens on `127.0.0.1` by default and enforces Host, Origin, and Content Security Policy (CSP) checks. Browser tabs use per-tab session tokens, explicit **Take control** transfers, and optional `code60 pairing on` codes.
- **Web Server (Beta) limits:** Optional local-network access starts off and uses only the primary private IPv4 address. It enforces single-use 60-second pairing codes with rate limits, separates local and network sessions, serves only static release assets, and blocks management routes.
- **Narrow application API:** Code60 Gateway validates every request against a strict operation map and exposes no generic shell or filesystem interface. File choosers accept only opaque IDs inside local workspace roots, and human confirmations stay browser-only.

#### Process, filesystem, and storage safeguards

- **Process safety:** Code60 spawns subprocesses with argument arrays without a shell and checks process identity before stopping any process. Local management commands authenticate through private filesystem metadata outside browser origins.
- **Symlink and file guards:** Private configuration and state operations reject symlinks, hard links, and world-writable paths using `O_NOFOLLOW` and atomic staging. New run directories and files use private permissions (`0700` and `0600`).
- **Diagnostics and redaction:** Operational errors and `stderr` tails apply best-effort redaction for common tokens, headers, and private keys. Diagnostic logs keep only strict event metadata and exclude prompts, transcripts, paths, and secrets.

#### Orchestration, MCP, and browser-tool controls

- **Orchestration gateway:** Code60's orchestration MCP server runs behind a token check on `127.0.0.1` with size and time limits. Workers never receive Code60's orchestration tools.
- **MCP servers and network policy:** Project MCP definitions start off and require human approval for their exact revision. Stdio servers run without a shell in an allowlist environment. HTTP servers check Domain Name System (DNS) destinations, block cloud metadata addresses, and require HTTPS for credentials outside loopback.
- **MCP secrets and OAuth:** Secrets stay in macOS Keychain, Linux Secret Service, or explicit temporary memory and never reach the browser. OAuth, an open authorization protocol, enforces S256 Proof Key for Code Exchange (PKCE), exact issuer checks, and single-use five-minute callbacks.
- **Browser automation tool:** The `code60_browser` tool runs Playwright in a private context and blocks host-code execution, installation, file upload, and page WebMCP tools. Workers, helpers, and **Scheduled Jobs** do not receive it.

#### Package integrity and repository checks

- **Provider setup and updates:** In-app provider setup checks release integrity, disables npm lifecycle scripts, and accepts only exact official HTTPS login domains. Code60 updates verify SHA-512 digests and complete file inventories before replacing a release, without running registry bootstrap code.
- **Repository security scans:** Security workflows run CodeQL, lockfile dependency audits, and Gitleaks secret scans on pull requests, pushes to `main`, and a weekly schedule.

## Secret Handling

### How does Code60 handle secrets?

Code60 keeps secrets out of configuration files, browser storage, diagnostic logs, and agent tool payloads, with different boundaries for each secret type.

- **Agent Provider credentials:** Code60 never asks for provider passwords or stores provider API keys. Each **Agent Provider** keeps credentials in its own backend-user storage. Temporary device codes and OAuth links stay inside the active setup dialog and never enter snapshots, browser storage, or logs.
- **MCP secrets and OAuth:** `mcp.json` files hold credential references and contain no raw secret values. Users save secrets into macOS Keychain, Linux Secret Service, or explicit temporary **Code60 Gateway** memory (which clears on restart or sign-out). Unavailable keychains never fall back silently, and no browser endpoint can read secrets back.
- **Session and management tokens:** Browser session tokens stay in per-tab session storage outside URLs and cookies. Local CLI management tokens stay in private local files outside browser reach, and single-use pairing codes expire after 60 seconds.
- **Redaction and transcript limits:** Diagnostic logs exclude prompts, transcripts, paths, and secrets, while error messages and `stderr` tails apply best-effort credential redaction. Code60 does not encrypt or automatically scrub conversation transcripts (`events.jsonl`), so users must keep secrets out of prompts and command arguments.
