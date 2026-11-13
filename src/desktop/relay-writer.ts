import { randomUUID } from "node:crypto";
import { emitLog, type LogInput } from "../bridge/index.js";
import type { RelayMessage } from "./relay-history.js";
import { RelayPersistenceError } from "./relay-persistence.js";
import type { RelayAppend, RelayStore } from "./relay-store.js";

const MAX_CHARACTERS = 1_048_576;
const MAX_RECORDS = 1024;
const FLUSH_BYTES = 64 * 1024;

/** One generation's bounded journal queue. Failed batches are never replayed. */
export class RelayWriter {
  private queue: RelayAppend[] = [];
  private characters = 0;
  private records = 0;
  private queuedBytes = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<void> | undefined;
  private marked = false;
  failed = false;

  constructor(
    private readonly store: Pick<RelayStore, "appendBatch" | "markIncomplete">,
    private readonly log: ((input: LogInput) => void) | undefined,
    private readonly changed: () => void,
  ) {}

  enqueue(message: RelayMessage, start: boolean): void {
    if (this.failed) return;
    const last = this.queue.at(-1);
    const merge =
      !start &&
      last?.message.id === message.id &&
      last.message.role === message.role &&
      last.message.at === message.at;
    if (
      this.characters + message.text.length > MAX_CHARACTERS ||
      (!merge && this.records >= MAX_RECORDS)
    ) {
      this.fail(new RelayPersistenceError("queue", "capacity"));
      void this.flush();
      return;
    }
    this.characters += message.text.length;
    this.queuedBytes += Buffer.byteLength(message.text);
    if (merge) last.message.text += message.text;
    else {
      this.queue.push({ message: { ...message }, start });
      this.records++;
    }
    if (this.queuedBytes >= FLUSH_BYTES) void this.flush();
    else if (!this.timer && !this.flushing)
      this.timer = setTimeout(() => {
        void this.flush();
      }, 50);
  }

  flush(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.flushing) {
      this.flushing = this.drain().finally(() => {
        this.flushing = undefined;
        if (this.queue.length) return this.flush();
      });
    }
    return this.flushing;
  }

  private report(error: RelayPersistenceError): void {
    emitLog(this.log, {
      event: "persistence.failed",
      operationId: randomUUID(),
      severity: "warning",
      outcome: "failed",
      errorCategory: "storage",
      errorCode: error.code,
      persistenceStage: error.stage,
      persistenceFailure: error.failure,
      queuedCharacters: this.characters,
      queuedRecords: this.records,
      changedIdentityFields: error.fields,
    });
  }

  private fail(error: RelayPersistenceError): void {
    if (this.failed) return;
    this.failed = true;
    this.report(error);
    this.characters -= this.queue.reduce((sum, item) => sum + item.message.text.length, 0);
    this.records -= this.queue.length;
    this.queue = [];
    this.queuedBytes = 0;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.changed();
  }

  private async drain(): Promise<void> {
    while (this.queue.length && !this.failed) {
      const batch = this.queue;
      this.queue = [];
      this.queuedBytes = 0;
      const characters = batch.reduce((sum, item) => sum + item.message.text.length, 0);
      try {
        await this.store.appendBatch(batch);
      } catch (cause) {
        this.fail(
          cause instanceof RelayPersistenceError
            ? cause
            : new RelayPersistenceError("write", "unknown", cause),
        );
      } finally {
        this.characters -= characters;
        this.records -= batch.length;
      }
    }
    if (this.failed && !this.marked) {
      this.marked = true;
      try {
        await this.store.markIncomplete();
      } catch (cause) {
        this.report(new RelayPersistenceError("mark-incomplete", "io", cause));
      }
    }
  }
}
