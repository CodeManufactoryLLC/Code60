#!/usr/bin/env node
import { runManagement } from "./cli.js";

runManagement(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Code60 management failed."}\n`);
  process.exitCode = 1;
});
