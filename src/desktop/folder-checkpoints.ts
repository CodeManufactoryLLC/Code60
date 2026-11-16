import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { TaskLoop, type TaskProposal } from "../core/index.js";
import { privateDirectory } from "../platform/index.js";
import { readRelayState, storageCode, writeRelayState } from "./relay-storage.js";

const digest = (data: string) =>
  createHash("sha256").update(Buffer.from(data, "base64")).digest("hex");
const file = z.strictObject({
  path: z.string().min(1).max(32_768),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  mode: z.enum(["100644", "100755"]),
  permissions: z.number().int().min(0).max(511),
});
const manifest = z.array(file).max(10_000);
const blob = z.strictObject({ data: z.string().max(44_739_244) });
const blobLimit = 44_739_344;
type FolderGit = ReturnType<typeof TaskLoop.folderGit>;

/** Content-addressed private preimages shared across direct checkpoints, never repository copies. */
export class FolderCheckpoints {
  constructor(
    readonly root: string,
    private git: FolderGit,
    private exclude: string[],
  ) {}
  loop(project: string, root = this.root): TaskLoop {
    if (
      this.exclude.some((excluded) => {
        const path = relative(resolve(excluded).toLowerCase(), resolve(project).toLowerCase());
        return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
      })
    )
      throw new Error("Direct snapshots cannot target Code60's private state");
    return new TaskLoop(project, root, this.git, undefined, this.exclude);
  }
  async capture(
    project: string,
    availableBytes: number,
    availableRawBytes: number,
    reserve: (bytes: number) => Promise<void>,
  ) {
    const files = await this.loop(project).snapshotFolder(availableRawBytes);
    const records: z.infer<typeof file>[] = [];
    const missing = new Map<string, { data: string }>();
    let rawBytes = 0;
    for (const [path, value] of files) {
      const hash = digest(value.data);
      rawBytes += Buffer.byteLength(value.data, "base64");
      records.push({ path, hash, mode: value.mode, permissions: value.permissions ?? 0o644 });
      try {
        const saved = blob.parse(await readRelayState(join(this.root, `${hash}.json`), blobLimit));
        if (digest(saved.data) !== hash) throw new Error("Direct checkpoint content changed");
      } catch (cause) {
        if (storageCode(cause) !== "ENOENT") throw cause;
        missing.set(hash, { data: value.data });
      }
    }
    const manifestBytes = Buffer.byteLength(JSON.stringify(records));
    if (manifestBytes > 4_194_304) throw new Error("Direct snapshot file listing is too large");
    const bytes =
      manifestBytes +
      [...missing.values()].reduce(
        (sum, value) => sum + Buffer.byteLength(JSON.stringify(value)),
        0,
      );
    if (bytes > availableBytes) throw new Error("Direct checkpoint storage limit reached");
    // Charge durable quota before writing anything, including failed/interrupted captures.
    await reserve(bytes);
    await privateDirectory(this.root);
    for (const [hash, value] of missing)
      await writeRelayState(join(this.root, `${hash}.json`), value, undefined, blobLimit);
    const id = randomUUID();
    await writeRelayState(join(this.root, `${id}.json`), records, undefined, 4_194_304);
    return { baseline: id, bytes, rawBytes };
  }
  async changes(
    project: string,
    baseline: string,
    availableRawBytes = 33_554_432,
  ): Promise<{ changes: TaskProposal["changes"]; rawBytes: number }> {
    z.uuid().parse(baseline);
    const records = manifest.parse(
      await readRelayState(join(this.root, `${baseline}.json`), 4_194_304),
    );
    const before = new Map<string, NonNullable<TaskProposal["changes"][number]["before"]>>();
    let rawBytes = 0;
    for (const record of records) {
      const value = blob.parse(
        await readRelayState(join(this.root, `${record.hash}.json`), blobLimit),
      );
      if (digest(value.data) !== record.hash) throw new Error("Direct checkpoint content changed");
      rawBytes += Buffer.byteLength(value.data, "base64");
      if (rawBytes > 33_554_432) throw new Error("Direct checkpoint preimage exceeds 32 MiB");
      if (before.has(record.path)) throw new Error("Duplicate direct checkpoint file");
      before.set(record.path, {
        data: value.data,
        mode: record.mode,
        permissions: record.permissions,
      });
    }
    const after = await this.loop(project).snapshotFolder(availableRawBytes);
    const changes: TaskProposal["changes"] = [];
    for (const path of new Set([...before.keys(), ...after.keys()])) {
      const original = before.get(path) ?? null;
      const current = after.get(path) ?? null;
      if (
        original?.data === current?.data &&
        original?.mode === current?.mode &&
        original?.permissions === current?.permissions
      )
        continue;
      changes.push({ id: randomUUID(), path, before: original, after: current });
    }
    return {
      changes,
      rawBytes: [...after.values()].reduce(
        (sum, value) => sum + Buffer.byteLength(value.data, "base64"),
        0,
      ),
    };
  }
}
