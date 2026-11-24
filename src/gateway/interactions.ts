import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  type ChooserRequest,
  GATEWAY_LIMITS,
  type Interaction,
  type InteractionAnswer,
  type PickKind,
} from "../bridge/index.js";
import { HostChooser } from "./chooser.js";

type Pending = {
  owner: string;
  interaction: Interaction;
  chooser?: HostChooser;
  resolve(value: string | boolean | null): void;
  timer: ReturnType<typeof setTimeout>;
};

/** Human decisions are bound to the authenticated request and invalidated on detach. */
export class Interactions {
  private readonly active = new Set<string>();
  attach(owner: string) {
    this.active.add(owner);
  }
  private readonly context = new AsyncLocalStorage<string>();
  private readonly pending = new Map<string, Pending>();
  constructor(
    private readonly roots: readonly string[],
    private readonly emit: (owner: string, value: Interaction) => void,
    private readonly ended: (owner: string, id: string) => void = () => {},
  ) {}
  page(): string {
    const owner = this.context.getStore();
    if (!owner || !this.active.has(owner)) throw new Error("Authenticated page is detached");
    return owner;
  }
  run<T>(owner: string, action: () => T): T {
    return this.context.run(owner, action);
  }
  private ask(
    kind: "confirm" | "pick",
    title: string,
    detail: string,
    picker?: PickKind,
  ): Promise<string | boolean | null> {
    const owner = this.context.getStore();
    if (!owner || !this.active.has(owner) || this.pending.size >= 16) return Promise.resolve(null);
    const interaction: Interaction = {
      id: randomUUID(),
      kind,
      title,
      detail,
      ...(picker ? { picker } : {}),
    };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(interaction.id);
        this.ended(owner, interaction.id);
        resolve(null);
      }, GATEWAY_LIMITS.interactionMs);
      this.pending.set(interaction.id, {
        owner,
        interaction,
        resolve,
        timer,
        ...(picker ? { chooser: new HostChooser(this.roots, picker) } : {}),
      });
      this.emit(owner, interaction);
    });
  }
  async confirm(title: string, detail: string): Promise<boolean> {
    return (await this.ask("confirm", title, detail)) === true;
  }
  async pick(kind: PickKind): Promise<string | null> {
    const result = await this.ask(
      "pick",
      kind === "folder"
        ? "Choose folder"
        : kind === "database-create"
          ? "Create database"
          : "Open database",
      "Choose a location on the computer running Code60.",
      kind,
    );
    return typeof result === "string" ? result : null;
  }
  list(owner: string): Interaction[] {
    return [...this.pending.values()].filter((p) => p.owner === owner).map((p) => p.interaction);
  }
  async choices(owner: string, request: ChooserRequest) {
    const pending = this.pending.get(request.id);
    if (!pending || pending.owner !== owner || !pending.chooser)
      throw new Error("Chooser expired.");
    return pending.chooser.list(request.directory, request.createDirectory);
  }
  async answer(owner: string, answer: InteractionAnswer) {
    const pending = this.pending.get(answer.id);
    if (!pending || pending.owner !== owner) throw new Error("Confirmation expired.");
    let result: string | boolean | null = answer.accepted;
    if (pending.chooser && answer.accepted) {
      if (!answer.choice) throw new Error("Choose a location.");
      result = await pending.chooser.resolve(answer.choice, answer.filename);
    }
    if (this.pending.get(answer.id) !== pending) throw new Error("Confirmation expired.");
    clearTimeout(pending.timer);
    this.pending.delete(answer.id);
    this.ended(owner, answer.id);
    pending.resolve(result);
  }
  detach(owner: string) {
    this.active.delete(owner);
    for (const [id, pending] of this.pending)
      if (pending.owner === owner) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        this.ended(owner, id);
        pending.resolve(null);
      }
  }
  close() {
    this.active.clear();
    for (const pending of this.pending.values()) this.detach(pending.owner);
  }
}
