import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assembleOperatingContract,
  DEFAULT_OPERATING_CONTRACT_CLAUSES,
  DEFAULT_PROMPT_TEMPLATES,
  findPromptCatalogEntry,
  INTERNAL_PROMPT_IDS,
  OPERATING_CONTRACT_CLAUSE_IDS,
  operatingContractClausePromptId,
  PROMPT_CATALOG,
  PROMPT_DOMAINS,
  PROMPT_ID_PATTERN,
  PROMPT_IDS,
  PROMPT_TEMPLATE_LIMIT,
  parseValue,
  promptTemplatesSchema,
  READONLY_PROMPT_IDS,
  renderPrompt,
  validatePromptTemplate,
} from "../src/contracts/index.js";

describe("prompt catalog and canonical IDs", () => {
  it("gives every internal prompt and contract clause a unique, user-readable dotted ID", () => {
    expect(PROMPT_IDS).toHaveLength(10);
    expect(READONLY_PROMPT_IDS).toHaveLength(34);
    expect(INTERNAL_PROMPT_IDS).toHaveLength(44);
    expect(PROMPT_CATALOG).toHaveLength(44);

    const unique = new Set<string>(INTERNAL_PROMPT_IDS);
    expect(unique.size).toBe(44);

    for (const id of INTERNAL_PROMPT_IDS) {
      expect(id).toMatch(PROMPT_ID_PATTERN);
      expect(findPromptCatalogEntry(id)?.id).toBe(id);
    }

    const clauseIds = OPERATING_CONTRACT_CLAUSE_IDS.map((clause) =>
      operatingContractClausePromptId(clause),
    );
    expect(clauseIds).toHaveLength(13);
    expect(clauseIds).toContain("contract.operating.untrusted-data");
    for (const id of clauseIds) {
      expect(id).toMatch(PROMPT_ID_PATTERN);
      expect(unique.has(id)).toBe(false);
    }

    const editable = PROMPT_CATALOG.filter((entry) => entry.editable).map((entry) => entry.id);
    const readonly = PROMPT_CATALOG.filter((entry) => !entry.editable).map((entry) => entry.id);
    expect(new Set(editable)).toEqual(new Set(PROMPT_IDS));
    expect(new Set(readonly)).toEqual(new Set(READONLY_PROMPT_IDS));

    const domains = new Set(PROMPT_DOMAINS.map((domain) => domain.id));
    const domainLabels = PROMPT_DOMAINS.map((domain) => domain.label);
    expect(domainLabels).toEqual([...domainLabels].sort((a, b) => a.localeCompare(b)));
    for (const entry of PROMPT_CATALOG) {
      expect(domains.has(entry.domain)).toBe(true);
      expect(entry.id.startsWith(`${entry.domain}.`)).toBe(true);
      if (!entry.editable) {
        expect(entry.readOnlyReason.trim().length).toBeGreaterThan(0);
        expect(entry.builtInText.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("prompt templates", () => {
  it("accepts every built-in editable template", () => {
    for (const id of PROMPT_IDS) {
      expect(validatePromptTemplate(id, DEFAULT_PROMPT_TEMPLATES[id])).toBeUndefined();
    }
  });

  it("allows requested external MCP tasks while preserving worker and tool boundaries", () => {
    const contract = assembleOperatingContract(DEFAULT_PROMPT_TEMPLATES["contract.operating"]);
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
      renderPrompt("handoff.first-turn", "A {{summary}} B {{ message }}", {
        summary: "s",
        message: "m",
      }),
    ).toBe("A s B m");
    expect(renderPrompt("plan.accepted.project", "Run plan {{ planId }}.", { planId: "p-1" })).toBe(
      "Run plan p-1.",
    );
    expect(
      renderPrompt("review.conflict-revision.project", "Fix {{conflicts}} in {{project}}", {
        conflicts: "a.ts",
        project: '"/repo"',
      }),
    ).toBe('Fix a.ts in "/repo"');
  });

  it("never expands placeholders or replacement patterns inside inserted values", () => {
    expect(
      renderPrompt("handoff.first-turn", "{{summary}}|{{message}}", {
        summary: "{{message}} $& $1",
        message: "{{summary}}",
      }),
    ).toBe("{{message}} $& $1|{{summary}}");
  });

  it("refuses to render a field the template does not allow", () => {
    expect(() =>
      renderPrompt("handoff.first-turn", "{{status}} {{message}}", { summary: "", message: "" }),
    ).toThrow(/unknown merge field 'status'/);
  });

  it.each([
    ["handoff.first-turn", "", /must not be empty/],
    ["handoff.first-turn", "x".repeat(PROMPT_TEMPLATE_LIMIT + 1), /at most/],
    ["handoff.first-turn", "{{summary}}", /must include \{\{message\}\}/],
    ["worker.updates.project", "Worker update", /must include \{\{updates\}\}/],
    ["worker.updates.project", "{{message}}", /unknown merge field 'message'/],
    ["plan.accepted.project", "Execute plan", /must include \{\{planId\}\}/],
    ["review.conflict-revision.project", "Fix {{conflicts}}", /must include \{\{project\}\}/],
    ["review.conflict-revision.project", "Fix {{project}}", /must include \{\{conflicts\}\}/],
    ["task.continue", "Continue {{planId}}", /unknown merge field 'planId'/],
    ["utility.chat-title", "Title {{message}}", /unknown merge field 'message'/],
    ["utility.search-overview", "Overview {{query}}", /unknown merge field 'query'/],
    ["memory.episodic-instructions", "Extract {{events}}", /unknown merge field 'events'/],
    ["handoff.summary", "{{prompts}} {{nope}}", /unknown merge field 'nope'/],
    ["handoff.summary", "{{message}}", /unknown merge field 'message'/],
    ["handoff.summary", "{{prompts}} {{ unclosed", /malformed merge field/],
    ["handoff.summary", "{{ 1bad }}", /malformed merge field/],
  ] as const)("rejects %s template %j", (id, template, error) => {
    expect(validatePromptTemplate(id, template)).toMatch(error);
  });

  it("validates overrides by canonical dotted template ID and rejects legacy camelCase keys", () => {
    expect(
      parseValue(promptTemplatesSchema, {
        "contract.operating": DEFAULT_OPERATING_CONTRACT_CLAUSES,
      }),
    ).toEqual({
      "contract.operating": DEFAULT_OPERATING_CONTRACT_CLAUSES,
    });
    expect(
      parseValue(promptTemplatesSchema, {
        "handoff.first-turn": "Hi {{message}}",
        "plan.accepted.project": "Accepted {{planId}}",
      }),
    ).toEqual({
      "handoff.first-turn": "Hi {{message}}",
      "plan.accepted.project": "Accepted {{planId}}",
    });
    expect(() =>
      parseValue(promptTemplatesSchema, { "handoff.first-turn": "{{summary}}" }),
    ).toThrow(/prompts\.handoff\.first-turn: must include/);
    for (const legacy of ["operatingContract", "handoffSummary", "handoffTurn", "workerUpdates"]) {
      expect(() => parseValue(promptTemplatesSchema, { [legacy]: "x" })).toThrow();
    }
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
    expect(validatePromptTemplate("contract.operating", clauses)).toBeTypeOf("string");
  });

  it("checks the assembled limit, including separators, at the exact boundary", () => {
    const clauses = Object.fromEntries(
      OPERATING_CONTRACT_CLAUSE_IDS.map((key) => [key, "x"]),
    ) as typeof DEFAULT_OPERATING_CONTRACT_CLAUSES;
    const base = assembleOperatingContract(clauses).length;
    const atLimit = { ...clauses, role: "x".repeat(PROMPT_TEMPLATE_LIMIT - base + 1) };
    expect(assembleOperatingContract(atLimit)).toHaveLength(PROMPT_TEMPLATE_LIMIT);
    expect(validatePromptTemplate("contract.operating", atLimit)).toBeUndefined();
    expect(
      validatePromptTemplate("contract.operating", { ...atLimit, role: `${atLimit.role}x` }),
    ).toMatch(/at most/);
  });
});
