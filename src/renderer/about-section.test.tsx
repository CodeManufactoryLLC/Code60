import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Versions } from "../bridge/index.js";
import { AboutSection } from "./about-section.js";
import type { PageAction } from "./content-page-header.js";

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

const captured = vi.hoisted(() => ({ actions: [] as readonly PageAction[] }));
vi.mock("./settings-layout.js", async (original) => {
  const actual = await original<typeof import("./settings-layout.js")>();
  return {
    ...actual,
    SettingsHeader: (props: Parameters<typeof actual.SettingsHeader>[0]) => {
      captured.actions = props.actions ?? [];
      return createElement(actual.SettingsHeader, props);
    },
  };
});

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
  expect(missing).toContain('aria-label="About actions"');
  expect(missing).not.toContain('aria-label="Copy version info"');
  expect(missing).not.toContain("<dt>");
  expect(captured.actions).toMatchObject([{ label: "Copy version info", disabled: true }]);
});
