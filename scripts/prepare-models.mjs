import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const model = {
  id: "jinaai/jina-embeddings-v2-base-code",
  revision: "516f4baf13dec4ddddda8631e019b5737c8bc250",
  dimensions: 768,
  dtype: "q8",
  license: "Apache-2.0",
};
export const assets = [
  ["config.json", 1216, "e426aa684c7f9a95c5f020aa855faf93a24f065f5fad0c9e17b124670cabdea6"],
  ["tokenizer.json", 2561316, "b01c78a902aa4facb2f47f95449f48e2f7bbfea5d2472ee2f6ce92323c6f86e5"],
  [
    "tokenizer_config.json",
    493,
    "f477aeb15ff9f78d3c1ddf2361d2b0b8b20cf55220f839f29a37f3a18efddd89",
  ],
  [
    "special_tokens_map.json",
    280,
    "06e405a36dfe4b9604f484f6a1e619af1a7f7d09e34a8555eb0b77b66318067f",
  ],
  ["README.md", 7439, "d3fcc84f4fa0b18b54e54a62171b7bb363109e776226edd02c96e105c097f494"],
  [
    "onnx/model_quantized.onnx",
    161895621,
    "ed45870251c9f0cf656e78aab0d37a23489066df8a222bb1c8caf8a45f2cb16d",
  ],
];
const root = fileURLToPath(new URL("../models/", import.meta.url));
async function verified(path, size, hash) {
  try {
    if ((await stat(path)).size !== size) return false;
    const digest = createHash("sha256");
    for await (const bytes of createReadStream(path)) digest.update(bytes);
    return digest.digest("hex") === hash;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
for (const [name, size, hash] of assets) {
  const path = resolve(root, model.id, name);
  if (await verified(path, size, hash)) continue;
  if (process.argv.includes("--verify"))
    throw new Error(`Missing or invalid bundled model: ${name}`);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.download`;
  try {
    const response = await fetch(
      `https://huggingface.co/${model.id}/resolve/${model.revision}/${name}`,
      { signal: AbortSignal.timeout(180_000) },
    );
    if (!response.ok || !response.body)
      throw new Error(`Model download failed: ${response.status}`);
    const file = await import("node:fs/promises").then((fs) => fs.open(temporary, "wx", 0o644));
    try {
      let count = 0;
      for await (const bytes of response.body) {
        count += bytes.length;
        if (count > size) throw new Error("Model download exceeded pinned size");
        await file.writeFile(bytes);
      }
    } finally {
      await file.close();
    }
    if (!(await verified(temporary, size, hash)))
      throw new Error(`Model checksum mismatch: ${name}`);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
await writeFile(
  resolve(root, "provenance.json"),
  `${JSON.stringify({ model, assets }, null, 2)}\n`,
);
console.log(
  `Verified offline model assets (${assets.reduce((sum, item) => sum + item[1], 0)} bytes)`,
);
