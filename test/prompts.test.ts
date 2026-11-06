import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROMPT_TEMPLATES,
  PROMPT_IDS,
  PROMPT_TEMPLATE_LIMIT,
  parseValue,
  promptTemplatesSchema,
  renderPrompt,
  validatePromptTemplate,
} from "../src/contracts/index.js";

describe("prompt templates", () => {
  it("accepts every built-in template", () => {
    for (const id of PROMPT_IDS) {
      expect(validatePromptTemplate(id, DEFAULT_PROMPT_TEMPLATES[id])).toBeUndefined();
    }
  });

  it("fills merge fields, allowing spaces inside the braces", () => {
    expect(
      renderPrompt("handoffTurn", "A {{summary}} B {{ message }}", { summary: "s", message: "m" }),
    ).toBe("A s B m");
  });

  it("never expands placeholders or replacement patterns inside inserted values", () => {
    expect(
      renderPrompt("handoffTurn", "{{summary}}|{{message}}", {
        summary: "{{message}} $& $1",
        message: "{{summary}}",
      }),
    ).toBe("{{message}} $& $1|{{summary}}");
  });

  it("refuses to render a field the template does not allow", () => {
    expect(() =>
      renderPrompt("handoffTurn", "{{status}} {{message}}", { summary: "", message: "" }),
    ).toThrow(/unknown merge field 'status'/);
  });

  it.each([
    ["handoffTurn", "", /must not be empty/],
    ["handoffTurn", "x".repeat(PROMPT_TEMPLATE_LIMIT + 1), /at most/],
    ["handoffTurn", "{{summary}}", /must include \{\{message\}\}/],
    ["workerUpdates", "Worker update", /must include \{\{updates\}\}/],
    ["workerUpdates", "{{message}}", /unknown merge field 'message'/],
    ["handoffSummary", "{{prompts}} {{nope}}", /unknown merge field 'nope'/],
    ["handoffSummary", "{{message}}", /unknown merge field 'message'/],
    ["handoffSummary", "{{prompts}} {{ unclosed", /malformed merge field/],
    ["handoffSummary", "{{ 1bad }}", /malformed merge field/],
  ] as const)("rejects %s template %j", (id, template, error) => {
    expect(validatePromptTemplate(id, template)).toMatch(error);
  });

  it("validates overrides by template ID", () => {
    expect(parseValue(promptTemplatesSchema, { operatingContract: "Code60 role" })).toEqual({
      operatingContract: "Code60 role",
    });
    expect(parseValue(promptTemplatesSchema, { handoffTurn: "Hi {{message}}" })).toEqual({
      handoffTurn: "Hi {{message}}",
    });
    expect(() => parseValue(promptTemplatesSchema, { handoffTurn: "{{summary}}" })).toThrow(
      /prompts.handoffTurn: must include/,
    );
    expect(() => parseValue(promptTemplatesSchema, { other: "x" })).toThrow();
  });
});
