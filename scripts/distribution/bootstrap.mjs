#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const args = process.argv.slice(2);
if (args.length === 1 && ["--version", "-v"].includes(args[0])) console.log(manifest.version);
else if (!args.length || (args.length === 1 && ["--help", "-h"].includes(args[0])))
  console.log(
    "Code60 distribution bootstrap\nUsage: code60 --help | --version\nInstallation commands are not available in this artifact yet.",
  );
else {
  console.error(
    "Installation commands are not available in this bootstrap yet. Use --help for supported options.",
  );
  process.exitCode = 1;
}
