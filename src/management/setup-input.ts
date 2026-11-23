import {
  absoluteInstallationPath,
  installationPrerequisite,
  runInstallationCommand,
} from "../platform/index.js";
import { installationPaths, supportedInstallationRuntime } from "./install-state.js";
export function setupFlags(args: readonly string[]) {
  if (
    new Set(args).size !== args.length ||
    args.some((arg) => !["--yes", "--no-open"].includes(arg))
  )
    throw Error("Use code60 setup [--yes] [--no-open].");
  return { yes: args.includes("--yes"), noOpen: args.includes("--no-open") };
}
export async function checkSetup(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
) {
  setupFlags(args);
  supportedInstallationRuntime();
  for (const key of ["XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CONFIG_HOME"])
    if (env[key]) absoluteInstallationPath(env[key]);
  await installationPaths(env);
  await installationPrerequisite("git", env, signal);
  await installationPrerequisite("npm", env, signal);
}
export { runInstallationCommand as launchSetup };
