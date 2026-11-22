import { describe, expect, it } from "vitest";
import { knowledgeReportSchema } from "../bridge/index.js";
import { emptyFileTabs, updateFileTabs } from "./file-tabs.js";
import { panelReport } from "./knowledge-report.js";

describe("knowledge panel reports", () => {
  it("summarizes tab kinds and selection within the bridge contract", () => {
    const planId = crypto.randomUUID();
    let tabs = updateFileTabs(emptyFileTabs(), { type: "plan", planId, title: "Plan" });
    tabs = updateFileTabs(tabs, { type: "file", path: "src/a.ts" });
    tabs = updateFileTabs(tabs, { type: "changes" });
    tabs = updateFileTabs(tabs, { type: "recall" });
    const report = panelReport(tabs);
    expect(report.tabs.map((tab) => tab.kind)).toEqual(["plan", "file", "changes", "recall"]);
    expect(report.tabs.at(-1)).toEqual({ id: tabs.active, kind: "recall" });
    expect(report.selected).toBe(tabs.active);
    expect(report.incomplete).toBe(false);
    expect(
      knowledgeReportSchema.safeParse({
        renderer: crypto.randomUUID(),
        sequence: 1,
        view: {
          kind: "panel",
          id: crypto.randomUUID(),
          owner: { kind: "relay", conversationId: crypto.randomUUID(), generation: 1 },
          active: true,
          open: true,
          ...report,
        },
      }).success,
    ).toBe(true);
  });

  it("omits unsupported paths and caps large panels as incomplete", () => {
    let tabs = updateFileTabs(emptyFileTabs(), { type: "file", path: "C:/outside" });
    const omitted = panelReport(tabs);
    expect(omitted).toEqual({ tabs: [], selected: null, incomplete: true });
    for (let index = 0; index < 140; index++) tabs = updateFileTabs(tabs, { type: "blank" });
    const capped = panelReport(tabs);
    expect(capped.tabs.length).toBeLessThanOrEqual(128);
    expect(capped.incomplete).toBe(true);
  });
});
