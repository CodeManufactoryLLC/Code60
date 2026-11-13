import { join } from "node:path";
import {
  AutoModel,
  AutoTokenizer,
  env,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from "@huggingface/transformers";
import type { RagEmbedder } from "../core/index.js";

const RAG_MODEL = {
  id: "jinaai/jina-embeddings-v2-base-code",
  revision: "516f4baf13dec4ddddda8631e019b5737c8bc250",
  dimensions: 768,
  dtype: "q8",
} as const;

/** Only imported by the sidecar, never by Electron main or the renderer. */
export async function loadRagModel(root: string): Promise<RagEmbedder> {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.useFSCache = false;
  env.localModelPath = join(root, "/");
  const tokenizer: PreTrainedTokenizer = await AutoTokenizer.from_pretrained(RAG_MODEL.id);
  const model: PreTrainedModel = await AutoModel.from_pretrained(RAG_MODEL.id, {
    dtype: "q8",
    device: "cpu",
    session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
  });
  const countTokens = (text: string) => tokenizer.encode(text).length;
  const embed = async (texts: readonly string[]) => {
    for (const text of texts) {
      if (countTokens(text) > 512) throw new Error("Text exceeds the 512-token model input limit");
    }
    const input = tokenizer([...texts], { padding: true, truncation: false });
    const output = await model(input);
    const hidden = output.last_hidden_state;
    if (!hidden || hidden.dims[2] !== RAG_MODEL.dimensions)
      throw new Error("Unexpected bundled model output");
    const length = hidden.dims[1] ?? 0;
    const mask = input.attention_mask.data;
    return texts.map((_, batch) => {
      const vector = new Float32Array(RAG_MODEL.dimensions);
      let tokens = 0;
      for (let token = 0; token < length; token++) {
        if (!Number(mask[batch * length + token])) continue;
        tokens++;
        for (let dim = 0; dim < vector.length; dim++) {
          const i = (batch * length + token) * vector.length + dim;
          vector[dim] = (vector[dim] ?? 0) + Number(hidden.data[i]);
        }
      }
      if (!tokens) throw new Error("Empty embedding input");
      for (let dim = 0; dim < vector.length; dim++) vector[dim] = (vector[dim] ?? 0) / tokens;
      const norm = Math.hypot(...vector);
      if (!norm || !Number.isFinite(norm)) throw new Error("Invalid model embedding");
      for (let dim = 0; dim < vector.length; dim++) vector[dim] = (vector[dim] ?? 0) / norm;
      return vector;
    });
  };
  return {
    countTokens,
    embedDocuments: embed,
    embedQuery: async (text) => (await embed([text]))[0] as Float32Array,
  };
}
