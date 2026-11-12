# Contracts

`src/contracts` holds browser-safe schemas and values shared by core, agents, and bridge.

- Depend only on Zod. Do not import other application modules, Node.js, Electron, or React.
- Keep side effects and I/O out of schemas. Use `parseValue` for concise errors and CSP-safe parsing.
- Preserve input limits and strict IPC field rejection. Do not coerce untrusted values.
- Keep bundled tactics versioned, browser-safe and side-effect-free. Compose shared
  instructions once for both preview and trusted main-process delivery. Roles and
  iteration limits are guidance, never runtime guarantees or extra permissions.
- Diagnostic schemas accept versioned records with fixed event messages and bounded,
  allowlisted metadata only, never free-form content or raw errors. Keep query
  conditions bounded and reject unknown fields and filesystem paths. Initialize
  Zod jitless parsing before schema construction in directly re-exported modules.

- Worker tools require Git readiness and an initial commit. Context reports prerequisites; direct users to Chat setup and wait for explicit continuation. No agent-accessible initialization or commit tool.
