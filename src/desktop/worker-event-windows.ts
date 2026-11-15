import type { SequencedEvent } from "../bridge/index.js";
import { EventWindow } from "./event-window.js";

const limits = { events: 512, characters: 256_000 };

/** Shared event references, independent target eviction and one compatibility tail. */
export class WorkerEventWindows {
  private readonly aggregate = new EventWindow(limits);
  private readonly targets = new Map<string, EventWindow>();

  append(targetId: string, entry: SequencedEvent): void {
    let target = this.targets.get(targetId);
    if (!target) {
      if (this.targets.size >= 256) throw new Error("Relay event target capacity reached.");
      target = new EventWindow(limits);
      this.targets.set(targetId, target);
    }
    const characters = JSON.stringify(entry).length;
    this.aggregate.append(entry, characters);
    target.append(entry, characters);
  }
  read(targetId?: string): SequencedEvent[] {
    return (targetId === undefined ? this.aggregate : this.targets.get(targetId))?.read() ?? [];
  }
  incomplete(targetId: string): boolean {
    return this.targets.get(targetId)?.truncated ?? false;
  }
  clear(): void {
    this.targets.clear();
    this.aggregate.clear();
  }
}
