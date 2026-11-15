/** Pinned configuration shared with the offline sidecar, without loading inference. */
export const BUNDLED_EMBEDDING_MODEL = {
  id: "jinaai/jina-embeddings-v2-base-code",
  revision: "516f4baf13dec4ddddda8631e019b5737c8bc250",
  dimensions: 768,
  dtype: "q8",
} as const;
