// Node-only installation and bootstrap ports. Gateway-dependent setup stays in the installed CLI.
export {
  type InstallationOptions,
  installManagedRelease,
} from "./installation.js";
export { readRemovalState } from "./removal-state.js";
export { finishManagedRemoval, prepareManagedRemoval } from "./removal-support.js";
export { checkSetup, launchSetup } from "./setup-input.js";
export {
  applyShellIntegration,
  planShellIntegration,
} from "./shell-integration.js";
export { applyShellRemoval, planShellRemoval } from "./shell-removal.js";
export { planManagedRemoval } from "./uninstall-plan.js";
