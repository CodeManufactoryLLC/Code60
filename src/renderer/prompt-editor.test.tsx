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

it("starts in the editor with preview behind a toggle and no tool-call section", () => {
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
  expect(html).not.toContain("Assembled Operating Contract");
  expect(html).not.toContain("Preview with sample values");
  expect(html).not.toContain("MCP tool descriptions");
  expect(html).not.toContain("Input contract");
});
