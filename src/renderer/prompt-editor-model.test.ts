import { describe, expect, it } from "vitest";
import { assembleOperatingContract, DEFAULT_PROMPT_TEMPLATES } from "../bridge/index.js";
import {
  draftText,
  fieldDescriptions,
  fieldExample,
  insertField,
  isDirty,
  locateProblem,
  matchesPrompt,
  PromptDraftSession,
  previewPrompt,
  templateBody,
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

describe("editing and draft lifecycle", () => {
  const state = (template = "Hello {{agent}}") => ({
    id: "handoffSummary" as const,
    template,
    source: "built-in" as const,
    fields: ["agent"],
    fallback: template,
    fallbackSource: "built-in" as const,
  });
  it("searches descriptions as well as names without changing the selected draft", () => {
    expect(matchesPrompt("handoffSummary", "ACP session")).toBe(true);
    expect(matchesPrompt("operatingContract", "  OPERATING  ")).toBe(true);
    expect(matchesPrompt("workerUpdates", "not a template")).toBe(false);
    expect(fieldDescriptions.agent).toContain("Provider");
    expect(fieldExample("handoffSummary", "agent")).toBe("claude");
    expect(fieldExample("handoffTurn", "message")).toContain("failing test");
  });
  it("locates unknown, malformed, missing, empty and excessive fields with corrections", () => {
    expect(locateProblem("handoffSummary", "Hi\n{{nope}}")).toMatchObject({
      start: 3,
      end: 11,
      line: 2,
      column: 1,
      message: expect.stringContaining("allowed merge field"),
    });
    expect(locateProblem("handoffSummary", "{{agent}}\n{{bad")).toMatchObject({
      start: 10,
      line: 2,
      message: expect.stringContaining("closing braces"),
    });
    expect(locateProblem("handoffTurn", "Hello")).toMatchObject({
      start: 5,
      end: 5,
      message: expect.stringContaining("Insert {{message}}"),
    });
    expect(locateProblem("handoffSummary", "")).toMatchObject({
      line: 1,
      message: expect.stringContaining("nonempty"),
    });
    expect(locateProblem("handoffSummary", "x".repeat(8001))?.message).toContain("Shorten");
    expect(
      locateProblem("operatingContract", {
        ...DEFAULT_PROMPT_TEMPLATES.operatingContract,
        planning: "Hi\n{{bad}}",
      }),
    ).toMatchObject({ clause: "planning", line: 2, start: 3 });
    expect(
      locateProblem("operatingContract", {
        ...DEFAULT_PROMPT_TEMPLATES.operatingContract,
        planning: "",
      }),
    ).toMatchObject({ clause: "planning" });
    expect(locateProblem("handoffSummary", "{{agent}}")).toBeUndefined();
  });
  it("undoes and redoes typing and insertion across template switches and keeps independent sessions", () => {
    const session = new PromptDraftSession();
    const saved = state();
    session.edit(saved, "Hello ");
    session.edit(saved, insertField("Hello ", 6, 6, "agent").text);
    session.undo(saved.id);
    expect(session.read(saved)).toBe("Hello ");
    session.undo(saved.id, true);
    expect(session.read(saved)).toBe("Hello {{agent}}");
    expect(session.pending).toBe(false);
    session.undo(saved.id);
    session.edit(saved, "Different");
    expect(session.records.get(saved.id)?.future).toEqual([]);
    expect(session.pending).toBe(true);
    expect(new PromptDraftSession().read(saved)).toBe(saved.template);
    expect(session.read({ ...saved, id: "workerUpdates", template: "{{updates}}" })).toBe(
      "{{updates}}",
    );
    expect(session.read(saved)).toBe("Different");
  });
  it("retains both versions on external edits and supports explicit keep or reload", () => {
    const session = new PromptDraftSession();
    const saved = state();
    session.edit(saved, "My {{agent}} draft");
    const external = { ...saved, source: "database" as const, template: "External {{agent}}" };
    expect(session.conflict(external)).toBe(true);
    expect(session.read(external)).toBe("My {{agent}} draft");
    session.rebase(external);
    expect(session.conflict(external)).toBe(false);
    expect(session.dirty(external)).toBe(true);
    session.discard(external.id);
    expect(session.read(external)).toBe(external.template);
    expect(session.pending).toBe(false);
  });
  it("restores the reset destination immediately without treating its delayed snapshot as external", () => {
    const session = new PromptDraftSession();
    const original = state();
    const edited = { ...original, template: "Saved override", source: "database" as const };
    session.edit(edited, "Unsaved");
    session.reset(edited, session.records.get(edited.id)?.revision);
    expect(session.read(edited)).toBe(original.template);
    expect(session.pending).toBe(false);
    session.edit(edited, "New after reset");
    expect(session.conflict(edited)).toBe(false);
    expect(session.conflict(original)).toBe(false);
    expect(session.records.get(edited.id)?.baseline.source).toBe("built-in");
    expect(session.read(original)).toBe("New after reset");
  });
  it("retains a save acknowledgement across late snapshots and immediate typing", () => {
    const session = new PromptDraftSession();
    const original = state();
    session.edit(original, "Saved");
    session.saved(original.id, session.records.get(original.id)?.revision, "Saved");
    expect(session.read(original)).toBe("Saved");
    expect(session.pending).toBe(false);
    session.edit(original, "Immediate next edit");
    expect(session.conflict(original)).toBe(false);
    const acknowledged = { ...original, template: "Saved", source: "database" as const };
    expect(session.conflict(acknowledged)).toBe(false);
    expect(session.records.get(original.id)?.baseline).toMatchObject({
      template: "Saved",
      source: "database",
    });
    expect(session.conflict({ ...acknowledged, template: "External" })).toBe(true);
    expect(session.read(acknowledged)).toBe("Immediate next edit");
    session.failed(original.id);
    expect(session.conflict(original)).toBe(true);
  });
  it("does not clear a newer edit when an earlier save finishes; failures do not mutate drafts", () => {
    const session = new PromptDraftSession();
    const saved = state();
    session.edit(saved, "First");
    const revision = session.records.get(saved.id)?.revision;
    session.edit(saved, "Second");
    session.saved(saved.id, revision, "First");
    expect(session.read(saved)).toBe("Second");
    expect(session.records.get(saved.id)?.baseline.template).toBe("First");
    expect(session.pending).toBe(true);
    session.saved(saved.id, session.records.get(saved.id)?.revision, "Second");
    expect(session.pending).toBe(false);
    expect(templateBody(DEFAULT_PROMPT_TEMPLATES.operatingContract)).toContain("Code60");
  });
});
