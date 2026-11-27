---
id: KB-REF-006
title: "Capabilities: Providers and Network Access"
domain: reference
kind: reference
status: active
summary: Generated capability specs for catalog coding-agent providers and Web Server (Beta) private-LAN access.
updated: 2026-11-27
code_refs:
  - src/contracts/knowledge.ts
  - src/contracts/navigation.ts
tags:
  - capabilities
  - providers
  - lan
  - reference
---

# Capabilities: Providers and Network Access

Generated from `src/contracts/knowledge.ts`. Do not edit by hand; run `npm run generate:capabilities`.

Schema version: 1

## Providers

- ID: `providers`
- Status: shipped
- Purpose: Verify and choose coding-agent providers; inspect and clear saved per-connector orchestrator and worker model defaults.
- Access: Connect → Providers → More actions beside a provider → Disconnect or Set as Primary
- Prerequisite: none
- Agent access: read
- Confirmation: Installation and login are explicit human-only setup actions. Install [provider] and sign in authorizes the fixed release installation and continuation into browser login; authorization happens on the official provider website.
- Limits: Database-independent. Add Provider verifies catalog connectors. After connection, choose Close or Add another provider. Standard Codex setup offers explicit installation of pinned @openai/codex@0.171.0 and device-code sign-in. A non-root backend user is required; Codex and the Claude ACP adapter require npm. The controlling setup dialog alone receives temporary codes and official HTTPS sign-in links; authorization-code paste-back and the fixed Copilot private-file storage confirmation are ephemeral. Login requires enabled ChatGPT device-code authentication, then a fresh ACP probe and automatic save. Closing, reload, takeover or shutdown cancels setup without logout. Other standard harnesses offer fixed pinned installations and browser sign-in: Antigravity with code paste-back, Claude subscription or Anthropic Console with code paste-back, Copilot and Kiro device codes, Droid device pairing, and OpenCode ChatGPT or GitHub Copilot OAuth. Custom launch commands and enterprise endpoints use manual setup. Credentials and managed tools persist in the backend user's home, including the container home volume. No account switching, logout, API-key entry or management MCP tools. Set as Primary preserves other memberships and uses saved command verification; Disconnect removes only Code60 membership and retains model defaults, history and external login. Both actions require stopped interactive agent work and no setup transaction. The primary cannot disconnect until another provider is primary. Verified membership is not live connection health.
- Pages: `providers`
- Settings sections: none
- Tools: none

## Web Server (Beta)

- ID: `web-server`
- Status: shipped
- Purpose: Enable paired access to Code60 from another device on the same trusted LAN.
- Access: Experiments → Web Server (Beta)
- Prerequisite: none
- Agent access: human-only
- Confirmation: Turning the switch on explicitly enables trusted-LAN access. Pair each remote browser using six digits displayed as 123-456 (the hyphen is optional when entering it); take control explicitly. Server administration is localhost-only. Before provider setup, close the setup dialog and choose Web Server (Beta) on the start screen.
- Limits: Off by default; remembers the enabled preference. Uses the current primary private IPv4 address and existing application port. Only the controlling localhost browser can toggle access or create single-use 60-second pairing codes; LAN always requires pairing, with ten attempts per minute. Paired devices use the full app with explicit single-browser control takeover. Disabling, address changes and backend restart revoke LAN sessions; approved work continues. HTTP is not encrypted. Native execution and the dev-container start launcher are supported; ordinary containers without the host controller report unavailable. LAN serves bundled assets without Vite/HMR or source maps. No custom ports, TLS, public hosting, router/firewall changes, passwords or separate service. Codes are private responses, never snapshots, diagnostics or saved storage.
- Pages: `web-server`
- Settings sections: none
- Tools: none
