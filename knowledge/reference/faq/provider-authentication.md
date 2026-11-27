---
id: KB-REF-019
title: "FAQ: Provider Authentication"
domain: reference
kind: reference
status: active
summary: Per-provider ACP authentication steps and credential boundaries for Antigravity, Claude, Codex, Copilot, Droid, Kiro, OpenCode, and Cursor.
updated: 2026-11-27
code_refs:
  - src/application/provider-catalog.ts
  - src/application/provider-setup-policy.ts
  - src/application/provider-artifacts.ts
  - src/application/codex-provider.ts
related:
  - KB-REF-018
  - KB-REF-012
tags:
  - faq
  - providers
  - authentication
---

# FAQ: Provider Authentication

> **Applies to:** Code60 `v0.5.0-beta` · **Last update:** `2026-11-27`
> Open **Manage → About** or run `code60 status` to check the local Code60 version. See [Code60 Terminology](../../../TERMINOLOGY.md) for key terms.

## Antigravity

### How does Code60 authenticate with Antigravity?

Code60 connects to Antigravity through ACP (`agy acp`). It never asks for a Google password and never stores credentials.

- **Existing CLI:** If `agy` already exists on the machine with an active login, verify and connect it under **Connect → Providers**.
- **In-app setup:** Install a private copy of Antigravity from **Connect → Providers** and complete Google browser sign-in on `accounts.google.com`. Paste the authorization code into the setup dialog.
- **Storage and limits:** Antigravity keeps credentials in its own backend-user storage. Account switching, logout, and custom launch commands require external setup.

## Claude

### How does Code60 authenticate with Claude?

Code60 connects to Claude through ACP. It never asks for a password and never stores credentials.

- **Existing CLI:** If a Claude CLI with an active login already exists on the machine, verify and connect it under **Connect → Providers**.
- **In-app setup:** From **Connect → Providers**, install a private copy of Claude and its ACP adapter (`@agentclientprotocol/claude-agent-acp`) without overwriting existing tools. Choose **Claude subscription** or **Anthropic Console** sign-in, then complete login on `claude.ai`, `platform.claude.com`, or `console.anthropic.com`. Paste the authorization code from the browser into the setup dialog.
- **Storage and limits:** Claude keeps credentials in its own backend-user storage. Users manage API keys, account switching, logout, and custom launch commands outside Code60.

## Codex

### How does Code60 authenticate with Codex?

Code60 connects to Codex through ACP. It never asks for a ChatGPT password and never stores credentials.

- **Existing CLI:** If Codex already exists on the machine with an active login, select **Codex** under **Connect → Providers** to verify and connect it.
- **In-app installation:** Choose **Install Codex and sign in** or **Sign in to Codex**. Installation puts `@openai/codex@0.171.0` in `~/.local/share/code60/providers/codex/0.171.0` without replacing an existing CLI.
- **Device-code sign-in:** Copy the device code on screen, open `https://auth.openai.com/codex/device`, and authorize with a ChatGPT account. ChatGPT security settings must allow device-code login. Keep setup open until ACP verification finishes and shows "Connected."
- **Storage and limits:** Codex keeps credentials in its normal backend-user storage. Users manage API keys, account switching, logout, and custom launch commands outside Code60.

## Copilot

### How does Code60 authenticate with Copilot?

Code60 connects to Copilot through ACP (`copilot --acp --stdio`). It never asks for a GitHub password and never stores credentials.

- **Existing CLI:** If `copilot` already exists on the machine with an active login, verify and connect it under **Connect → Providers**.
- **In-app setup:** Install a private copy of Copilot from **Connect → Providers**. Copy the device code on screen, open `https://github.com/login/device`, authorize with GitHub, and confirm saving the login.
- **Storage and limits:** Copilot keeps credentials in its own backend-user storage. Custom hosts, account switching, logout, and custom launch commands require external setup.

## Droid

### How does Code60 authenticate with Droid?

Code60 connects to Droid through ACP (`droid exec --output-format acp`). It never asks for a password and never stores credentials.

- **Existing CLI:** If Droid already exists on the machine with an active login, verify and connect it under **Connect → Providers**.
- **In-app setup:** Install a private copy of Droid from **Connect → Providers** and complete Factory's browser device-pairing flow on `app.factory.ai`. Code60 runs an authentication-only handshake that grants no file, terminal, or tool permissions. It shows the verification link, plus a code when Factory sends one, then runs a fresh ACP check after pairing finishes.
- **Storage and limits:** Droid keeps credentials in its own backend-user storage. Custom launch commands and account management outside initial sign-in require external setup.

## Kiro

### How does Code60 authenticate with Kiro?

Code60 connects to Kiro through ACP (`kiro-cli acp`). It never asks for a password and never stores credentials.

- **Existing CLI:** If `kiro-cli` already exists on the machine with an active login, verify and connect it under **Connect → Providers**.
- **In-app setup:** Install a private copy of Kiro from **Connect → Providers** and start its browser device-code flow on `app.kiro.dev` or `view.awsapps.com`. Copy the code on screen, authorize in a browser, and wait for ACP verification to finish.
- **Storage and limits:** Kiro keeps credentials in its own backend-user storage. Organization policies may block device-code sign-in. Custom enterprise settings and custom launch commands require external setup.

## OpenCode

### How does Code60 authenticate with OpenCode?

Code60 connects to OpenCode through ACP (`opencode acp`). It never asks for passwords and never stores credentials.

- **Existing CLI:** If OpenCode already exists on the machine with model-provider credentials, verify and connect it under **Connect → Providers**. Code60 uses those credentials directly.
- **In-app setup:** Install a private copy of OpenCode from **Connect → Providers**. Sign in to **ChatGPT** (`auth.openai.com/codex/device`) or **GitHub Copilot** (`github.com/login/device`) through browser device-code OAuth, an open authorization protocol.
- **Temporary login server:** During sign-in, Code60 runs a temporary local loopback OpenCode server with a password and with external plugins off. Code60 stops that server when login finishes or stops.
- **Storage and limits:** OpenCode keeps credentials in its own backend-user storage. API keys, other model integrations, and custom launch commands require external setup.

## Cursor

### How does Code60 authenticate with Cursor?

Cursor is currently absent from Code60's standard provider catalog. That catalog covers **Antigravity, Claude, Codex, Copilot, Droid, Kiro, and OpenCode**.

Code60 offers no in-app installation or sign-in flow for custom or external ACP launch commands. Users must authenticate those tools outside Code60 through each tool's own CLI.
