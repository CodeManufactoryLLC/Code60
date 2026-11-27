import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkC4Architecture, DEFAULT_STRUCTURIZR_IMAGE } from "../scripts/c4.mjs";

const tempDirs = [];

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "code60-c4-"));
  tempDirs.push(root);
  await mkdir(join(root, "architecture/structurizr/model"), { recursive: true });
  await mkdir(join(root, "architecture/structurizr/views"), { recursive: true });
  await mkdir(join(root, "src/alpha"), { recursive: true });
  await mkdir(join(root, "src/beta"), { recursive: true });
  return root;
}

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("C4 architecture static validation", () => {
  it("pins the default Structurizr Docker image by SHA-256 digest", () => {
    expect(DEFAULT_STRUCTURIZR_IMAGE).toMatch(
      /^structurizr\/structurizr:[^@]+@sha256:[a-f0-9]{64}$/,
    );
  });

  it("validates the live repository C4 DSL, module parity, and KB docs cleanly", async () => {
    expect(await checkC4Architecture()).toEqual([]);
  });

  it("passes on a well-formed modular DSL fixture matching src/ modules", async () => {
    const root = await createFixture();
    await writeFile(
      join(root, "architecture/structurizr/workspace.dsl"),
      [
        'workspace "Demo" {',
        "  model {",
        "    !include model/system.dsl",
        "  }",
        "  views {",
        "    !include views/views.dsl",
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(root, "architecture/structurizr/model/system.dsl"),
      [
        'demo = softwareSystem "Demo" {',
        '  a = container "Alpha" {',
        '    properties { src_module "alpha" }',
        "  }",
        '  b = container "Beta" {',
        '    properties { src_module "beta" }',
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(root, "architecture/structurizr/views/views.dsl"),
      'systemContext demo "demo-context" { include * }\n',
      "utf8",
    );
    expect(await checkC4Architecture(root)).toEqual([]);
  });

  it("detects missing includes, unbalanced braces, module drift, and duplicate view keys", async () => {
    const root = await createFixture();
    await writeFile(
      join(root, "architecture/structurizr/workspace.dsl"),
      [
        'workspace "Broken" {',
        "  model {",
        "    !include model/missing.dsl",
        '    properties { src_module "alpha" }',
        '    properties { src_module "ghost" }',
        "  }",
        "  views {",
        '    systemContext demo "dup-key" { include * }',
        '    container demo "dup-key" { include * }',
        "  }",
        "",
      ].join("\n"),
      "utf8",
    );

    const failures = await checkC4Architecture(root);
    expect(failures.some((f) => f.includes("Missing !include target"))).toBe(true);
    expect(failures.some((f) => f.includes("Unbalanced braces"))).toBe(true);
    expect(failures.some((f) => f.includes('Duplicate Structurizr view key "dup-key"'))).toBe(true);
    expect(failures.some((f) => f.includes('Source module "src/beta" is missing'))).toBe(true);
    expect(failures.some((f) => f.includes('Modeled src_module "ghost" does not exist'))).toBe(
      true,
    );
  });
});
