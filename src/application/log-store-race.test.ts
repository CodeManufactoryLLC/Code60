import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { parseLogQuery } from "../bridge/index.js";
import { DesktopLogStore, LOG_RETENTION_MS } from "./log-store.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(actual.open) };
});

it("refuses a substituted file handle before boundary retention can rewrite authoritative data", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const root = await realpath(await mkdtemp(join(tmpdir(), "code60-log-race-")));
  const start = Date.parse("2026-11-09T12:00:00Z");
  let time = start;
  const store = new DesktopLogStore(join(root, "code60", "logs"), () => time);
  try {
    store.sink({ event: "app.start", operationId: randomUUID(), outcome: "started" });
    expect(await store.flush(2000)).toBe(true);
    time += 1000;
    store.sink({ event: "app.ready", operationId: randomUUID(), outcome: "succeeded" });
    expect(await store.flush(2000)).toBe(true);
    const target = join(root, "authoritative-record.json");
    await writeFile(target, "must stay unchanged", { mode: 0o600 });
    let substituted = false;
    vi.mocked(open).mockImplementation((path, flags, mode) => {
      if (
        typeof path === "string" &&
        path.endsWith(".jsonl") &&
        typeof flags === "number" &&
        flags & constants.O_RDWR &&
        !(flags & constants.O_APPEND)
      ) {
        substituted = true;
        return actual.open(target, flags, mode);
      }
      return actual.open(path, flags, mode);
    });
    time = start + LOG_RETENTION_MS;
    await expect(store.query(parseLogQuery({}))).rejects.toThrow("Diagnostic logs unavailable");
    expect(substituted).toBe(true);
    expect(await readFile(target, "utf8")).toBe("must stay unchanged");
  } finally {
    vi.mocked(open).mockImplementation(actual.open);
    await store.close();
    await rm(root, { recursive: true, force: true });
  }
});
