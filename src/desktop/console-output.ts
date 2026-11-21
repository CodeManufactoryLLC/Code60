import { guardOptionalOutput } from "../platform/index.js";

// Install before desktop dependencies can log. Console output is optional for the
// GUI, unlike the MCP stdio protocol, agent pipes and persisted diagnostics.
guardOptionalOutput(process.stdout);
guardOptionalOutput(process.stderr);
