import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { assertProviderStateSecretFree } from "./fixtures/provider-state-scan.js";

const roots: string[] = [];
const temporary = "00000000-0000-4000-8000-000000000000.tmp";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "code60 provider scan "));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("checks an atomic run-record publication again after backend shutdown", async () => {
  const root = await fixture();
  await writeFile(join(root, temporary), "PRIVATE-STATE");
  await assertProviderStateSecretFree(root, {
    live: true,
    beforeOpen: async (entry) => {
      if (entry === temporary) await rename(join(root, entry), join(root, "run.json"));
    },
  });
  expect(await readFile(join(root, "run.json"), "utf8")).toBe("PRIVATE-STATE");
  await expect(assertProviderStateSecretFree(root)).rejects.toMatchObject({
    code: "ERR_ASSERTION",
  });
});

it.each(["run.json", "unrecognized.tmp"])("does not hide a missing live %s", async (name) => {
  const root = await fixture();
  await writeFile(join(root, name), "safe");
  await expect(
    assertProviderStateSecretFree(root, {
      live: true,
      beforeOpen: async (entry) => unlink(join(root, entry)),
    }),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("requires stable UUID temporary files after shutdown", async () => {
  const root = await fixture();
  await writeFile(join(root, temporary), "safe");
  await expect(
    assertProviderStateSecretFree(root, {
      beforeOpen: async (entry) => unlink(join(root, entry)),
    }),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([true, false])("limits diagnostic lock disappearance to live scans: %s", async (live) => {
  const root = await fixture();
  await mkdir(join(root, "writer"));
  await writeFile(join(root, "writer/.lock"), "safe");
  const result = assertProviderStateSecretFree(root, {
    live,
    beforeOpen: async (entry) => {
      if (entry === "writer/.lock") await unlink(join(root, entry));
    },
  });
  if (live) await result;
  else await expect(result).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["QA60-1234", "QA60-PASTE", "PRIVATE-STATE"])(
  "still inspects live temporary file contents for %s",
  async (secret) => {
    const root = await fixture();
    await writeFile(join(root, temporary), secret);
    await expect(assertProviderStateSecretFree(root, { live: true })).rejects.toMatchObject({
      code: "ERR_ASSERTION",
    });
  },
);
