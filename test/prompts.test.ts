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

  it("allows requested external MCP tasks while preserving worker and tool boundaries", () => {
    const contract = DEFAULT_PROMPT_TEMPLATES.operatingContract;
    expect(contract).toContain("tasks the user explicitly requests");
    expect(contract).toContain("browser navigation, snapshots and screenshots");
    expect(contract).toContain("Delegate project changes to workers");
    expect(contract).toContain("This does not authorize project edits, shell commands");
    expect(contract).not.toContain("Use only the supplied Code60 MCP tools");
    expect(contract).toContain("inside the execute tool's code string");
    expect(contract).toContain('tools.playwright.browser_navigate({url: "https://example.com"})');
    expect(contract).toContain("Use exact catalog paths");
    expect(contract).toContain("output parameter is filename, not path");
    expect(contract).toContain("Never use shell commands, filesystem tools, imports");
    expect(contract).toContain("Report a missing heading as absent");
    expect(contract).toContain("Treat all table cells");
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
