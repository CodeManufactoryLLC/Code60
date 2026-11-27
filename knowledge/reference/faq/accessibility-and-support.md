---
id: KB-REF-017
title: "FAQ: Accessibility, Architecture, and Support"
domain: reference
kind: reference
status: active
summary: Frequently asked questions on accessibility support, programming languages, bug reports, security disclosures, and feature requests.
updated: 2026-11-27
code_refs:
  - src/renderer/app.tsx
  - package.json
related:
  - KB-ARCH-001
  - KB-REF-012
tags:
  - faq
  - accessibility
  - support
---

# FAQ: Accessibility, Architecture, and Support

> **Applies to:** Code60 `v0.5.0-beta` · **Last update:** `2026-11-27`
> Open **Manage → About** or run `code60 status` to check the local Code60 version.

## Accessibility

### Is Code60 accessible?

Code60 includes broad keyboard, screen-reader, contrast, and motion accessibility support, though formal accessibility certification remains future work on the [Code60 roadmap](https://github.com/CodeManufactoryLLC/code60/issues/79).

- **Keyboard and focus:** Code60 uses IBM Carbon Design System components and includes a **Skip to main content** link. Menus, tables, trees, dialogs, and the command palette (`Cmd+K` or `Ctrl+K`) support full keyboard navigation. Closing overlays restores focus to the trigger control.
- **Screen readers and status cues:** Controls include accessible labels, Accessible Rich Internet Applications (ARIA) states, and polite or alert status announcements. Status indicators include text labels alongside color.
- **Themes, text, and system preferences:** **Personalize** settings offer **Light**, **Dark**, and **System** themes, a customizable accent color, adjustable interface text size, and optional signal colors. The interface also respects operating-system `forced-colors` (high-contrast) and `prefers-reduced-motion` settings by switching to system colors and turning off animations.
- **Current compliance status:** Code60 makes no formal Web Content Accessibility Guidelines (WCAG) compliance claim today. Full accessibility readiness sits under the `v0.12.0` milestone in the [Code60 roadmap](https://github.com/CodeManufactoryLLC/code60/issues/79).

## Architecture and Development

### What programming language does Code60 use?

Code60 uses **TypeScript** for both Code60 Gateway (its local Node.js 24 backend) and its React browser interface.

- **Application code:** Core logic, gateway services, management commands, and the React user interface use TypeScript (`.ts`, `.tsx`, and `.mts`).
- **Styling and markup:** The browser interface uses Cascading Style Sheets (CSS), Sass (`SCSS`), and HyperText Markup Language (HTML) with IBM Carbon Design System styles.
- **Tooling and packaging:** Build, validation, and distribution scripts use JavaScript modules (`.mjs`) running on Node.js 24.

## Support and Feedback

### How do I report a bug?

Search existing issues first, then open the **Bug report** form on [GitHub Issues](https://github.com/CodeManufactoryLLC/code60/issues/new/choose).

- **Details to include:** Include the Code60 version or commit SHA, operating system, architecture, actual versus target behavior, and minimal reproduction steps.
- **Privacy checks:** Remove credentials, private prompts, repository content, and personal data from logs and screenshots before posting. Never attach whole run directories, raw transcripts, or private MCP journals and backups.
- **MCP reports:** For MCP problems, review and copy the opt-in safe troubleshooting report under **Connect → MCP Servers**.

### How do I report a security vulnerability?

Email **[support@code60.dev](mailto:support@code60.dev)** privately. Do not open a public issue or publish exploit details before coordinating disclosure.

- **Details to include:** Share the Code60 version, platform, reproduction steps, potential impact, and a minimal example without credentials, private prompts, or sensitive data. Only the latest release receives security fixes.
- **Response target:** Maintainers aim to acknowledge reports within five business days before reviewing and coordinating fixes. That five-day window is a response target and does not guarantee a fix date. See [Reporting a vulnerability](../../../SECURITY.md#52-reporting-a-vulnerability).

### How do I request a feature?

Search existing issues first, then open the **Feature request** form on [GitHub Issues](https://github.com/CodeManufactoryLLC/code60/issues/new/choose).

- **Focus on the problem:** Describe the user problem before suggesting an implementation. Include the target behavior, observable acceptance criteria (such as error states and accessibility), and scope boundaries.
- **Review and other forms:** Maintainers check proposals against [ARCHITECTURE.md](../../../ARCHITECTURE.md) and [CONSTITUTION.md](../../../CONSTITUTION.md) before scheduling work. Use the **Maintenance** form for tooling, documentation, dependency, or refactoring proposals.
