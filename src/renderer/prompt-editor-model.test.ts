import { describe, expect, it } from "vitest";
import { assembleOperatingContract, DEFAULT_PROMPT_TEMPLATES } from "../bridge/index.js";
import {
  buildPromptCatalogItems,
  draftText,
  filterPromptCatalog,
  insertField,
  isDirty,
  previewPrompt,
} from "./prompt-editor-model.js";

describe("prompt editor model", () => {
  it("inserts a merge field at the cursor or over the selection", () => {
    expect(insertField("Hello world", 6, 6, "agent")).toEqual({
      text: "Hello {{agent}}world",
      cursor: 15,
    });
    expect(insertField("Hello world", 11, 6, "agent")).toEqual({
      text: "Hello {{agent}}",
      cursor: 15,
    });
    expect(insertField("", 4, 9, "message")).toEqual({ text: "{{message}}", cursor: 11 });
  });

  it("merges the 44-item catalog with live editable state and filters by ID, name, and mode", () => {
    const items = buildPromptCatalogItems([
      {
        id: "plan.accepted.project",
        fields: ["planId"],
        template: "Custom plan {{planId}}",
        source: "database",
        fallback: DEFAULT_PROMPT_TEMPLATES["plan.accepted.project"],
        fallbackSource: "built-in",
      },
    ]);
    expect(items).toHaveLength(44);
    expect(filterPromptCatalog(items, "", "editable")).toHaveLength(10);
    expect(filterPromptCatalog(items, "", "readonly")).toHaveLength(34);
    const plan = items.find((entry) => entry.id === "plan.accepted.project");
    expect(plan?.editable && plan.source).toBe("database");
    expect(plan?.editable && plan.template).toBe("Custom plan {{planId}}");

    const relayHits = filterPromptCatalog(items, "relay", "all");
    expect(relayHits.some((entry) => entry.id === "contract.relay-addendum")).toBe(true);
    expect(relayHits.every((entry) => !entry.editable)).toBe(true);
    expect(filterPromptCatalog(items, "tactic.plan-first", "readonly")).toHaveLength(1);
  });

  it("previews editable templates with sample values and safety wrappers, and explains invalid ones", () => {
    const clauses = {
      ...DEFAULT_PROMPT_TEMPLATES["contract.operating"],
      role: "Controlled by Code60",
    };
    expect(previewPrompt("contract.operating", clauses)).toEqual({
      ok: true,
      text: assembleOperatingContract(clauses),
    });
    expect(previewPrompt("contract.operating", "{{message}}")).toMatchObject({ ok: false });
    const summary = previewPrompt("handoff.summary", "{{agent}} on {{branch}}");
    expect(summary).toEqual({ ok: true, text: "claude on code60/20260105-101500-a1b2c3" });
    const turn = previewPrompt(
      "handoff.first-turn",
      DEFAULT_PROMPT_TEMPLATES["handoff.first-turn"],
    );
    expect(turn.ok && turn.text).toContain("Continue a Code60 run");
    expect(turn.ok && turn.text).toContain("Please finish the failing test.");
    expect(previewPrompt("handoff.first-turn", "{{summary}}")).toEqual({
      ok: false,
      error: "This template must include {{message}}.",
    });
    expect(previewPrompt("handoff.summary", "{{nope}}")).toMatchObject({ ok: false });

    const plan = previewPrompt("plan.accepted.project", "Run {{planId}}");
    expect(plan).toEqual({ ok: true, text: "Run 11111111-2222-4333-8444-555555555555" });
    const title = previewPrompt("utility.chat-title", "Short title.");
    expect(title.ok && title.text).toContain("Short title.");
    expect(title.ok && title.text).toContain("untrusted conversation data");
    const search = previewPrompt("utility.search-overview", "Bullet summary.");
    expect(search.ok && search.text).toContain("Bullet summary.");
    expect(search.ok && search.text).toContain("Search data (JSON):");
    const episodic = previewPrompt("memory.episodic-instructions", "Keep constraints.");
    expect(episodic.ok && episodic.text).toContain("Keep constraints.");
    expect(episodic.ok && episodic.text).toContain("Code60 Episodic Memory extraction.");
  });

  it("merges the given summary template into the handoff turn preview", () => {
    expect(previewPrompt("handoff.first-turn", "[{{summary}}] {{message}}", "S {{agent}}")).toEqual(
      {
        ok: true,
        text: "[S claude] Please finish the failing test.",
      },
    );
    const fallback = previewPrompt("handoff.first-turn", "{{summary}} {{message}}", "{{nope}}");
    expect(fallback.ok && fallback.text).toContain("Continue a Code60 run");
  });

  it("tracks unsaved drafts against the effective template", () => {
    expect(draftText({}, "handoff.first-turn", "A")).toBe("A");
    expect(draftText({ "handoff.first-turn": "B" }, "handoff.first-turn", "A")).toBe("B");
    expect(isDirty({}, "handoff.first-turn", "A")).toBe(false);
    expect(isDirty({ "handoff.first-turn": "A" }, "handoff.first-turn", "A")).toBe(false);
    expect(isDirty({ "handoff.first-turn": "B" }, "handoff.first-turn", "A")).toBe(true);
  });

  it("preserves every clause draft and compares values rather than object identity", () => {
    const original = DEFAULT_PROMPT_TEMPLATES["contract.operating"];
    const edited = { ...original, planning: "Plan carefully.", role: "A different role." };
    const drafts = { "contract.operating": edited };
    expect(draftText(drafts, "contract.operating", original)).toEqual(edited);
    expect(draftText(drafts, "handoff.first-turn", "Other template")).toBe("Other template");
    expect(isDirty(drafts, "contract.operating", original)).toBe(true);
    expect(isDirty({ "contract.operating": { ...original } }, "contract.operating", original)).toBe(
      false,
    );
    expect(isDirty(drafts, "contract.operating", { ...edited })).toBe(false);
    expect(original.role).not.toBe(edited.role);
    const preview = previewPrompt("contract.operating", edited);
    expect(preview.ok && preview.text).toContain("A different role.");
    expect(preview.ok && preview.text).toContain("Plan carefully.");
  });
});
