import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { type AgentSession, type AgentUpdate, createAgents } from "../src/agents/index.js";
import type { LogInput } from "../src/contracts/index.js";

it("real fake-agent connection emits once-only safe boundaries, not streamed transcript content", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-log-provider-")));
  const records: LogInput[] = [];
  const agents = createAgents({ clientVersion: "test", log: (record) => records.push(record) });
  let session: AgentSession | undefined;
  try {
    const operationId = randomUUID();
    session = await agents.start({
      name: "claude",
      command: [process.execPath, resolve(import.meta.dirname, "fixtures/fake-agent.mjs")],
      cwd: directory,
      diagnostic: { operationId, runId: "r1" },
    });
    const updates: AgentUpdate[] = [];
    session.onUpdate((update) => updates.push(update));
    await session.prompt(JSON.stringify([{ message: "private prompt token=DO-NOT-LOG" }]));
    expect(
      updates.some((update) => update.type === "message" && update.text.includes("DO-NOT-LOG")),
    ).toBe(true);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      event: "provider.connect",
      operationId,
      runId: "r1",
      provider: "claude",
    });
    expect(records[1]).toMatchObject({
      event: "provider.connected",
      operationId,
      outcome: "succeeded",
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(records)).not.toMatch(/private|token=|DO-NOT-LOG|fake-agent|command|cwd/);
  } finally {
    await session?.stop(0);
    await rm(directory, { recursive: true, force: true });
  }
});
it("reports missing executables and cancelled connection attempts without serializing errors or unknown providers", async () => {
  const records: LogInput[] = [];
  const agents = createAgents({ clientVersion: "test", log: (record) => records.push(record) });
  const spec = {
    name: "private-provider",
    command: ["missing-private-executable"] as [string],
    cwd: tmpdir(),
  };
  await expect(agents.start(spec)).rejects.toThrow();
  const abort = new AbortController();
  abort.abort();
  await expect(agents.start(spec, abort.signal)).rejects.toThrow();
  expect(records.map((record) => record.event)).toEqual([
    "provider.connect",
    "provider.connected",
    "provider.connect",
    "provider.connected",
  ]);
  expect(records[1]).toMatchObject({
    outcome: "failed",
    errorCategory: "transport",
    errorCode: "UNKNOWN",
  });
  expect(records[3]).toMatchObject({ outcome: "cancelled" });
  expect(records[0]?.operationId).not.toBe(records[2]?.operationId);
  expect(JSON.stringify(records)).not.toContain("private");
  expect(records.every((record) => record.provider === undefined)).toBe(true);
});
