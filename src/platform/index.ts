export { resolveCommand } from "./command.js";
export type { CredentialStorePort } from "./credential-protocol.js";
export { nativeCredentialStore } from "./credential-store.js";
export { DiagnosticTail, diagnosticMessage, diagnosticText } from "./diagnostics.js";
export { environmentValue, mergeSearchPath, setEnvironmentPath, userHome } from "./environment.js";
export {
  bindGuardedTarget,
  captureGuardedRoot,
  discardGuardedStage,
  GuardedFileError,
  type GuardedFileIo,
  type GuardedSnapshot,
  type GuardedTarget,
  guardedFileRevision,
  publishGuardedFile,
  readGuardedFile,
  stageGuardedFile,
  syncGuardedDirectory,
} from "./guarded-file.js";
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
  removeOwnedInstallationFile,
  syncInstallationDirectory,
  verifyInstallationNode,
  writeInstallationFile,
} from "./installation-files.js";
export { installationPrerequisite, runInstallationCommand } from "./installation-process.js";
export { isPrivateIPv4, primaryPrivateIPv4 } from "./lan-address.js";
export {
  type GuardedNetworkOptions,
  guardedFetch,
  registerPrivateListener,
} from "./network-policy.js";
export { containedPath, samePath } from "./paths.js";
export { acquirePayload, type PayloadTransport } from "./payload-acquire.mjs";
export { extractArchive as extractPayloadArchive } from "./payload-archive.mjs";
export {
  descriptor as parsePayloadDescriptor,
  descriptorPair as parsePayloadDescriptors,
  type PayloadDescriptor,
  platform as payloadPlatform,
} from "./payload-descriptor.mjs";
export {
  fileCode,
  lockPrivateState,
  readPrivateJson,
  verifyPrivatePath,
  writePrivateJson,
} from "./private-state.js";
export { type OwnedProcess, spawnOwnedProcess } from "./process.js";
export {
  appendPrivateFile,
  atomicReplace,
  createPrivateDirectory,
  createPrivateFileSync,
  privateDirectory,
  privateDirectorySync,
  renameFile,
  verifyPrivateSync,
  writePrivateFile,
} from "./storage.js";
export { assertSupportedPlatform } from "./support.js";
export {
  installedEngineVersions,
  preserveTransmissionBundle,
  resolveTransmissionRuntime,
  workflowHostSupported,
} from "./transmission-bundle.js";
export {
  newerStableRelease,
  readStableBootstrap,
  registryTransport,
  type StableBootstrap,
} from "./update-registry.js";
export {
  controlUserService,
  inspectUserService,
  type ServiceRuntime,
  userServiceDefinition,
  userServiceSnapshot,
} from "./user-service.js";
