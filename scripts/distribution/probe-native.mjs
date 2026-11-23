import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
const require = createRequire(join(root, "package.json"));
for (const name of ["vite", "vitest", "@playwright/test", "@devcontainers/cli"])
  assert.throws(() => require.resolve(name), { code: "MODULE_NOT_FOUND" });
globalThis.fetch = async () => {
  throw new Error("Network forbidden during payload model probe");
};
const { RawImage } = await import(pathToFileURL(require.resolve("@huggingface/transformers")).href);
const image = await RawImage.fromBlob(
  new Blob([Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64")], {
    type: "image/gif",
  }),
);
assert.equal(image.width, 1);
assert.equal(image.height, 1);
const { loadRagModel } = await import(
  pathToFileURL(join(root, "dist/application/rag-model.js")).href
);
const embedder = await loadRagModel(join(root, "models"));
const vector = await embedder.embedQuery("built payload offline CPU model");
assert.equal(vector.length, 768);
assert.ok([...vector].every(Number.isFinite));
assert.ok(Math.abs(Math.hypot(...vector) - 1) < 0.001);
console.log("Payload native CPU/image binaries and 768-dimensional offline model passed");
