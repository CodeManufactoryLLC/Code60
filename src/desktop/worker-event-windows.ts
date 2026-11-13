import type { SequencedEvent } from "../bridge/index.js";

class Window {
  private readonly entries: { entry: SequencedEvent; characters: number }[] = [];
  private characters = 0;
  truncated = false;

  append(entry: SequencedEvent, characters: number): void {
    this.entries.push({ entry, characters });
    this.characters += characters;
    while (this.entries.length > 512 || this.characters > 256_000) {
      const first = this.entries.shift();
      if (!first) break;
      this.characters -= first.characters;
      this.truncated = true;
    }
  }
  read(): SequencedEvent[] {
    return this.entries.map(({ entry }) => entry);
  }
}

/** Shared event references, independent target eviction and one compatibility tail. */
export class WorkerEventWindows {
  private aggregate = new Window();
  private readonly targets = new Map<string, Window>();

  append(targetId: string, entry: SequencedEvent): void {
    let target = this.targets.get(targetId);
    if (!target) {
      if (this.targets.size >= 256) throw new Error("Relay event target capacity reached.");
      target = new Window();
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
    this.aggregate = new Window();
  }
}
