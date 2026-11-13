import { isUtf8 } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { privateDirectory, writePrivateFile } from "../platform/index.js";
import { type RelayMessage, relayHistoryWindow } from "./relay-history.js";
import { changedJournalFields, RelayPersistenceError } from "./relay-persistence.js";
import {
  lockRelay,
  readRelayState,
  relayFile,
  storageCode,
  verifyRelayStorage,
  writeRelayState,
} from "./relay-storage.js";

const stateSchema = z.strictObject({
  format: z.literal(1),
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  incomplete: z.boolean().optional(),
  runId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
    .nullable(),
});
const fragmentSchema = z.strictObject({
  id: z.string().uuid(),
  role: z.enum(["human", "assistant", "activity"]),
  at: z.string().datetime(),
  text: z.string().max(32_768),
  start: z.boolean(),
});
type Fragment = z.output<typeof fragmentSchema>;
const MAX_FRAME_BYTES = 132_096;
const MAX_READ_BYTES = 2 * 1024 * 1024;
const MAX_READ_FRAMES = 1_024;
const FOOTER_BYTES = 10;
const journalStamp = (info: BigIntStats) =>
  [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(":");

export interface RelaySourceCursor {
  direction: "backward" | "forward";
  position: number;
  bound: number;
}

export interface RelayAppend {
  message: RelayMessage;
  start: boolean;
}

async function sourceFrame(file: Awaited<ReturnType<typeof relayFile>>, cursor: RelaySourceCursor) {
  let begin: number;
  let end: number;
  let data: Buffer;
  let bytesRead = 0;
  if (cursor.direction === "backward") {
    end = cursor.position;
    if (end < FOOTER_BYTES) throw new Error("Original Relay message is incomplete");
    const footer = Buffer.alloc(FOOTER_BYTES);
    const read = await file.read(footer, 0, footer.length, end - FOOTER_BYTES);
    bytesRead += read.bytesRead;
    if (read.bytesRead !== FOOTER_BYTES || !/^\n[0-9a-f]{8}\n$/.test(footer.toString("ascii")))
      throw new Error("Original Relay message is incomplete");
    const size = Number.parseInt(footer.subarray(1, 9).toString("ascii"), 16);
    begin = end - FOOTER_BYTES - size;
    if (size <= 0 || size > MAX_FRAME_BYTES || begin < 0)
      throw new Error("Original Relay message is incomplete");
    data = Buffer.alloc(size);
    const body = await file.read(data, 0, size, begin);
    bytesRead += body.bytesRead;
    if (body.bytesRead !== size) throw new Error("Original Relay message is incomplete");
  } else {
    begin = cursor.position;
    const buffer = Buffer.alloc(Math.min(MAX_FRAME_BYTES + FOOTER_BYTES, cursor.bound - begin));
    const read = await file.read(buffer, 0, buffer.length, begin);
    bytesRead += read.bytesRead;
    const size = buffer.subarray(0, read.bytesRead).indexOf(10);
    const footer = buffer.subarray(size, size + FOOTER_BYTES).toString("ascii");
    if (
      size <= 0 ||
      size > MAX_FRAME_BYTES ||
      !/^\n[0-9a-f]{8}\n$/.test(footer) ||
      Number.parseInt(footer.slice(1, 9), 16) !== size
    )
      throw new Error("Original Relay message is incomplete");
    data = buffer.subarray(0, size);
    end = begin + size + FOOTER_BYTES;
  }
  if (!isUtf8(data)) throw new Error("Original Relay message is incomplete");
  return {
    fragment: fragmentSchema.parse(JSON.parse(data.toString("utf8"))),
    begin,
    end,
    bytesRead,
  };
}

/**
 * An append-only framed transcript with an embedded reverse index. Each footer
 * locates one bounded JSON record, so startup never scans the lifetime journal.
 * Core's original run transcripts remain untouched in workspace/.code60/runs.
 */
export class RelayStore {
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private constructor(
    readonly root: string,
    private state: z.output<typeof stateSchema>,
    private readonly release: () => Promise<void>,
    private readonly workspaceIdentity: { cwd: string; device: bigint; inode: bigint },
    private journalIdentity: BigIntStats,
  ) {}
  get id() {
    return this.state.id;
  }
  get generation() {
    return this.state.generation;
  }
  get workspace() {
    return join(this.root, "workspace");
  }
  get fileRoot() {
    return this.workspaceIdentity.cwd;
  }
  async validateWorkspace(): Promise<void> {
    if (this.closed) throw new Error("Relay storage is closed");
    await verifyRelayStorage(this.workspace, true);
    const cwd = await realpath(this.workspace);
    const info = await lstat(cwd, { bigint: true });
    if (
      this.closed ||
      cwd !== this.workspaceIdentity.cwd ||
      info.dev !== this.workspaceIdentity.device ||
      info.ino !== this.workspaceIdentity.inode
    )
      throw new Error("Relay workspace directory identity changed");
  }
  private get journal() {
    return join(this.root, "history.frames");
  }

  static async open(root: string): Promise<RelayStore> {
    const release = await lockRelay(root);
    try {
      let raw: unknown;
      try {
        raw = await readRelayState(join(root, "state.json"));
      } catch (error) {
        if (storageCode(error) !== "ENOENT") throw error;
        for (const path of [join(root, "workspace"), join(root, "history.frames")]) {
          const existing = await lstat(path).catch((cause) => {
            if (storageCode(cause) !== "ENOENT") throw cause;
            return null;
          });
          if (existing)
            throw new Error(
              "Relay metadata is missing. Recover the existing workspace before retrying.",
            );
        }
        const at = new Date().toISOString();
        raw = {
          format: 1,
          id: randomUUID(),
          createdAt: at,
          updatedAt: at,
          generation: 0,
          runId: null,
        };
        await privateDirectory(join(root, "workspace"));
        await writePrivateFile(join(root, "history.frames"), "", { mode: 0o600, flag: "wx" });
        await writeRelayState(join(root, "state.json"), raw);
      }
      const state = stateSchema.parse(raw);
      await verifyRelayStorage(join(root, "workspace"), true);
      const journal = await verifyRelayStorage(join(root, "history.frames"), false);
      const cwd = await realpath(join(root, "workspace"));
      const info = await lstat(cwd, { bigint: true });
      return new RelayStore(
        root,
        state,
        release,
        { cwd, device: info.dev, inode: info.ino },
        journal,
      );
    } catch (error) {
      await release();
      throw error;
    }
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Relay storage is closed"));
    const result = this.tail.then(work);
    this.tail = result.catch(() => {});
    return result;
  }

  async beginGeneration(runId: string): Promise<void> {
    return this.serial(async () => {
      const next = stateSchema.parse({
        ...this.state,
        generation: this.state.generation + 1,
        runId,
        updatedAt: new Date().toISOString(),
      });
      await writeRelayState(join(this.root, "state.json"), next, this.state);
      this.state = next;
    });
  }

  markIncomplete(): Promise<void> {
    return this.serial(async () => {
      const next = { ...this.state, incomplete: true };
      await writeRelayState(join(this.root, "state.json"), next, this.state);
      this.state = next;
    });
  }

  append(message: RelayMessage, start = true): Promise<void> {
    return this.appendBatch([{ message, start }]);
  }

  appendBatch(records: readonly RelayAppend[]): Promise<void> {
    return this.serial(async () => {
      const file = await relayFile(this.journal, true).catch((cause) => {
        throw cause instanceof RelayPersistenceError
          ? cause
          : new RelayPersistenceError("open", "io", cause);
      });
      let stage: "validate" | "write" | "sync" = "validate";
      let failed = false;
      try {
        this.checkJournal(await file.stat({ bigint: true }));
        let size = (await file.stat()).size;
        // A crash-truncated tail is never silently overwritten or concatenated.
        if (size) {
          const footer = Buffer.alloc(FOOTER_BYTES);
          await file.read(footer, 0, FOOTER_BYTES, size - FOOTER_BYTES);
          if (!/^\n[0-9a-f]{8}\n$/.test(footer.toString("ascii")))
            throw new RelayPersistenceError("validate", "invalid-frame");
        }
        for (const { message, start } of records) {
          let offset = 0;
          do {
            let end = offset;
            for (let count = 0; end < message.text.length && count < 16_000; count++) {
              const point = message.text.codePointAt(end);
              end += point !== undefined && point > 0xffff ? 2 : 1;
            }
            const part = fragmentSchema.parse({
              id: message.id,
              role: message.role,
              at: message.at,
              text: message.text.slice(offset, end),
              start: start && offset === 0,
            });
            const bytes = Buffer.from(JSON.stringify(part));
            const data = Buffer.concat([
              bytes,
              Buffer.from(`\n${bytes.length.toString(16).padStart(8, "0")}\n`),
            ]);
            let written = 0;
            stage = "write";
            while (written < data.length) {
              const result = await file.write(data, written, data.length - written, size + written);
              if (!result.bytesWritten) throw new Error("Relay history write was incomplete");
              written += result.bytesWritten;
            }
            size += data.length;
            offset = end;
          } while (offset < message.text.length);
        }
        stage = "validate";
        const written = await file.stat({ bigint: true });
        const entry = await verifyRelayStorage(this.journal, false);
        if (
          written.size !== BigInt(size) ||
          written.dev !== this.journalIdentity.dev ||
          written.ino !== this.journalIdentity.ino ||
          journalStamp(written) !== journalStamp(entry)
        )
          throw new RelayPersistenceError("validate", "identity", undefined, [
            ...new Set([
              ...changedJournalFields(written, entry),
              ...(written.size !== BigInt(size) ? ["size" as const] : []),
              ...(written.dev !== this.journalIdentity.dev ? ["dev" as const] : []),
              ...(written.ino !== this.journalIdentity.ino ? ["ino" as const] : []),
            ]),
          ]);
        // These complete frames are verified owned writes, even if the durability
        // barrier fails. Keep their exact stamp so Retry can validate them without
        // replaying the batch; partial writes and outside changes stay rejected.
        this.journalIdentity = written;
        stage = "sync";
        await file.sync();
        stage = "validate";
        this.checkJournal(await file.stat({ bigint: true }));
        this.checkJournal(await verifyRelayStorage(this.journal, false));
      } catch (cause) {
        failed = true;
        throw cause instanceof RelayPersistenceError
          ? cause
          : new RelayPersistenceError(stage, "io", cause);
      } finally {
        await file.close().catch((cause) => {
          if (!failed) throw new RelayPersistenceError("close", "io", cause);
        });
      }
    });
  }

  /** Opaque cursors are byte boundaries, never caller-provided filesystem paths. */
  history(before?: number) {
    return this.serial(() => this.readHistory(before));
  }
  private checkJournal(info: BigIntStats): void {
    if (journalStamp(info) !== journalStamp(this.journalIdentity))
      throw new RelayPersistenceError(
        "validate",
        "identity",
        undefined,
        changedJournalFields(this.journalIdentity, info),
      );
  }
  private async readHistory(before?: number) {
    const file = await relayFile(this.journal);
    let bytesRead = 0;
    const messages: RelayMessage[] = [];
    let damaged = false;
    let position = 0;
    try {
      if (journalStamp(await file.stat({ bigint: true })) !== journalStamp(this.journalIdentity))
        return {
          ...relayHistoryWindow([], false, true),
          damaged: true,
          cursor: 0,
          sourceBound: 0,
          bytesRead: 0,
        };
      const size = (await file.stat()).size;
      position = before ?? size;
      if (!Number.isSafeInteger(position) || position < 0 || position > size)
        throw new Error("Invalid Relay history cursor");
      for (let count = 0; position > 0 && count < MAX_READ_FRAMES; count++) {
        if (position < FOOTER_BYTES) {
          damaged = true;
          break;
        }
        if (bytesRead + FOOTER_BYTES > MAX_READ_BYTES) break;
        const footer = Buffer.alloc(FOOTER_BYTES);
        const tail = await file.read(footer, 0, FOOTER_BYTES, position - FOOTER_BYTES);
        bytesRead += tail.bytesRead;
        if (
          tail.bytesRead !== FOOTER_BYTES ||
          !/^\n[0-9a-f]{8}\n$/.test(footer.toString("ascii"))
        ) {
          damaged = true;
          break;
        }
        const length = Number.parseInt(footer.subarray(1, 9).toString("ascii"), 16);
        if (length <= 0 || length > MAX_FRAME_BYTES || length + FOOTER_BYTES > position) {
          damaged = true;
          break;
        }
        if (bytesRead + length > MAX_READ_BYTES) break;
        const data = Buffer.alloc(length);
        const body = await file.read(data, 0, length, position - FOOTER_BYTES - length);
        bytesRead += body.bytesRead;
        let fragment: Fragment;
        try {
          if (body.bytesRead !== length || !isUtf8(data)) throw new Error("Incomplete frame");
          fragment = fragmentSchema.parse(JSON.parse(data.toString("utf8")));
        } catch {
          damaged = true;
          break;
        }
        const previous = messages[0];
        const candidate = messages.map((message) => ({ ...message }));
        if (previous?.id === fragment.id) {
          candidate[0] = {
            ...previous,
            text: fragment.text + previous.text,
            partial: !fragment.start,
          };
        } else {
          candidate.unshift({
            id: fragment.id,
            role: fragment.role,
            at: fragment.at,
            text: fragment.text,
            partial: !fragment.start,
            sourceEnd: position,
          });
        }
        const window = relayHistoryWindow(candidate);
        // Consume only complete frames that will actually be displayed. This keeps
        // byte-boundary paging lossless even when a message spans several pages.
        if (
          window.messages.length !== candidate.length ||
          window.messages.some((message, index) => message.text !== candidate[index]?.text)
        )
          break;
        messages.splice(0, messages.length, ...candidate);
        position -= length + FOOTER_BYTES;
        if (messages.length >= 200) break;
      }
      const last = messages.at(-1);
      if (before !== undefined && before < size && last) last.partial = true;
      this.checkJournal(await file.stat({ bigint: true }));
      this.checkJournal(await verifyRelayStorage(this.journal, false));
      return {
        ...relayHistoryWindow(messages, position > 0, damaged || this.state.incomplete === true),
        damaged,
        cursor: position,
        sourceBound: size,
        bytesRead,
      };
    } finally {
      await file.close();
    }
  }

  /** Reads one bounded source frame, seeking only within the requested message. */
  source(id: string, cursor: RelaySourceCursor) {
    return this.serial(() => this.readSource(id, cursor));
  }
  private async readSource(id: string, cursor: RelaySourceCursor) {
    const file = await relayFile(this.journal);
    try {
      this.checkJournal(await file.stat({ bigint: true }));
      if (
        !Number.isSafeInteger(cursor.position) ||
        !Number.isSafeInteger(cursor.bound) ||
        cursor.position < 0 ||
        cursor.position > cursor.bound ||
        cursor.bound > (await file.stat()).size
      )
        throw new Error("Original Relay message is unavailable");
      if (cursor.direction === "forward" && cursor.position === cursor.bound)
        return { text: "", next: null, bytesRead: 0 };
      const frame = await sourceFrame(file, cursor);
      this.checkJournal(await file.stat({ bigint: true }));
      this.checkJournal(await verifyRelayStorage(this.journal, false));
      if (cursor.direction === "forward" && (frame.fragment.id !== id || frame.fragment.start))
        return { text: "", next: null, bytesRead: frame.bytesRead };
      if (frame.fragment.id !== id) throw new Error("Original Relay message is incomplete");
      const beginning = cursor.direction === "backward" && !frame.fragment.start;
      const next: RelaySourceCursor = {
        ...cursor,
        direction: beginning ? "backward" : "forward",
        position: beginning ? frame.begin : frame.end,
      };
      if (beginning && next.position === 0) throw new Error("Original Relay message is incomplete");
      return {
        text: beginning ? "" : frame.fragment.text,
        next: next.direction === "forward" && next.position === next.bound ? null : next,
        bytesRead: frame.bytesRead,
      };
    } finally {
      await file.close();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.tail;
    await this.release();
  }
}
