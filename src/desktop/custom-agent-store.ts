import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { type CustomAgent, customAgentSchema } from "../bridge/index.js";
import { privateDirectory } from "../platform/index.js";
import {
  lockRelay,
  readRelayState,
  storageCode,
  verifyRelayStorage,
  writeRelayState,
} from "./relay-storage.js";

const entrySchema = customAgentSchema
  .omit({ instructions: true })
  .extend({ definition: z.string().uuid() });
const schema = z
  .strictObject({ format: z.literal(1), agents: z.array(entrySchema).max(64) })
  .refine((s) => new Set(s.agents.map((a) => a.id)).size === s.agents.length);
const definitionSchema = customAgentSchema.pick({ name: true, instructions: true });
const LIMIT = 65_536;
const DEFINITION_LIMIT = 256 * 1024;

/** A compact locked catalog references immutable definitions, read only on demand. */
export class CustomAgentStore {
  private constructor(
    readonly root: string,
    private state: z.infer<typeof schema>,
    private readonly release: () => Promise<void>,
  ) {}
  static async open(root: string): Promise<CustomAgentStore> {
    const release = await lockRelay(root);
    try {
      let state: unknown;
      try {
        state = await readRelayState(join(root, "agents.json"), LIMIT);
      } catch (error) {
        if (storageCode(error) !== "ENOENT") throw error;
        if ((await readdir(root)).some((name) => name !== ".writer"))
          throw new Error("Custom agent metadata is missing. Existing data was preserved.");
        state = { format: 1, agents: [] };
        await writeRelayState(join(root, "agents.json"), state, undefined, LIMIT);
      }
      return new CustomAgentStore(root, schema.parse(state), release);
    } catch (error) {
      await release();
      throw error;
    }
  }
  list() {
    return this.state.agents.map(({ definition: _, ...agent }) => ({ ...agent }));
  }
  private entry(id: string, revision?: number) {
    const agent = this.state.agents.find((a) => a.id === id);
    if (!agent) throw new Error("Custom agent is unavailable");
    if (revision !== undefined && agent.revision !== revision)
      throw new Error("This agent changed. Reopen it before saving.");
    return agent;
  }
  async get(id: string, revision?: number): Promise<CustomAgent> {
    const { definition, ...agent } = this.entry(id, revision);
    const directory = join(this.root, "definitions");
    await verifyRelayStorage(directory, true);
    const content = definitionSchema.parse(
      await readRelayState(join(directory, `${definition}.json`), DEFINITION_LIMIT),
    );
    if (content.name !== agent.name)
      throw new Error("Custom agent definition changed. Existing data was preserved.");
    return { ...content, ...agent };
  }
  async save(value: Pick<CustomAgent, "name" | "instructions">, id?: string, revision?: number) {
    const previous = id ? this.entry(id, revision) : undefined;
    const agent = customAgentSchema.parse({
      name: value.name,
      instructions: value.instructions,
      id: id ?? randomUUID(),
      revision: (previous?.revision ?? 0) + 1,
      archived: previous?.archived ?? false,
    });
    const { instructions, ...summary } = agent;
    const definition = randomUUID();
    const next = this.next({ ...summary, definition });
    const directory = join(this.root, "definitions");
    await privateDirectory(directory);
    await verifyRelayStorage(directory, true);
    // Publish immutable content before the catalog. Interrupted content is never replayed or removed.
    await writeRelayState(
      join(directory, `${definition}.json`),
      { name: agent.name, instructions },
      undefined,
      DEFINITION_LIMIT,
    );
    await this.commit(next);
    return agent;
  }
  async archive(id: string, revision: number, archived: boolean) {
    const previous = this.entry(id, revision);
    await this.commit(this.next({ ...previous, archived, revision: previous.revision + 1 }));
  }
  private next(agent: z.infer<typeof entrySchema>) {
    return schema.parse({
      format: 1,
      agents: this.state.agents.some((a) => a.id === agent.id)
        ? this.state.agents.map((a) => (a.id === agent.id ? agent : a))
        : [...this.state.agents, agent],
    });
  }
  private async commit(next: z.infer<typeof schema>) {
    await writeRelayState(join(this.root, "agents.json"), next, this.state, LIMIT);
    this.state = next;
  }
  close() {
    return this.release();
  }
}
