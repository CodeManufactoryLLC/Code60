// Internal installer API only. No public setup/service behavior is introduced here.
export {
  type InstallationOptions,
  installManagedRelease,
} from "./installation.js";
export {
  applyShellIntegration,
  planShellIntegration,
} from "./shell-integration.js";
