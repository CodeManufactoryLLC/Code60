import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type RelayReviewEntry, relayReviewEntrySchema } from "../bridge/index.js";
import { privateDirectory } from "../platform/index.js";
import { readRelayState, storageCode, writeRelayState } from "./relay-storage.js";

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const manifestSchema = z.strictObject({
  format: z.literal(1),
  conversationId: z.string().uuid(),
  page: integer,
});
const pageSchema = manifestSchema.extend({ entries: z.array(relayReviewEntrySchema).max(128) });
const cursorSchema = z.strictObject({ page: integer, before: integer.max(128).optional() });
const MAX_PAGE_BYTES = 1_048_576;
export type RelayReviewIndexCursor = z.infer<typeof cursorSchema>;

/** Compact creation evidence only. Review contents, worker authority and queues are not indexed. */
export class RelayReviewIndex {
  private writes: Promise<unknown> = Promise.resolve();
  private constructor(
    private readonly root: string,
    private manifest: z.infer<typeof manifestSchema>,
  ) {}

  static async open(root: string, conversationId: string): Promise<RelayReviewIndex> {
    await privateDirectory(root);
    let manifest: z.infer<typeof manifestSchema>;
    try {
      manifest = manifestSchema.parse(await readRelayState(join(root, "manifest.json")));
    } catch (cause) {
      if (storageCode(cause) !== "ENOENT") throw cause;
      const existing = await lstat(join(root, "page-0.json")).catch((error) => {
        if (storageCode(error) !== "ENOENT") throw error;
        return null;
      });
      if (existing)
        throw new Error("Relay review index metadata is missing. Evidence was preserved.");
      manifest = manifestSchema.parse({ format: 1, conversationId, page: 0 });
      await writeRelayState(join(root, "page-0.json"), { ...manifest, entries: [] });
      await writeRelayState(join(root, "manifest.json"), manifest);
    }
    if (manifest.conversationId !== conversationId)
      throw new Error("Relay review index belongs to another conversation");
    const index = new RelayReviewIndex(root, manifest);
    await index.page(manifest.page);
    await index.recover();
    return index;
  }
  private async page(number: number) {
    const page = pageSchema.parse(
      await readRelayState(join(this.root, `page-${number}.json`), MAX_PAGE_BYTES),
      { jitless: true },
    );
    if (
      page.conversationId !== this.manifest.conversationId ||
      page.page !== number ||
      new Set(page.entries.map((entry) => entry.id)).size !== page.entries.length
    )
      throw new Error("Invalid Relay review index identity");
    return page;
  }
  private async recover(): Promise<void> {
    if (this.manifest.page === Number.MAX_SAFE_INTEGER) return;
    const number = this.manifest.page + 1;
    let next: Awaited<ReturnType<RelayReviewIndex["page"]>>;
    try {
      next = await this.page(number);
    } catch (cause) {
      if (storageCode(cause) === "ENOENT") return;
      throw cause;
    }
    if (next.entries.length !== 1 || (await this.page(this.manifest.page)).entries.length !== 128)
      throw new Error("Relay review index publication is ambiguous. Evidence was preserved.");
    const manifest = { ...this.manifest, page: number };
    await writeRelayState(join(this.root, "manifest.json"), manifest, this.manifest);
    this.manifest = manifest;
  }
  /** Called once for each new generated review, never for subsequent revisions. */
  append(value: RelayReviewEntry): Promise<void> {
    const entry = relayReviewEntrySchema.parse(value, { jitless: true });
    const operation = this.writes.then(async () => {
      await this.recover();
      const previous = await this.page(this.manifest.page);
      const existing = previous.entries.find((item) => item.id === entry.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(entry))
          throw new Error("This Relay review index entry already has another identity");
        return;
      }
      if (previous.entries.length < 128) {
        await writeRelayState(
          join(this.root, `page-${previous.page}.json`),
          { ...previous, entries: [...previous.entries, entry] },
          previous,
          MAX_PAGE_BYTES,
        );
        return;
      }
      if (previous.page === Number.MAX_SAFE_INTEGER) throw new Error("Relay review index is full");
      const manifest = { ...this.manifest, page: previous.page + 1 };
      await writeRelayState(
        join(this.root, `page-${manifest.page}.json`),
        { ...manifest, entries: [entry] },
        undefined,
        MAX_PAGE_BYTES,
      );
      await writeRelayState(join(this.root, "manifest.json"), manifest, this.manifest);
      this.manifest = manifest;
    });
    this.writes = operation.catch(() => {});
    return operation;
  }
  async read(cursor?: RelayReviewIndexCursor) {
    await this.writes;
    const position =
      cursor === undefined ? undefined : cursorSchema.parse(cursor, { jitless: true });
    const number = position?.page ?? this.manifest.page;
    if (number > this.manifest.page) throw new Error("Relay review index cursor is unavailable");
    const page = await this.page(number);
    const before = position?.before ?? page.entries.length;
    if (before > page.entries.length) throw new Error("Relay review index cursor is unavailable");
    const start = Math.max(0, before - 32);
    const next: RelayReviewIndexCursor | null =
      start > 0 ? { page: number, before: start } : number > 0 ? { page: number - 1 } : null;
    return { entries: page.entries.slice(start, before).reverse(), next };
  }
}
