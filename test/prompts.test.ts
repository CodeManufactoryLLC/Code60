import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assembleOperatingContract,
  DEFAULT_OPERATING_CONTRACT_CLAUSES,
  DEFAULT_PROMPT_TEMPLATES,
  OPERATING_CONTRACT_CLAUSE_IDS,
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
    const contract = assembleOperatingContract(DEFAULT_PROMPT_TEMPLATES.operatingContract);
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
    expect(
      parseValue(promptTemplatesSchema, { operatingContract: DEFAULT_OPERATING_CONTRACT_CLAUSES }),
    ).toEqual({
      operatingContract: DEFAULT_OPERATING_CONTRACT_CLAUSES,
    });
    expect(parseValue(promptTemplatesSchema, { handoffTurn: "Hi {{message}}" })).toEqual({
      handoffTurn: "Hi {{message}}",
    });
    expect(() => parseValue(promptTemplatesSchema, { handoffTurn: "{{summary}}" })).toThrow(
      /prompts.handoffTurn: must include/,
    );
    expect(() => parseValue(promptTemplatesSchema, { other: "x" })).toThrow();
  });

  it("assembles the default contract exactly, regardless of object key order", () => {
    const original = readFileSync(
      new URL("./fixtures/operating-contract.txt", import.meta.url),
      "utf8",
    );
    const clauses = Object.fromEntries(
      Object.entries(DEFAULT_OPERATING_CONTRACT_CLAUSES).reverse(),
    ) as typeof DEFAULT_OPERATING_CONTRACT_CLAUSES;
    expect(OPERATING_CONTRACT_CLAUSE_IDS).toHaveLength(13);
    expect(assembleOperatingContract(clauses)).toBe(original.trimEnd());
  });

  it("preserves multiline clause boundaries and adds no labels to the assembled text", () => {
    const clauses = {
      ...DEFAULT_OPERATING_CONTRACT_CLAUSES,
      role: "First line.\nSecond line.",
      planning: "A custom planning rule.",
    };
    const contract = assembleOperatingContract(clauses);
    expect(contract.startsWith("First line.\nSecond line.\nInterpret")).toBe(true);
    expect(contract).toContain("\nA custom planning rule.\nCommunicate");
    expect(contract).not.toContain("Planning:");
  });

  it.each([
    null,
    [],
    "Legacy contract",
    {},
    { ...DEFAULT_OPERATING_CONTRACT_CLAUSES, role: undefined },
    { ...DEFAULT_OPERATING_CONTRACT_CLAUSES, extra: "Unknown clause" },
    { ...DEFAULT_OPERATING_CONTRACT_CLAUSES, role: "" },
    { ...DEFAULT_OPERATING_CONTRACT_CLAUSES, planning: "  " },
    { ...DEFAULT_OPERATING_CONTRACT_CLAUSES, planning: "{{message}}" },
    { ...DEFAULT_OPERATING_CONTRACT_CLAUSES, role: "{{invalid" },
    { ...DEFAULT_OPERATING_CONTRACT_CLAUSES, role: 123 },
  ])("rejects malformed contract clauses", (clauses) => {
    expect(validatePromptTemplate("operatingContract", clauses)).toBeTypeOf("string");
  });

  it("checks the assembled limit, including separators, at the exact boundary", () => {
    const clauses = Object.fromEntries(
      OPERATING_CONTRACT_CLAUSE_IDS.map((key) => [key, "x"]),
    ) as typeof DEFAULT_OPERATING_CONTRACT_CLAUSES;
    const base = assembleOperatingContract(clauses).length;
    const atLimit = { ...clauses, role: "x".repeat(PROMPT_TEMPLATE_LIMIT - base + 1) };
    expect(assembleOperatingContract(atLimit)).toHaveLength(PROMPT_TEMPLATE_LIMIT);
    expect(validatePromptTemplate("operatingContract", atLimit)).toBeUndefined();
    expect(
      validatePromptTemplate("operatingContract", { ...atLimit, role: `${atLimit.role}x` }),
    ).toMatch(/at most/);
  });
});
