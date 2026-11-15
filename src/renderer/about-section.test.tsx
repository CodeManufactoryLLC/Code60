import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { Versions } from "../bridge/index.js";
import { AboutSection } from "./about-section.js";

const versions: Versions = {
  code60: "0.2.1",
  databaseSchema: 5,
  runRecordFormat: 1,
  acpProtocol: 1,
  mcpProtocol: "2025-03-26",
  electron: null,
  chromium: null,
  node: "24.22.0",
  embeddingModel: {
    id: "jinaai/jina-embeddings-v2-base-code",
    revision: "516f4baf13dec4ddddda8631e019b5737c8bc250",
    dimensions: 768,
    dtype: "q8",
  },
  onnxRuntime: { name: "onnxruntime-node", version: "1.30.0", execution: "CPU, offline sidecar" },
};

it("shows configured model provenance and actual runtime details beside existing versions", () => {
  const html = renderToStaticMarkup(<AboutSection versions={versions} />);
  for (const [label, value] of [
    ["Embedding model", versions.embeddingModel?.id],
    ["Embedding revision", versions.embeddingModel?.revision],
    ["Embedding dimensions", 768],
    ["Embedding precision", "q8"],
    ["ONNX Runtime", "onnxruntime-node"],
    ["ONNX Runtime version", "1.30.0"],
    ["Embedding execution", "CPU, offline sidecar"],
  ])
    expect(html).toContain(`<dt>${label}</dt><dd>${value}</dd>`);
  expect(html).toContain("<dt>Code60</dt><dd>0.2.1</dd>");
  expect(html).not.toContain("model loaded");
});

it("handles older snapshots, absent runtime metadata and unavailable versions", () => {
  const { embeddingModel: _, onnxRuntime: __, ...older } = versions;
  const html = renderToStaticMarkup(<AboutSection versions={older} />);
  expect(html).toContain("<dt>Embedding model</dt><dd>Unavailable</dd>");
  expect(html).toContain("<dt>ONNX Runtime version</dt><dd>Unavailable</dd>");
  const missing = renderToStaticMarkup(<AboutSection versions={undefined} />);
  expect(missing).toContain('disabled=""');
  expect(missing).not.toContain("<dt>");
});
