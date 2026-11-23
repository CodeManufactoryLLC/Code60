export const bootstrapAdapter = `import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { acquirePayload } from "./acquire.mjs";
import { platform } from "./descriptor.mjs";
import { installManagedRelease, checkSetup, launchSetup } from "./runtime/management/index.js";
export { planShellIntegration, applyShellIntegration } from "./runtime/management/index.js";
const descriptors = JSON.parse(await readFile(new URL("../platforms.json", import.meta.url), "utf8"));
export function stagePayload(options) { return acquirePayload(descriptors[platform()], options); }
export function installPayload(options = {}) {
  const identity = descriptors[platform()];
  return installManagedRelease({ ...options,
    artifact: { identity, acquire: (request) => stagePayload({ ...options.acquisition, ...request }) },
    bootstrapEntry: fileURLToPath(new URL("../bin/code60.mjs", import.meta.url)),
    runtimeDirectory: fileURLToPath(new URL("./runtime/", import.meta.url)) });
}
export async function setupPayload(options = {}) {
  const args = options.args ?? [];
  const env = options.env ?? process.env;
  await checkSetup(args, env, options.signal);
  const installed = await installPayload(options);
  return launchSetup(installed.launcher, ["setup", ...args], env, options.signal);
}
`;
