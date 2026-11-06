# Contracts

`src/contracts` holds browser-safe schemas and values shared by core, agents, and bridge.

- Depend only on Zod. Do not import other application modules, Node.js, Electron, or React.
- Keep side effects and I/O out of schemas. Use `parseValue` for concise errors and CSP-safe parsing.
- Preserve input limits and strict IPC field rejection. Do not coerce untrusted values.
