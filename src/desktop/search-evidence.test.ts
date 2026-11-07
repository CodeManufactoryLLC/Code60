import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFiles } from "./files.js";
import { projectSearchEvidence } from "./search-evidence.js";

let root: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "code60-search-evidence-")));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const signal = () => new AbortController().signal;

describe("project search evidence", () => {
  it("answers broad questions from documentation and ranks relevant file paths", async () => {
    await writeFile(join(root, "README.md"), "A color wheel for choosing accessible palettes.");
    await writeFile(join(root, "package.json"), '{"name":"color-wheel"}');
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "palette.ts"), "export function palette() {}");
    const overview = await projectSearchEvidence(root, "What is this project about?", signal());
    expect(overview[0]).toMatchObject({
      kind: "file",
      path: "README.md",
      text: "A color wheel for choosing accessible palettes.",
    });
    const focused = await projectSearchEvidence(root, "palette", signal());
    expect(focused[0]?.path).toBe("src/palette.ts");
  });

  it("skips generated directories, hidden files, lockfiles, binaries and known credential files", async () => {
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "node_modules", "leak.md"), "skip");
    for (const name of [".env", "credentials.json", "package-lock.json", "bundle.min.js"])
      await writeFile(join(root, name), "skip");
    await writeFile(join(root, "binary.ts"), Buffer.from([0, 1]));
    await writeFile(join(root, "README.md"), "read me");
    const sources = await projectSearchEvidence(root, "project", signal());
    expect(sources.map((source) => source.path)).toEqual(["README.md"]);
  });

  it.skipIf(process.platform === "win32")(
    "does not follow file or directory symlinks",
    async () => {
      await writeFile(join(root, "README.md"), "read me");
      await symlink(join(root, "README.md"), join(root, "link.md"));
      await symlink(root, join(root, "linked"));
      const sources = await projectSearchEvidence(root, "project", signal());
      expect(sources.map((source) => source.path)).toEqual(["README.md"]);
    },
  );

  it("bounds files read, sources and excerpt size", async () => {
    for (let index = 0; index < 40; index++)
      await writeFile(join(root, `sample-${index}.md`), `match ${"x".repeat(8000)}`);
    let previews = 0;
    const sources = await projectSearchEvidence(
      root,
      "match",
      signal(),
      async (context, current) => {
        if (context.preview) previews++;
        return readFiles(context, current);
      },
    );
    expect(previews).toBe(24);
    expect(sources).toHaveLength(10);
    expect(sources.every((source) => source.text.length <= 4000)).toBe(true);
  });

  it("handles empty projects and cancellation explicitly", async () => {
    expect(await projectSearchEvidence(root, "project", signal())).toEqual([]);
    const abort = new AbortController();
    abort.abort();
    await expect(projectSearchEvidence(root, "project", abort.signal)).rejects.toThrow();
  });
});
