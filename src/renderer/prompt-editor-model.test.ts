import { describe, expect, it } from "vitest";
import { assembleOperatingContract, DEFAULT_PROMPT_TEMPLATES } from "../bridge/index.js";
import { draftText, insertField, isDirty, previewPrompt } from "./prompt-editor-model.js";

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

  it("previews templates with sample values and explains invalid ones", () => {
    const clauses = { ...DEFAULT_PROMPT_TEMPLATES.operatingContract, role: "Controlled by Code60" };
    expect(previewPrompt("operatingContract", clauses)).toEqual({
      ok: true,
      text: assembleOperatingContract(clauses),
    });
    expect(previewPrompt("operatingContract", "{{message}}")).toMatchObject({ ok: false });
    const summary = previewPrompt("handoffSummary", "{{agent}} on {{branch}}");
    expect(summary).toEqual({ ok: true, text: "claude on code60/20260105-101500-a1b2c3" });
    const turn = previewPrompt("handoffTurn", DEFAULT_PROMPT_TEMPLATES.handoffTurn);
    expect(turn.ok && turn.text).toContain("Continue a Code60 run");
    expect(turn.ok && turn.text).toContain("Please finish the failing test.");
    expect(previewPrompt("handoffTurn", "{{summary}}")).toEqual({
      ok: false,
      error: "This template must include {{message}}.",
    });
    expect(previewPrompt("handoffSummary", "{{nope}}")).toMatchObject({ ok: false });
  });

  it("merges the given summary template into the handoff turn preview", () => {
    expect(previewPrompt("handoffTurn", "[{{summary}}] {{message}}", "S {{agent}}")).toEqual({
      ok: true,
      text: "[S claude] Please finish the failing test.",
    });
    const fallback = previewPrompt("handoffTurn", "{{summary}} {{message}}", "{{nope}}");
    expect(fallback.ok && fallback.text).toContain("Continue a Code60 run");
  });

  it("tracks unsaved drafts against the effective template", () => {
    expect(draftText({}, "handoffTurn", "A")).toBe("A");
    expect(draftText({ handoffTurn: "B" }, "handoffTurn", "A")).toBe("B");
    expect(isDirty({}, "handoffTurn", "A")).toBe(false);
    expect(isDirty({ handoffTurn: "A" }, "handoffTurn", "A")).toBe(false);
    expect(isDirty({ handoffTurn: "B" }, "handoffTurn", "A")).toBe(true);
  });

  it("preserves every clause draft and compares values rather than object identity", () => {
    const original = DEFAULT_PROMPT_TEMPLATES.operatingContract;
    const edited = { ...original, planning: "Plan carefully.", role: "A different role." };
    const drafts = { operatingContract: edited };
    expect(draftText(drafts, "operatingContract", original)).toEqual(edited);
    expect(draftText(drafts, "handoffTurn", "Other template")).toBe("Other template");
    expect(isDirty(drafts, "operatingContract", original)).toBe(true);
    expect(isDirty({ operatingContract: { ...original } }, "operatingContract", original)).toBe(
      false,
    );
    expect(isDirty(drafts, "operatingContract", { ...edited })).toBe(false);
    expect(original.role).not.toBe(edited.role);
    const preview = previewPrompt("operatingContract", edited);
    expect(preview.ok && preview.text).toContain("A different role.");
    expect(preview.ok && preview.text).toContain("Plan carefully.");
  });
});
