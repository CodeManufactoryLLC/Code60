# Platform

Node-only leaf module for native process ownership, executable resolution, path
identity and private storage. Import no application modules or Electron. Export
through `index.ts`. Bridge, renderer and contracts must never import this module.

- Never use blanket `shell: true`, negative PIDs on Windows, or unverified PID kills.
- Windows agents must enter a kill-on-close Job Object before any agent code runs.
- Keep helper control separate from ACP and enforce finite startup/cleanup deadlines.
- Preserve POSIX process groups and grace periods.
- Fail closed when native identity, privacy or file containment cannot be verified.
- Use the diagnostic utility for best-effort credential redaction before clipping errors and bounded stderr. It is not a transcript scrubber or a PII anonymizer.
