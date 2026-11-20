import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { recordedAgentPid } from "./run-readiness.js";

it("waits through missing records and absent PIDs until the provider is recorded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "code60-run-readiness-"));
  try {
    const path = join(directory, "run.json");
    await expect(recordedAgentPid(path)).resolves.toBe(0);
    await writeFile(path, "{}");
    await expect(recordedAgentPid(path)).resolves.toBe(0);
    await writeFile(path, JSON.stringify({ agentPid: 12345 }));
    await expect(recordedAgentPid(path)).resolves.toBe(12345);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("does not turn corrupt records or other filesystem errors into pending readiness", async () => {
  const directory = await mkdtemp(join(tmpdir(), "code60-run-readiness-"));
  try {
    const path = join(directory, "run.json");
    await writeFile(path, "not JSON");
    await expect(recordedAgentPid(path)).rejects.toBeInstanceOf(SyntaxError);
    await expect(recordedAgentPid(directory)).rejects.toMatchObject({ code: "EISDIR" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
