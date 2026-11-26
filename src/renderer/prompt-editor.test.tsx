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

it("renders Carbon controls, alphabetical domain sections, canonical IDs, and 13 clause sub-IDs", () => {
  const html = renderToStaticMarkup(
    <PromptEditorPage
      prompts={[prompt]}
      busy={false}
      onSave={async () => true}
      onReset={async () => true}
    />,
  );

  expect(html).toContain("cds--search");
  expect(html).toContain("cds--content-switcher");
  expect(html).toContain("cds--snippet--inline");
  expect(html).toContain("cds--tag");
  expect(html).toContain("cds--form");
  expect(html).toContain("Edit template");
  expect(html).toContain("Preview");
  expect(html).toContain("<textarea");
  expect(html.match(/<textarea/g)).toHaveLength(13);
  expect(html).toContain("contract.operating");
  expect(html).toContain("All (44)");
  expect(html).toContain("Editable (10)");
  expect(html).toContain("Read-only (34)");
  let previousDomainIndex = -1;
  for (const domain of PROMPT_DOMAINS) {
    const marker = `<span>${domain.label}</span>`;
    const index = html.indexOf(marker);
    expect(index).toBeGreaterThan(previousDomainIndex);
    previousDomainIndex = index;
  }
  const customAssistantIndex = html.indexOf("Custom Assistant wrapper");
  const operatingContractIndex = html.indexOf(">Operating Contract<");
  const relayAddendumIndex = html.indexOf("Relay operating addendum");
  expect(customAssistantIndex).toBeGreaterThan(-1);
  expect(operatingContractIndex).toBeGreaterThan(customAssistantIndex);
  expect(relayAddendumIndex).toBeGreaterThan(operatingContractIndex);

  const resetIndex = html.indexOf("Reset to default");
  const discardIndex = html.indexOf("Discard changes");
  const saveIndex = html.indexOf(">Save</button>");
  expect(resetIndex).toBeGreaterThan(-1);
  expect(discardIndex).toBeGreaterThan(resetIndex);
  expect(saveIndex).toBeGreaterThan(discardIndex);

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
