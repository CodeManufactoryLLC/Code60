import { expect, it } from "vitest";
import {
  availableCommands,
  BUILTIN_COMMANDS,
  commandFieldsSchema,
  commandNameSchema,
  commandSchema,
  expandCommand,
  leadingCommand,
} from "../src/contracts/index.js";

const fields = {
  name: "review-2",
  title: "Review code",
  description: "",
  prompt: "Inspect the diff.",
};
const command = {
  ...fields,
  id: "01900000-0000-4000-8000-000000000001",
  createdAt: "a",
  updatedAt: "a",
};

it("provides create-command without a saved row and preserves user overrides", () => {
  const builtin = BUILTIN_COMMANDS[0];
  if (!builtin) throw new Error("Missing create-command");
  expect(commandSchema.safeParse(builtin).success).toBe(true);
  expect(availableCommands([])).toEqual(BUILTIN_COMMANDS);
  expect(availableCommands([command])).toEqual([command, ...BUILTIN_COMMANDS]);
  const override = { ...command, name: "create-command" };
  expect(availableCommands([override])).toEqual([
    override,
    ...BUILTIN_COMMANDS.filter((entry) => entry.name !== override.name),
  ]);
  const expanded = expandCommand(builtin, "/create-command Review SQL migrations for safety.");
  expect(expanded).toContain("Use code60_create_command");
  expect(expanded).toContain("without carrying out its prompt");
  expect(expanded).toContain("instructions are missing");
  expect(expanded).toContain("Additional instructions:\nReview SQL migrations for safety.");
});

it("ships unique valid built-ins and preserves saved overrides for each name", () => {
  expect(BUILTIN_COMMANDS.map((entry) => entry.name)).toEqual([
    "create-command",
    "plan",
    "business-evaluation",
  ]);
  expect(new Set(BUILTIN_COMMANDS.map((entry) => entry.id)).size).toBe(BUILTIN_COMMANDS.length);
  for (const builtin of BUILTIN_COMMANDS) {
    expect(commandSchema.safeParse(builtin).success).toBe(true);
    const override = { ...command, name: builtin.name };
    const available = availableCommands([override]);
    expect(available.filter((entry) => entry.name === builtin.name)).toEqual([override]);
    expect(available).toHaveLength(BUILTIN_COMMANDS.length);
    const request = `/${builtin.name} Help with my idea.\nKeep this context.`;
    expect(expandCommand(builtin, request)).toBe(
      `Command /${builtin.name}: ${builtin.title}\n${builtin.prompt}\n\nAdditional instructions:\nHelp with my idea.\nKeep this context.`,
    );
    expect(expandCommand(builtin, `/${builtin.name}`)).toBe(
      `Command /${builtin.name}: ${builtin.title}\n${builtin.prompt}`,
    );
  }
});

it("requires Code60 plan creation and human acceptance in both planning commands", () => {
  for (const name of ["plan", "business-evaluation"]) {
    const builtin = BUILTIN_COMMANDS.find((entry) => entry.name === name);
    if (!builtin) throw new Error(`Missing /${name}`);
    for (const instruction of [
      "code60_create_plan",
      "code60_update_plan",
      "requestId",
      "Accept",
      "No tool can accept",
      "end your turn",
    ]) {
      expect(builtin.prompt.toLowerCase()).toContain(instruction.toLowerCase());
    }
  }
});

it("retains the business-evaluation scope, evidence standards and five deliverables", () => {
  const builtin = BUILTIN_COMMANDS.find((entry) => entry.name === "business-evaluation");
  if (!builtin) throw new Error("Missing business evaluation");
  expect(
    builtin.prompt.startsWith(
      "You are an autonomous entrepreneurial research analyst evaluating a product or business idea.",
    ),
  ).toBe(true);
  for (const section of [
    "# 0. MANDATORY PLAN AND HUMAN APPROVAL BEFORE WORK",
    "# 1. RESEARCH AND PROPOSE BEFORE ASKING",
    "# 2. MINIMIZE USER EFFORT",
    "# 3. DO NOT CONFUSE AUTONOMY WITH INVENTING FACTS",
    "# 4. DEVELOP THE BUSINESS HYPOTHESIS",
    "# 5. PERFORM THE EVALUATION",
    "# 6. USE CURRENT RESEARCH RESPONSIBLY",
    "# 7. USE SPECIALISTS WHEN THEY ADD VALUE",
    "# 8. SIZE THE MARKET WITHOUT FALSE PRECISION",
    "# 9. ANALYZE ECONOMICS AS CONDITIONS TO TEST",
    "# 10. DELIVER FIVE PROPORTIONATE DOCUMENTS",
    "# 11. FINAL QUALITY CHECK",
    "# START",
    "DOCUMENT 1: DECISION BRIEF",
    "DOCUMENT 2: SUPPORTING FEASIBILITY ANALYSIS",
    "DOCUMENT 3: MARKET AND ECONOMICS MODEL",
    "DOCUMENT 4: RISKS, BLIND SPOTS, AND ASSUMPTIONS",
    "DOCUMENT 5: VALIDATION PLAN",
    "FACT\n",
    "USER REPORT\n",
    "HYPOTHESIS\n",
    "RECOMMENDATION\n",
    "SCENARIO INPUT\n",
    "UNKNOWN\n",
    "eligible buyers × annual revenue per buyer.",
    "gitReadiness",
    "planTaskId",
    "workerIds",
    "Do not begin with an intake questionnaire.",
    "Do not start external research, substantive market or economic analysis",
    "Do not contact customers, publish, collect private information, spend money",
  ])
    expect(builtin.prompt).toContain(section);
  expect(
    builtin.prompt.endsWith(
      "Do not begin research, analysis, delegation, or document production until Code60 delivers the accepted plan. Once accepted, complete the authorized evaluation using the instructions above, without defaulting to an intake interview.",
    ),
  ).toBe(true);
});

it("bounds every command field and supplies an empty optional description", () => {
  expect(
    commandFieldsSchema.parse({ name: "a", title: "Title", prompt: "Prompt" }).description,
  ).toBe("");
  expect(
    commandFieldsSchema.safeParse({
      name: "a".repeat(64),
      title: "t".repeat(120),
      description: "d".repeat(500),
      prompt: "p".repeat(100_000),
    }).success,
  ).toBe(true);
  for (const name of ["", "-x", "Upper", "two words", "/review", "a/b", "x\n", "a".repeat(65)])
    expect(commandNameSchema.safeParse(name).success).toBe(false);
  for (const invalid of [
    { title: "" },
    { title: " \t" },
    { title: "a\nb" },
    { title: "a\u2028b" },
    { title: "a\u2029b" },
    { title: "t".repeat(121) },
    { description: "d".repeat(501) },
    { prompt: "" },
    { prompt: " \n" },
    { prompt: "p".repeat(100_001) },
    { unknown: true },
  ])
    expect(commandFieldsSchema.safeParse({ ...fields, ...invalid }).success).toBe(false);
});

it("recognizes only a complete leading token, case-insensitively", () => {
  expect(leadingCommand("/REVIEW-2 extra")).toBe("review-2");
  expect(leadingCommand("/review-2\nnext")).toBe("review-2");
  for (const text of [
    " /review-2",
    "Use /review-2",
    "/review-2/path",
    "/",
    "/bad_name",
    `/${"a".repeat(65)}`,
  ])
    expect(leadingCommand(text)).toBeUndefined();
});

it("expands one command only and treats later slash tokens as additional instructions", () => {
  expect(expandCommand(command, "/review-2")).toBe(
    "Command /review-2: Review code\nInspect the diff.",
  );
  expect(expandCommand(command, "/REVIEW-2 \n")).toBe(
    "Command /review-2: Review code\nInspect the diff.",
  );
  expect(expandCommand(command, "/review-2  Focus here.\n/another")).toBe(
    "Command /review-2: Review code\nInspect the diff.\n\nAdditional instructions:\nFocus here.\n/another",
  );
  expect(() => expandCommand(command, "/other")).toThrow(/beginning/);
});
