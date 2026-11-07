import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import {
  type PollSettingsPatch,
  parseOrchestrationProvider,
  parsePollSettings,
} from "../bridge/index.js";
import { atomicReplace, privateDirectory } from "../platform/index.js";

/** Remembers the selected project database between launches. */
export interface DesktopPreferences {
  read(): Promise<string | undefined>;
  write(database: string): Promise<void>;
  polling?(): Promise<PollSettingsPatch>;
  setPolling?(settings: PollSettingsPatch): Promise<void>;
  orchestrationProvider?(): Promise<string | null>;
  setOrchestrationProvider?(provider: string | null): Promise<void>;
}

export function filePreferences(file: string): DesktopPreferences & {
  transparent(): Promise<boolean>;
  setTransparent(enabled: boolean): Promise<void>;
  polling(): Promise<PollSettingsPatch>;
  setPolling(settings: PollSettingsPatch): Promise<void>;
  orchestrationProvider(): Promise<string | null>;
  setOrchestrationProvider(provider: string | null): Promise<void>;
} {
  async function load(): Promise<Record<string, unknown>> {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    try {
      const value: unknown = JSON.parse(text);
      return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  // Database and appearance writes share one queue so neither can lose the other's changes.
  let pending = Promise.resolve();
  function update(patch: Record<string, unknown>): Promise<void> {
    const result = pending.then(async () => {
      const value = { ...(await load()), ...patch };
      await privateDirectory(dirname(file));
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
        await atomicReplace(temporary, file);
      } finally {
        await rm(temporary, { force: true });
      }
    });
    pending = result.catch(() => {});
    return result;
  }
  return {
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
    async polling() {
      const value = (await load()).polling;
      if (value === undefined) return {};
      return parsePollSettings(value);
    },
    async setPolling(settings) {
      return update({ polling: parsePollSettings(settings) });
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
