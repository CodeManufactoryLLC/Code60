import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  DEFAULT_OPERATING_CONTRACT_CLAUSES,
  OPERATING_CONTRACT_CLAUSES,
  type PromptTemplateState,
} from "../bridge/index.js";
import { PromptEditorPage } from "./prompt-editor.js";

const prompt: PromptTemplateState = {
  id: "operatingContract",
  fields: [],
  template: DEFAULT_OPERATING_CONTRACT_CLAUSES,
  source: "built-in",
  fallback: DEFAULT_OPERATING_CONTRACT_CLAUSES,
  fallbackSource: "built-in",
};

it("exposes editing tools, source context and a labelled sample-only tab panel", () => {
  const html = renderToStaticMarkup(
    <PromptEditorPage
      prompts={[prompt]}
      busy={false}
      onSave={async () => true}
      onReset={async () => true}
    />,
  );

  expect(html).toContain(">Preview</button>");
  expect(html).toContain("<textarea");
  expect(html.match(/<textarea/g)).toHaveLength(13);
  for (const label of Object.values(OPERATING_CONTRACT_CLAUSES))
    expect(html).toContain(`>${label}</label>`);
  expect(html).toContain("Assembled Operating Contract");
  expect(html).toContain("Sample data only");
  expect(html).toContain("Search templates");
  expect(html).toContain("Compare with saved");
  expect(html).toContain("Word wrap");
  expect(html).toContain("Line numbers");
  expect(html).toContain("Source: Built-in");
  expect(html).toContain("Reset destination");
  expect(html).toContain('role="tablist"');
  expect(html).toContain('aria-selected="true"');
  expect(html).not.toContain("Preview with sample values");
  expect(html).not.toContain("MCP tool descriptions");
  expect(html).not.toContain("Input contract");
});
