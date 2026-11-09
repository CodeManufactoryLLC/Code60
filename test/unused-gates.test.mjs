import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const config = JSON.parse(await readFile(join(root, "knip.json"), "utf8"));
describe("unused-code gate entry points", () => {
  it("models launched sidecars, preload, fixtures and manual assets tooling without including generated output", () => {
    for (const path of [
      "src/cli/main.ts",
      "src/desktop/main.ts",
      "src/desktop/preload.cts",
      "src/desktop/mcp-server.ts",
      "scripts/generate-icon.mjs",
      "test/fixtures/fake-agent.mjs",
      "test/fixtures/packaged-agent.mjs",
      "test/fixtures/fake-docker.mjs",
    ])
      expect(config.entry).toContain(path);
    for (const glob of config.project)
      expect(glob).not.toMatch(/^(dist|coverage|release|native\/win32)/);
    expect(config).not.toHaveProperty("ignoreIssues");
    expect(config).not.toHaveProperty("ignoreExportsUsedInFile");
  });
  it("discovers the renderer through Vite's real HTML entry", async () => {
    expect(await readFile(join(root, "vite.config.ts"), "utf8")).toContain(
      'new URL("./src/renderer", import.meta.url)',
    );
    expect(await readFile(join(root, "src/renderer/index.html"), "utf8")).toContain(
      'src="./main.tsx"',
    );
  });
  it("finds orphan files, exports and dependencies while retaining dynamically launched entries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "code60-knip-"));
    const put = async (path, content) => {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), content);
    };
    try {
      await put(
        "package.json",
        JSON.stringify({
          name: "fixture",
          type: "module",
          dependencies: { "unused-dependency": "1.0.0" },
        }),
      );
      await put("knip.json", JSON.stringify({ entry: config.entry, project: config.project }));
      for (const path of config.entry.filter((path) => !path.includes("*")))
        await put(path, "console.log('entry');");
      await put("src/cli/main.ts", 'import {used} from "../core/shared.js"; console.log(used);');
      await put("src/core/shared.ts", "export const used = 1; export const orphan = 2;");
      await put("src/core/dead.ts", "export const unused = true;");
      const result = await promisify(execFile)(
        process.execPath,
        [join(root, "node_modules/knip/bin/knip.js"), "--reporter", "json", "--no-config-hints"],
        { cwd: directory, timeout: 15000 },
      ).catch((error) => error);
      expect(result.code).toBe(1);
      const issues = JSON.parse(result.stdout).issues;
      expect(issues.flatMap((issue) => issue.files).map((entry) => entry.name)).toEqual([
        "src/core/dead.ts",
      ]);
      expect(issues.flatMap((issue) => issue.exports).map((entry) => entry.name)).toEqual([
        "orphan",
      ]);
      expect(issues.flatMap((issue) => issue.dependencies).map((entry) => entry.name)).toEqual([
        "unused-dependency",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20000);
});
