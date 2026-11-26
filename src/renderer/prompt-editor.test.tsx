import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  DEFAULT_OPERATING_CONTRACT_CLAUSES,
  OPERATING_CONTRACT_CLAUSE_IDS,
  OPERATING_CONTRACT_CLAUSES,
  operatingContractClausePromptId,
  PROMPT_DOMAINS,
  type PromptTemplateState,
} from "../bridge/index.js";
import { PromptEditorPage } from "./prompt-editor.js";

const prompt: PromptTemplateState = {
  id: "contract.operating",
  fields: [],
  template: DEFAULT_OPERATING_CONTRACT_CLAUSES,
  source: "built-in",
  fallback: DEFAULT_OPERATING_CONTRACT_CLAUSES,
  fallbackSource: "built-in",
};

it("starts in the editor with canonical IDs, domain groups, 13 clause sub-IDs, and preview behind a toggle", () => {
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
  expect(html).toContain("contract.operating");
  expect(html).toContain("All (44)");
  expect(html).toContain("Editable (10)");
  expect(html).toContain("Read-only (34)");
  for (const domain of PROMPT_DOMAINS) expect(html).toContain(`<span>${domain.label}</span>`);
  for (const clause of OPERATING_CONTRACT_CLAUSE_IDS) {
    expect(html).toContain(`>${OPERATING_CONTRACT_CLAUSES[clause]}</label>`);
    expect(html).toContain(`>${operatingContractClausePromptId(clause)}</code>`);
  }
  expect(html).toContain("contract.relay-addendum");
  expect(html).toContain("plan.accepted.project");
  expect(html).not.toContain("Assembled Operating Contract");
  expect(html).not.toContain("Preview with sample values");
  expect(html).not.toContain("MCP tool descriptions");
  expect(html).not.toContain("Input contract");
});
