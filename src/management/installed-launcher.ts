import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readActivation, readInstallation, verifyBoundNode } from "./install-state.js";

export async function runInstalledCommand(activationDirectory: string, args: readonly string[]) {
  const root = dirname(dirname(activationDirectory));
  // The private root receipt determines all other paths; never consult cwd or npm's cache.
  const { installationSnapshot } = await import("../platform/index.js");
  const raw = await installationSnapshot(join(root, "installation.json"), 16_384, true);
  if (!raw) throw new Error("Installation receipt is missing");
  const header = JSON.parse(raw.text) as { home: string; bin: string; launcher: string };
  const record = await readInstallation({
    root,
    home: header.home,
    bin: header.bin,
    launcher: header.launcher,
  });
  if (!record) throw new Error("Installation receipt is missing");
  const receipt = await readActivation(
    record,
    `activations/${activationDirectory.split("/").at(-1)}`,
  );
  await verifyBoundNode(receipt);
  const api = (await import(
    pathToFileURL(join(receipt.release.path, "dist/management/cli.js")).href
  )) as { runManagement(args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> };
  await api.runManagement(args, process.env);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runInstalledCommand(
    dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
    process.argv.slice(2),
  ).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Managed launcher failed"}\n`);
    process.exitCode = 1;
  });
}
