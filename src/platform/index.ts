export { resolveCommand } from "./command.js";
export { DiagnosticTail, diagnosticMessage, diagnosticText } from "./diagnostics.js";
export { environmentValue, mergeSearchPath, setEnvironmentPath, userHome } from "./environment.js";
export { isPrivateIPv4, primaryPrivateIPv4 } from "./lan-address.js";
export { containedPath, samePath } from "./paths.js";
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
  controlUserService,
  inspectUserService,
  type ServiceRuntime,
  userServiceDefinition,
} from "./user-service.js";
