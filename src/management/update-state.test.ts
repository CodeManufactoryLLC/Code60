import { randomUUID } from "node:crypto";
import { chmod, link, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { InstallationRecord } from "./install-state.js";
import { readUpdateProgress, type UpdateRecord, writeUpdateProgress } from "./update-state.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "code60 progress spaces ")));
  roots.push(root);
  const record: InstallationRecord = {
    schema: 1,
    id: randomUUID(),
    root,
    home: root,
    bin: join(root, "bin"),
    launcher: join(root, "bin/code60"),
  };
  const value: UpdateRecord = {
    schema: 1,
    installationId: record.id,
    attempt: randomUUID(),
    previous: { generation: randomUUID(), version: "0.4.1", sha256: "a".repeat(64) },
    candidate: null,
    phase: "checking",
    outcome: "running",
  };
  return { root, record, value, path: join(root, "update.json") };
}
it("reads without creating progress and publishes private bounded compare-and-swap records", async () => {
  const f = await fixture();
  expect(await readUpdateProgress(f.record)).toBeNull();
  await expect(readFile(f.path)).rejects.toMatchObject({ code: "ENOENT" });
  const first = await writeUpdateProgress(f.record, f.value, null);
  expect(first.identity.mode).toBe(0o600);
  const completed = await writeUpdateProgress(
    f.record,
    { ...f.value, phase: "aborted", outcome: "complete" },
    first,
  );
  expect((await readUpdateProgress(f.record))?.value).toEqual(completed.value);
  await expect(writeUpdateProgress(f.record, f.value, first)).rejects.toThrow(
    "changed since preview",
  );
  expect(await readFile(f.path, "utf8")).toContain('"phase":"aborted"');
});
it.each([
  "installation",
  "generation",
  "candidate",
  "candidate-generation",
  "phase",
  "outcome",
  "terminal",
  "hash",
  "version",
  "null",
])("rejects invalid/uncertain update progress (%s) without changing evidence", async (mode) => {
  const f = await fixture();
  const value = structuredClone(f.value);
  if (mode === "installation") value.installationId = randomUUID();
  if (mode === "generation") value.previous.generation = "../../unowned";
  if (mode === "candidate") value.phase = "acquiring";
  if (mode === "candidate-generation") {
    value.phase = "prepared";
    value.candidate = { generation: null, version: "0.5.0", sha256: "b".repeat(64) };
  }
  if (mode === "phase") Object.assign(value, { phase: "unknown" });
  if (mode === "outcome") Object.assign(value, { outcome: "unknown" });
  if (mode === "terminal") value.phase = "ready";
  if (mode === "hash") value.previous.sha256 = "unsafe";
  if (mode === "version") value.previous.version = "latest";
  const bytes = JSON.stringify(mode === "null" ? null : value);
  await writeFile(f.path, bytes, { mode: 0o600 });
  await expect(readUpdateProgress(f.record)).rejects.toThrow();
  expect(await readFile(f.path, "utf8")).toBe(bytes);
});
it.each(["symlink", "hardlink", "permissions", "size"])(
  "refuses unsafe progress storage (%s)",
  async (mode) => {
    const f = await fixture();
    const other = join(f.root, "other.json");
    await writeFile(other, JSON.stringify(f.value), { mode: 0o600 });
    if (mode === "symlink") await symlink(other, f.path);
    else if (mode === "hardlink") await link(other, f.path);
    else {
      await writeFile(f.path, mode === "size" ? "x".repeat(16_385) : JSON.stringify(f.value), {
        mode: 0o600,
      });
      if (mode === "permissions") await chmod(f.path, 0o644);
    }
    await expect(readUpdateProgress(f.record)).rejects.toThrow();
    expect(await readFile(other, "utf8")).toBe(JSON.stringify(f.value));
  },
);
