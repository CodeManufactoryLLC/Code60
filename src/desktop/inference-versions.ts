import { createRequire } from "node:module";
import type { Versions } from "../bridge/index.js";
import { BUNDLED_EMBEDDING_MODEL } from "./embedding-model-info.js";

function runtimeVersion(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const fromTransformers = createRequire(require.resolve("@huggingface/transformers"));
    const manifest: unknown = fromTransformers("onnxruntime-node/package.json");
    return typeof manifest === "object" &&
      manifest !== null &&
      "version" in manifest &&
      typeof manifest.version === "string" &&
      manifest.version.trim()
      ? manifest.version
      : null;
  } catch {
    return null;
  }
}

/** Package JSON only: never import the native runtime or initialize/download a model. */
export const INFERENCE_VERSIONS = {
  embeddingModel: BUNDLED_EMBEDDING_MODEL,
  onnxRuntime: {
    name: "onnxruntime-node",
    version: runtimeVersion(),
    execution: "CPU, offline sidecar",
  },
} satisfies Pick<Versions, "embeddingModel" | "onnxRuntime">;
