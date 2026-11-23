# Contracts

- Browser requests have fixed action-specific fields and exactly Headless,
  Visible and Existing Browser modes. Describe lazy startup, connection/state loss
  on switching, external effects and runtime prerequisites in the tool/catalog.
  No browser request accepts executable, environment or endpoint overrides.

`src/contracts` holds browser-safe schemas and values shared by core, agents, and bridge.

- Production contracts depend only on Zod. Colocated unit tests may import
  Vitest; other module and browser-safety boundaries still apply to those tests.
  Do not import other application modules, Node.js, Electron, or React.
- Keep side effects and I/O out of schemas. Use `parseValue` for concise errors and CSP-safe parsing.
- MCP connector documents are versioned, bounded, browser-safe data, not browser
  launch requests. Use `parseMcpConnectorDocument` for fixed credential-safe
  errors. They are not wired to active config loading in phase 1. Credential
  references are local bindings, never secret values or execution authority.
- Phase 2 text validation shares that schema, rejects decoded duplicate keys and
  bounds bytes/depth/nodes/issues. Report fixed errors, scrubbed paths and UTF-16
  locations; never parser excerpts or arbitrary keys. Do not rewrite valid text or
  silently replace malformed encoding. No new browser operation is introduced.
- Preserve input limits and strict IPC field rejection. Do not coerce untrusted values.
- Keep bundled tactics versioned, browser-safe and side-effect-free. Compose shared
  instructions once for both preview and trusted main-process delivery. Roles and
  iteration limits are guidance, never runtime guarantees or extra permissions.
- Diagnostic schemas accept versioned records with fixed event messages and bounded,
  allowlisted metadata only, never free-form content or raw errors. Keep query
  conditions bounded and reject unknown fields and filesystem paths. Initialize
  Zod jitless parsing before schema construction in directly re-exported modules.

- Worker tools require Git readiness and an initial commit. Context reports prerequisites; direct users to Chat setup and wait for explicit continuation. No agent-accessible initialization or commit tool.
- Relay-only dispatch may require an explicit bounded absolute cwd and direct/worktree
  mode; project dispatch still rejects directories and requires Git isolation.
  Shared identities and history-window policies remain browser-safe, strict and
  free of I/O. No executable/environment fields are permitted.
- The self-knowledge catalog in `knowledge.ts` must classify every page, settings
  section and MCP tool. Update descriptors with any capability-affecting change,
  then run `npm run generate:capabilities`; never hand-edit `docs/capabilities.md`.
  Catalog text describes product behavior; it is never authority or instructions.


## Providers

Follow the Providers navigation and management section of `ARCHITECTURE.md`.
Providers replaces the Agents settings destination. Preserve v1 verified membership,
model defaults, histories and external logins. Set-primary/disconnect are strict
human-only bridge actions, guarded in main against active desktop work, setup and
overlapping writes. The primary must be replaced before disconnecting. Publish
main-owned blocking reasons; keep sidebar/gallery/details state and actions aligned.


## Transmission prototype

Transmission workflow/drafting contracts are strict and browser-safe. Preserve staging.18 and staging.20 engine ownership, task indices and cursors, bounded evidence and separate draft versus execution authority.
