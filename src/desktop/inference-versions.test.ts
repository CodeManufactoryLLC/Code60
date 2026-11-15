import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { BUNDLED_EMBEDDING_MODEL } from "./embedding-model-info.js";

const metadata = vi.hoisted(() => ({
  load: vi.fn(),
  resolve: vi.fn(() => "/installed/transformers/dist/transformers.node.cjs"),
}));
vi.mock("node:module", () => ({
  createRequire: vi.fn(() => Object.assign(metadata.load, { resolve: metadata.resolve })),
}));
afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

it("matches the independently pinned preparation manifest without loading a model", () => {
  const preparation = readFileSync(
    new URL("../../scripts/prepare-models.mjs", import.meta.url),
    "utf8",
  );
  for (const [key, value] of Object.entries(BUNDLED_EMBEDDING_MODEL))
    expect(preparation).toContain(`${key}: ${typeof value === "string" ? `"${value}"` : value}`);
});

it.each([{ version: "1.30.0" }, { version: "" }, {}, null, { version: 42 }])(
  "reads only the actual Transformers dependency package metadata (%j)",
  async (manifest) => {
    metadata.load.mockReturnValue(manifest);
    const { INFERENCE_VERSIONS } = await import("./inference-versions.js");
    expect(INFERENCE_VERSIONS.embeddingModel).toEqual(BUNDLED_EMBEDDING_MODEL);
    expect(INFERENCE_VERSIONS.onnxRuntime).toEqual({
      name: "onnxruntime-node",
      version: manifest?.version === "1.30.0" ? "1.30.0" : null,
      execution: "CPU, offline sidecar",
    });
    expect(metadata.resolve).toHaveBeenCalledWith("@huggingface/transformers");
    expect(metadata.load).toHaveBeenCalledExactlyOnceWith("onnxruntime-node/package.json");
  },
);

it("keeps About available when runtime package metadata cannot be read", async () => {
  metadata.load.mockImplementation(() => {
    throw new Error("Missing optional installation");
  });
  const { INFERENCE_VERSIONS } = await import("./inference-versions.js");
  expect(INFERENCE_VERSIONS.onnxRuntime.version).toBeNull();
  expect(INFERENCE_VERSIONS.embeddingModel.id).toBe("jinaai/jina-embeddings-v2-base-code");
});
