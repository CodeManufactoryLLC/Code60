/** Node-only platform entry point selected by the bootstrap distribution build. */
export { userHome } from "./environment.js";
export {
  absoluteInstallationPath,
  createInstallationParents,
  exclusiveInstallationLink,
  executableInstallationFile,
  type FileIdentity,
  installationDirectory,
  installationFileCode,
  installationLink,
  installationSnapshot,
  installationTreeIdentity,
  lockInstallation,
  publishInstallationLink,
  removeInstallationTree,
  syncInstallationDirectory,
  verifyInstallationNode,
  writeInstallationFile,
} from "./installation-files.js";
export { installationPrerequisite, runInstallationCommand } from "./installation-process.js";
export {
  type InstallationRemovalInventory,
  type InstallationRemovalLink,
  inventoryInstallationRemoval,
  removeInstallationInventory,
  removeRecordedInstallationLink,
  snapshotRemovalLink,
  validateInstallationRemovalInventory,
  verifyInstallationRemovalRemainder,
} from "./installation-removal.js";
export {
  type RemovalServiceProof,
  reserveRemovedBackend,
  validateRemovalServiceProof,
} from "./installation-removal-service.js";
export { findMacRuntimeProcesses, macFileProcesses } from "./process-identity.js";
export { preserveTransmissionBundle, resolveTransmissionRuntime } from "./transmission-bundle.js";
export { newerStableRelease } from "./update-registry.js";
