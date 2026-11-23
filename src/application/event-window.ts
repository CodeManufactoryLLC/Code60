import type { SequencedEvent } from "../bridge/index.js";

/** Bounded live evidence; original core events and framed source stay on disk. */
export class EventWindow {
  private readonly entries: { entry: SequencedEvent; characters: number }[] = [];
  private characters = 0;
  truncated = false;

  constructor(private readonly limits: { characters: number; events?: number }) {}

  append(entry: SequencedEvent, characters = JSON.stringify(entry).length): void {
    this.entries.push({ entry, characters });
    this.characters += characters;
    let from = 0;
    for (const item of this.entries) {
      if (
        this.entries.length - from <= (this.limits.events ?? Infinity) &&
        this.characters <= this.limits.characters
      )
        break;
      this.characters -= item.characters;
      from++;
    }
    if (from) {
      this.entries.splice(0, from);
      this.truncated = true;
    }
  }
  read(): SequencedEvent[] {
    return this.entries.map(({ entry }) => entry);
  }
  clear(): void {
    this.entries.length = 0;
    this.characters = 0;
    this.truncated = false;
  }
}
