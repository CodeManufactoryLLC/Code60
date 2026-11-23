import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import {
  type AgentSetupRecord,
  type ModelDefaultsRecord,
  type PollSettingsPatch,
  parseAgentSetupRecord,
  parseBoolean,
  parseModelDefaults,
  parseOrchestrationProvider,
  parsePollSettings,
} from "../bridge/index.js";
import {
  atomicReplace,
  type FileIdentity,
  installationSnapshot,
  privateDirectory,
  writeInstallationFile,
  writePrivateFile,
} from "../platform/index.js";

/** Remembers the selected project database between launches. */
export interface DesktopPreferences {
  modelDefaults?(): Promise<ModelDefaultsRecord>;
  setModelDefaults?(record: ModelDefaultsRecord): Promise<void>;
  agentSetup?(): Promise<AgentSetupRecord | null>;
  setAgentSetup?(record: AgentSetupRecord): Promise<void>;
  selection?(): Promise<{ path?: string; identity: FileIdentity | null }>;
  selectInitial?(database: string, previous: FileIdentity | null): Promise<void>;
  read(): Promise<string | undefined>;
  write(database: string): Promise<void>;
  polling?(): Promise<PollSettingsPatch>;
  setPolling?(settings: PollSettingsPatch): Promise<void>;
  orchestrationAutoApproval?(): Promise<boolean>;
  setOrchestrationAutoApproval?(enabled: boolean): Promise<void>;
  orchestrationProvider?(): Promise<string | null>;
  setOrchestrationProvider?(provider: string | null): Promise<void>;
}

export function filePreferences(file: string): DesktopPreferences & {
  transparent(): Promise<boolean>;
  setTransparent(enabled: boolean): Promise<void>;
  updateCheck(): Promise<boolean>;
  setUpdateCheck(enabled: boolean): Promise<void>;
  polling(): Promise<PollSettingsPatch>;
  setPolling(settings: PollSettingsPatch): Promise<void>;
  orchestrationProvider(): Promise<string | null>;
  setOrchestrationProvider(provider: string | null): Promise<void>;
} {
  async function load(strict = false): Promise<Record<string, unknown>> {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    try {
      const value: unknown = JSON.parse(text);
      if (value !== null && typeof value === "object" && !Array.isArray(value))
        return value as Record<string, unknown>;
      throw new Error("Invalid desktop preferences");
    } catch (error) {
      if (strict) throw error;
      return {};
    }
  }
  // Database and appearance writes share one queue so neither can lose the other's changes.
  let pending = Promise.resolve();
  function update(patch: Record<string, unknown>, strict = false): Promise<void> {
    const result = pending.then(async () => {
      const value = { ...(await load(strict)), ...patch };
      await privateDirectory(dirname(file));
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writePrivateFile(temporary, `${JSON.stringify(value)}\n`, {
          mode: 0o600,
          flag: "wx",
        });
        await atomicReplace(temporary, file);
      } finally {
        await rm(temporary, { force: true });
      }
    });
    pending = result.catch(() => {});
    return result;
  }
  async function selection() {
    const snapshot = await installationSnapshot(file, 1024 * 1024, true);
    const value: unknown = snapshot ? JSON.parse(snapshot.text) : {};
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid database selection metadata");
    const data = value as Record<string, unknown>;
    if (
      Object.hasOwn(data, "database") &&
      (typeof data.database !== "string" ||
        !isAbsolute(data.database) ||
        /[\0\r\n]/.test(data.database))
    )
      throw new Error("Invalid saved database selection; existing metadata preserved");
    return {
      ...(typeof data.database === "string" ? { path: data.database } : {}),
      identity: snapshot?.identity ?? null,
    };
  }
  return {
    selection,
    selectInitial(database, previous) {
      const result = pending.then(async () => {
        const current = await selection();
        if (JSON.stringify(current.identity) !== JSON.stringify(previous))
          throw new Error("Database selection changed during setup");
        const value = await load(true);
        await privateDirectory(dirname(file));
        await writeInstallationFile(file, `${JSON.stringify({ ...value, database })}\n`, previous);
      });
      pending = result.catch(() => {});
      return result;
    },
    async modelDefaults() {
      return parseModelDefaults((await load()).modelDefaults ?? { version: 1, providers: {} });
    },
    setModelDefaults(record) {
      return update({ modelDefaults: parseModelDefaults(record) });
    },
    async agentSetup() {
      const value = (await load()).agentSetup;
      return value == null ? null : parseAgentSetupRecord(value);
    },
    setAgentSetup(value) {
      const record = parseAgentSetupRecord(value);
      return update({ agentSetup: record, orchestrationProvider: record.primary });
    },
    async read() {
      const { database } = await load();
      return typeof database === "string" && isAbsolute(database) ? database : undefined;
    },
    write(database) {
      return update({ database });
    },
    async transparent() {
      return (await load()).transparent === true;
    },
    setTransparent(enabled) {
      return update({ transparent: enabled });
    },
    async updateCheck() {
      return (await load()).updateCheck !== false;
    },
    setUpdateCheck(enabled) {
      return update({ updateCheck: enabled });
    },
    async polling() {
      const value = (await load()).polling;
      if (value === undefined) return {};
      return parsePollSettings(value);
    },
    async setPolling(settings) {
      return update({ polling: parsePollSettings(settings) });
    },
    async orchestrationAutoApproval() {
      const value = (await load(true)).orchestrationAutoApproval;
      return value === undefined ? true : parseBoolean(value);
    },
    setOrchestrationAutoApproval(enabled) {
      return update({ orchestrationAutoApproval: parseBoolean(enabled) }, true);
    },
    async orchestrationProvider() {
      const value = (await load()).orchestrationProvider;
      return value === undefined ? null : parseOrchestrationProvider(value);
    },
    setOrchestrationProvider(provider) {
      return update({ orchestrationProvider: parseOrchestrationProvider(provider) });
    },
  };
}
