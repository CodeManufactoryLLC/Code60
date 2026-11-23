#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function bootstrapMain(args, ports = {}) {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  if (args.length === 1 && ["--version", "-v"].includes(args[0])) {
    console.log(manifest.version);
    return 0;
  }
  if (!args.length || (args.length === 1 && ["--help", "-h"].includes(args[0]))) {
    console.log(
      "Code60 distribution bootstrap\nUsage: code60 setup [--yes] [--no-open] | --help | --version",
    );
    return 0;
  }
  if (
    args[0] !== "setup" ||
    new Set(args.slice(1)).size !== args.length - 1 ||
    args.slice(1).some((arg) => !["--yes", "--no-open"].includes(arg))
  )
    throw Error("Use code60 setup [--yes] [--no-open], --help or --version.");
  const api = await import(new URL("../lib/index.mjs", import.meta.url).href);
  return api.setupPayload({ ...ports, args: args.slice(1) });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  let interrupted;
  const stop = () => {
    interrupted = 130;
    controller.abort();
  };
  const terminate = () => {
    interrupted = 143;
    controller.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", terminate);
  try {
    process.exitCode = await bootstrapMain(process.argv.slice(2), { signal: controller.signal });
  } catch (error) {
    console.error(error.message);
    process.exitCode = interrupted ?? 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", terminate);
    if (interrupted) process.exitCode = interrupted;
  }
}
