import { execFile } from "node:child_process";
import { copyFile, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "vite";
import { expect, it } from "vitest";
import { parseLogQuery } from "../src/bridge/index.js";
import { DesktopLogStore } from "../src/desktop/log-store.js";
import { privateDirectory, windowsHelper } from "../src/platform/index.js";

it("independent processes share the private writer lock without losing accepted records", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "code60-log-processes-")));
  const store = new DesktopLogStore(join(directory, "code60", "logs"));
  try {
    // Bundle the production implementation, not a second implementation of its lock.
    const result = await build({
      configFile: false,
      logLevel: "silent",
      ssr: { noExternal: true },
      build: {
        ssr: resolve(import.meta.dirname, "../src/desktop/log-store.ts"),
        write: false,
        minify: false,
      },
    });
    const output = (Array.isArray(result) ? result[0] : result) as {
      output: { type: string; code?: string }[];
    };
    const code = output.output.find((chunk) => chunk.type === "chunk")?.code;
    expect(code).toBeTruthy();
    const bundle = join(directory, "store.mjs");
    await writeFile(bundle, code as string);
    if (process.platform === "win32") {
      await privateDirectory(join(directory, "resources", "native"));
      await copyFile(windowsHelper(), join(directory, "resources", "native", "code60-host.exe"));
    }
    const worker = `
      process.resourcesPath = ${JSON.stringify(join(directory, "resources"))};
      const { DesktopLogStore } = await import(${JSON.stringify(pathToFileURL(bundle).href)});
      const { randomUUID } = await import("node:crypto");
      const store = new DesktopLogStore(${JSON.stringify(store.directory)});
      for (let i=0; i<40; i++) store.sink({ event:"turn.end", operationId:randomUUID(), outcome:"succeeded", runId:process.argv[1]+i });
      if (!await store.flush(2000)) throw Error("flush exceeded bound");
      if (store.status().dropped || store.status().persistenceFailures) throw Error("capture failed");
      await store.close();
    `;
    await Promise.all(
      ["a", "b"].map((prefix) =>
        promisify(execFile)(process.execPath, ["--input-type=module", "-e", worker, prefix], {
          timeout: 15000,
        }),
      ),
    );
    const page = await store.query(parseLogQuery({}));
    expect(page.records).toHaveLength(80);
    expect(new Set(page.records.map((record) => record.id)).size).toBe(80);
    expect(new Set(page.records.map((record) => record.runId)).size).toBe(80);
    expect(page.status).toMatchObject({ dropped: 0, persistenceFailures: 0, malformed: 0 });
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 25000);
