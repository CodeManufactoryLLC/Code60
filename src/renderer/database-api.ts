import type { ApplicationClient } from "../bridge/index.js";

/** Retained views keep this captured epoch, including across native pickers. */
export function bindDatabaseWrites(
  api: ApplicationClient,
  databaseEpoch: number | undefined,
): ApplicationClient {
  if (databaseEpoch === undefined) return api;
  return {
    ...api,
    connectDatabase: (mode) => api.connectDatabase(mode, databaseEpoch),
    chooseFolder: () => api.chooseFolder(databaseEpoch),
    openProject: (path) => api.openProject(path, databaseEpoch),
    removeProject: (path) => api.removeProject(path, databaseEpoch),
    clearProjects: () => api.clearProjects(databaseEpoch),
    saveConfiguration: (request) => api.saveConfiguration(request, databaseEpoch),
    deleteConfiguration: (id) => api.deleteConfiguration(id, databaseEpoch),
    saveCommand: (request) => api.saveCommand(request, databaseEpoch),
    deleteCommand: (request) => api.deleteCommand(request, databaseEpoch),
    savePromptTemplate: (request) => api.savePromptTemplate(request, databaseEpoch),
    resetPromptTemplate: (id) => api.resetPromptTemplate(id, databaseEpoch),
  };
}
