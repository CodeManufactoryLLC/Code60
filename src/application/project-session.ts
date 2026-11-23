import { createHash } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import {
  privateDirectory,
  readPrivateJson,
  verifyPrivatePath,
  writePrivateJson,
} from "../platform/index.js";

const MAX_BYTES = 1_048_576;
const sessionSchema = z
  .object({
    format: z.literal(1),
    projects: z
      .array(
        z
          .string()
          .max(32_768)
          .refine((path) => isAbsolute(path) && !path.includes("\0")),
      )
      .max(64)
      .refine((paths) => new Set(paths).size === paths.length),
  })
  .strict();

/** Saved presentation only, never project identities or execution authority. */
export class ProjectSessionStore {
  private readonly workspace: string;
  private readonly root: string;
  private readonly file: string;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(database: string) {
    this.workspace = join(dirname(database), ".code60_workspace");
    this.root = join(this.workspace, "sessions");
    this.file = join(this.root, `${createHash("sha256").update(database).digest("hex")}.json`);
  }

  private async read() {
    try {
      await verifyPrivatePath(this.workspace, true);
      await verifyPrivatePath(this.root, true);
      return sessionSchema.parse(await readPrivateJson(this.file, MAX_BYTES));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }

  load(): Promise<string[]> {
    return this.serialized(async () => (await this.read())?.projects ?? []);
  }

  save(projects: readonly string[]): Promise<void> {
    // Capture the caller's set before yielding to another lifecycle action.
    const value = sessionSchema.parse({ format: 1, projects: [...projects] });
    return this.serialized(async () => {
      for (const path of [this.workspace, this.root]) {
        await privateDirectory(path);
        await verifyPrivatePath(path, true);
      }
      const previous = await this.read(); // Never replace invalid or unsafe saved state.
      await writePrivateJson(this.file, value, previous, MAX_BYTES);
    });
  }
}
