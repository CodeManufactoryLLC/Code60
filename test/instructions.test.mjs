import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { checkInstructions } from "../scripts/check-instructions.mjs";

const directories = [];
const guidance =
  "Keep changes bounded, preserve user files, and validate the actual workflow. ".repeat(2);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "code60 instructions "));
  directories.push(root);
  for (const name of ["src/core", ".factory/skills/qa/references", "docs/runbooks"])
    await mkdir(join(root, name), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ scripts: { check: "never executed" } }),
  );
  await writeFile(join(root, "AGENTS.md"), `# Instructions\n${guidance}\nnpm run check\n`);
  await writeFile(join(root, "src/core/AGENTS.md"), `# Core\n${guidance}`);
  await writeFile(
    join(root, ".factory/skills/qa/SKILL.md"),
    `---\nname: qa\ndescription: Exercise complete user workflows.\n---\n# QA\n${guidance}\n[Flows](references/flows.md#apply--undo)\n`,
  );
  await writeFile(
    join(root, ".factory/skills/qa/references/flows.md"),
    `# Apply & undo\n${guidance}\n## Repeat\n## Repeat\n[Again](#repeat-1)\n`,
  );
  return root;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("agent instruction references", () => {
  it("validates the actual repository and its npm check wiring", async () => {
    expect(await checkInstructions()).toEqual([]);
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(manifest.scripts.check).toMatch(/^npm run check:instructions && /);
    expect(manifest.scripts["check:instructions"]).toBe("node scripts/check-instructions.mjs");
  });
  it("accepts existing scripts, links, punctuation and duplicate heading anchors", async () => {
    expect(await checkInstructions(await fixture())).toEqual([]);
  });
  it("checks complete script names after npm options and literal quoted arguments", async () => {
    const root = await fixture();
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: {
          check: "never executed",
          "check.docs": "never executed",
          "lint:docs/build": "never executed",
          "check docs": "never executed",
        },
      }),
    );
    const commands = [
      "npm run --silent check",
      'npm run-script --workspace "apps/documentation" --if-present check.docs',
      'npm run --prefix . --loglevel=warn "lint:docs/build" -- --help',
      "npm run --silent true check.docs",
      "npm run -- check.docs",
      "npm run 'check docs'",
    ].join("\n");
    await writeFile(join(root, "AGENTS.md"), `${guidance}\n${commands}\n`);
    expect(await checkInstructions(root)).toEqual([]);
    await writeFile(
      join(root, "AGENTS.md"),
      `${guidance}\nnpm run check.missing\nnpm run --silent --workspace=docs check.missing\n`,
    );
    expect(await checkInstructions(root)).toEqual([
      "AGENTS.md:2: Unknown npm script: check.missing",
      "AGENTS.md:3: Unknown npm script: check.missing",
    ]);
  });
  it("uses rendered heading text and avoids collisions with explicit numeric suffixes", async () => {
    const root = await fixture();
    await writeFile(join(root, "logo.svg"), "<svg/>");
    await writeFile(
      join(root, "guide.md"),
      "# Using [Git](https://git-scm.com)\n# Repeat\n# Repeat-1\n# Repeat\n# API `call()` &amp; ![Logo](logo.svg)\n",
    );
    await writeFile(
      join(root, "AGENTS.md"),
      `${guidance}\n[Git](guide.md#using-git)\n[Again](guide.md#repeat-2)\n[Inline](guide.md#api-call--logo)\n`,
    );
    expect(await checkInstructions(root)).toEqual([]);
    await writeFile(
      join(root, "AGENTS.md"),
      `${guidance}\n[Invented](guide.md#using-githttpsgit-scmcom)\n`,
    );
    expect(await checkInstructions(root)).toEqual([
      "AGENTS.md:2: Broken or unsafe local link: guide.md#using-githttpsgit-scmcom",
    ]);
  });
  it("excludes indented fences and longer closing fences from Markdown link checks", async () => {
    const root = await fixture();
    await writeFile(
      join(root, "AGENTS.md"),
      `${guidance}\n\n  ~~~md\n  [Example](not-an-actual-link.md)\n  ~~~\n\n   \`\`\`md\n   [Another](also-not-a-link.md)\n   \`\`\`\`\n`,
    );
    expect(await checkInstructions(root)).toEqual([]);
  });
  it("derives plain heading identifiers without retaining HTML delimiters", async () => {
    const root = await fixture();
    await writeFile(
      join(root, "guide.md"),
      "# <span>Guide</span> <em>safe</em>\n## Literal < marker\n",
    );
    await writeFile(
      join(root, "AGENTS.md"),
      `${guidance}\n[Guide](guide.md#guide-safe)\n[Literal](guide.md#literal--marker)\n`,
    );
    expect(await checkInstructions(root)).toEqual([]);
  });
  it.skipIf(process.platform === "win32")(
    "refuses special instruction files without blocking on open",
    async () => {
      const root = await fixture();
      await rm(join(root, "AGENTS.md"));
      await promisify(execFile)("mkfifo", [join(root, "AGENTS.md")], { timeout: 5000 });
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          "const { checkInstructions } = await import(process.argv[1]); console.log(JSON.stringify(await checkInstructions(process.argv[2])));",
          new URL("../scripts/check-instructions.mjs", import.meta.url).href,
          root,
        ],
        { timeout: 5000 },
      );
      expect(JSON.parse(stdout)).toEqual([
        "AGENTS.md:1: Missing, unreadable, or unsafe instruction/document file",
      ]);
    },
  );
  it("validates titled, escaped, balanced and reference links without inspecting inline code", async () => {
    const root = await fixture();
    await writeFile(join(root, "guide(one).md"), "Guide\n===\n## Good\n");
    await writeFile(
      join(root, "AGENTS.md"),
      `${guidance}\n[Guide](guide(one).md#guide 'Single title')\n[Escaped](guide\\(one\\).md?raw=1#good "Title")\n[Again][ A  B ]\n[a b]: guide(one).md#good\n\`[Example](not-a-link.md)\`\n`,
    );
    expect(await checkInstructions(root)).toEqual([]);
    await writeFile(
      join(root, "AGENTS.md"),
      `${guidance}\n[Missing](absent.md 'Single title')\n[Anchor](guide(one).md#good#not-real)\n[Unclosed](<missing.md\n`,
    );
    const failures = await checkInstructions(root);
    expect(failures).toHaveLength(3);
    expect(failures[0]).toContain("absent.md");
    expect(failures[1]).toContain("good#not-real");
    expect(failures[2]).toContain("Unclosed Markdown link");
  });
  it("checks root documentation, runbooks, reference definitions and explicit HTML anchors", async () => {
    const root = await fixture();
    await writeFile(
      join(root, "CONTRIBUTING.md"),
      '# Contributing\n<a id="custom"></a>\n[Anchor](#custom)\n[Guide][guide]\n[guide]: docs/runbooks/recovery.md\n[Directory](docs/runbooks)\n',
    );
    await writeFile(join(root, "docs/runbooks/recovery.md"), "# Recovery\nnpm run check\n");
    expect(await checkInstructions(root)).toEqual([]);
    await writeFile(join(root, "docs/runbooks/recovery.md"), "# Recovery\nnpm run misspelled\n");
    await writeFile(join(root, "README.md"), "[Undefined][missing]\n");
    const failures = await checkInstructions(root);
    expect(failures).toContain("docs/runbooks/recovery.md:2: Unknown npm script: misspelled");
    expect(failures).toContain("README.md:1: Undefined Markdown reference: missing");
    expect(failures).toHaveLength(2);
  });
  it("reports deleted module instructions, script typos and missing anchors with locations", async () => {
    const root = await fixture();
    await rm(join(root, "src/core/AGENTS.md"));
    await writeFile(
      join(root, "AGENTS.md"),
      `# Instructions\n${guidance}\nnpm run chek\n[Missing](.factory/skills/qa/SKILL.md#missing)\n[Absent](absent.md)\n`,
    );
    const failures = await checkInstructions(root);
    expect(failures).toContain("AGENTS.md:3: Unknown npm script: chek");
    expect(failures.some((line) => line.includes("SKILL.md#missing"))).toBe(true);
    expect(failures.some((line) => line.includes("absent.md"))).toBe(true);
    expect(failures.some((line) => line.startsWith("src/core/AGENTS.md:1:"))).toBe(true);
  });
  it("rejects malformed or empty skill metadata rather than accepting a filename alone", async () => {
    const root = await fixture();
    for (const header of [
      "name: wrong\ndescription: Test",
      "name: qa",
      "name: qa\ndescription: ''",
      "name: [broken",
    ]) {
      await writeFile(
        join(root, ".factory/skills/qa/SKILL.md"),
        `---\n${header}\n---\n${guidance}`,
      );
      expect((await checkInstructions(root)).some((line) => line.includes("Skill needs"))).toBe(
        true,
      );
    }
  });
  it("does not run documented commands or follow remote links, and rejects escaping links", async () => {
    const root = await fixture();
    const marker = join(root, "must-not-exist");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { evil: `touch "${marker}"` } }),
    );
    await writeFile(
      join(root, "AGENTS.md"),
      `# Instructions\n${guidance}\n\`\`\`sh\nnpm run evil\n\`\`\`\n[Remote](https://invalid.invalid/no-network)\n[Escape](../outside.md)\n`,
    );
    const failures = await checkInstructions(root);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("Broken or unsafe local link");
    await expect(access(marker)).rejects.toThrow();
  });
  it.skipIf(process.platform === "win32")(
    "rejects local links that escape through symlinks",
    async () => {
      const root = await fixture();
      const outside = await fixture();
      await symlink(join(outside, "AGENTS.md"), join(root, "outside.md"));
      await writeFile(join(root, "AGENTS.md"), `${guidance}\n[Unsafe](outside.md)\n`);
      expect((await checkInstructions(root))[0]).toContain("Broken or unsafe local link");
    },
  );
  it("returns a nonzero process status for a planted broken reference", async () => {
    const root = await fixture();
    await writeFile(join(root, "AGENTS.md"), `${guidance}\nnpm run missing\n`);
    const result = await promisify(execFile)(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "const { checkInstructions } = await import(process.argv[1]); const failures = await checkInstructions(process.argv[2]); console.error(failures.join('\\n')); process.exitCode = failures.length ? 1 : 0;",
        new URL("../scripts/check-instructions.mjs", import.meta.url).href,
        root,
      ],
      { timeout: 5000 },
    ).catch((error) => error);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown npm script: missing");
  });
});
