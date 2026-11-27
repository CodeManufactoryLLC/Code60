import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkKnowledgeBase, DOMAINS, findKnowledge, indexKnowledgeBase } from "../scripts/kb.mjs";

const tempDirs = [];

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "code60-kb-"));
  tempDirs.push(root);
  await mkdir(join(root, "knowledge"), { recursive: true });
  for (const domain of DOMAINS) {
    await mkdir(join(root, domain.path), { recursive: true });
  }
  await writeFile(
    join(root, "knowledge/INDEX.md"),
    "# Index\n\n<!-- BEGIN:KB_INDEX -->\n<!-- END:KB_INDEX -->\n",
    "utf8",
  );
  await writeFile(join(root, "knowledge/index.json"), "{}\n", "utf8");
  await writeFile(join(root, "knowledge/schema.json"), "{}\n", "utf8");
  await mkdir(join(root, "src/example"), { recursive: true });
  await writeFile(join(root, "src/example/mod.ts"), "export const ok = true;\n", "utf8");
  return root;
}

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

describe("knowledge base indexing and validation", () => {
  it("validates the live repository knowledge base cleanly", async () => {
    expect(await checkKnowledgeBase()).toEqual([]);
  });

  it("indexes valid documents, validates RFC 2119 stipulations, and supports lookup", async () => {
    const root = await createFixture();
    await writeFile(
      join(root, "knowledge/governance/sample.md"),
      [
        "---",
        "id: KB-GOV-001",
        "title: Sample Governance",
        "domain: governance",
        "kind: normative",
        "status: active",
        "summary: Sample normative policy for testing.",
        "updated: 2026-11-27",
        "rule_prefix: GOV",
        "code_refs:",
        "  - src/example/mod.ts",
        "tags:",
        "  - governance",
        "---",
        "",
        "# Sample Governance",
        "",
        "## 1. Rules",
        "",
        "### 1.1 Basics",
        "",
        "- `GOV-1.1.1` Authors MUST keep indexes synchronized.",
        "- `GOV-1.1.2` Authors SHOULD reference canonical IDs.",
        "",
      ].join("\n"),
      "utf8",
    );

    const indexed = await indexKnowledgeBase(root);
    expect(indexed.count).toBe(1);
    expect(await checkKnowledgeBase(root)).toEqual([]);

    const manifest = JSON.parse(await readFile(join(root, "knowledge/index.json"), "utf8"));
    expect(manifest.documents[0]).toMatchObject({
      id: "KB-GOV-001",
      ruleIds: ["GOV-1.1.1", "GOV-1.1.2"],
    });

    expect((await findKnowledge("GOV-1.1.2", root)).map((d) => d.id)).toEqual(["KB-GOV-001"]);
    expect((await findKnowledge("src/example/mod.ts", root)).map((d) => d.id)).toEqual([
      "KB-GOV-001",
    ]);

    await writeFile(
      join(root, "knowledge/INDEX.md"),
      "# Index\n\n<!-- BEGIN:KB_INDEX -->\nstale\n<!-- END:KB_INDEX -->\n",
      "utf8",
    );
    const drift = await checkKnowledgeBase(root);
    expect(drift.some((line) => line.includes("out of date"))).toBe(true);
  });

  it("rejects bad frontmatter, broken code_refs, RFC 2119 violations, and legacy capabilities.md", async () => {
    const root = await createFixture();
    await mkdir(join(root, "src/contracts"), { recursive: true });
    await writeFile(join(root, "src/contracts/knowledge.ts"), "export {};\n", "utf8");
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "docs/capabilities.md"), "# stale\n", "utf8");
    await writeFile(
      join(root, "knowledge/governance/bad.md"),
      [
        "---",
        "id: KB-ARCH-001",
        "title: Mismatched",
        "domain: architecture",
        "kind: normative",
        "status: active",
        "summary: Bad doc.",
        "updated: 2026-11-27",
        "rule_prefix: GOV",
        "code_refs:",
        "  - src/missing.ts",
        "related:",
        "  - KB-REF-999",
        "---",
        "",
        "### 1.1 Broken",
        "",
        "- `GOV-1.1.2` This lacks an uppercase keyword and must fail.",
        "",
      ].join("\n"),
      "utf8",
    );

    const failures = await checkKnowledgeBase(root);
    expect(failures.some((f) => f.includes("does not match folder domain code"))).toBe(true);
    expect(
      failures.some((f) => f.includes('Missing or unsafe code_refs path "src/missing.ts"')),
    ).toBe(true);
    expect(failures.some((f) => f.includes('related ID "KB-REF-999" does not exist'))).toBe(true);
    expect(failures.some((f) => f.includes("out of sequence"))).toBe(true);
    expect(failures.some((f) => f.includes("lacks an RFC 2119 keyword"))).toBe(true);
    expect(failures.some((f) => f.includes("Lowercase RFC 2119 keyword"))).toBe(true);
    expect(failures.some((f) => f.includes("Legacy capabilities path must not exist"))).toBe(true);
    expect(failures.some((f) => f.includes("Missing generated capability reference"))).toBe(true);
  });
});
