import { describe, expect, it } from "vitest";
import {
  findTactic,
  searchTactics,
  TACTIC_SHARED_INSTRUCTIONS,
  TACTICS,
  tacticPrompt,
  tacticSchema,
} from "../src/contracts/index.js";

describe("bundled tactics", () => {
  it("has eight distinct versioned, validated, connected workflows", () => {
    expect(TACTICS.map((tactic) => tactic.title)).toEqual([
      "Independent review",
      "Implement and review",
      "Diagnose a bug",
      "Explore the codebase",
      "Research options",
      "Test first",
      "Plan first",
      "Challenge the plan",
    ]);
    expect(new Set(TACTICS.map((tactic) => tactic.id)).size).toBe(8);
    for (const tactic of TACTICS) {
      expect(tacticSchema.parse(tactic)).toEqual(tactic);
      for (const edge of tactic.edges) {
        expect(tactic.nodes.some((node) => node.id === edge.from)).toBe(true);
        expect(tactic.nodes.some((node) => node.id === edge.to)).toBe(true);
      }
      expect(tacticPrompt(tactic)).toBe(
        `${tactic.prompt}\n\nShared instructions:\n${TACTIC_SHARED_INSTRUCTIONS}`,
      );
      expect(tacticPrompt(tactic).split(TACTIC_SHARED_INSTRUCTIONS)).toHaveLength(2);
    }
  });
  it("searches all terms across names, roles, outputs, and full prompt without executing anything", () => {
    expect(searchTactics("  FRESH reviewer ").map((tactic) => tactic.id)).toContain(
      "independent-review",
    );
    expect(searchTactics("regression original").map((tactic) => tactic.id)).toContain(
      "diagnose-a-bug",
    );
    expect(searchTactics("counterevidence")[0]?.id).toBe("research-options");
    expect(searchTactics("unfindable-phrase")).toEqual([]);
    expect(searchTactics("")).toHaveLength(8);
    expect(findTactic("missing")).toBeUndefined();
    expect(findTactic(null)).toBeUndefined();
  });
  it("keeps stopping rules and actual-code, evidence, and human approval safeguards", () => {
    expect(findTactic("implement-and-review")?.prompt).toMatch(/at most two correction rounds/);
    expect(findTactic("independent-review")?.prompt).toMatch(/Do not repair/);
    expect(findTactic("test-first")?.prompt).toMatch(/one worktree/);
    expect(findTactic("research-options")?.prompt).toMatch(/at most one focused follow-up/);
    expect(findTactic("challenge-the-plan")?.prompt).toMatch(/one critique-and-revision round/);
    expect(findTactic("plan-first")?.prompt).toMatch(/human Accept action/);
    expect(TACTIC_SHARED_INSTRUCTIONS).toMatch(/own worktree is not the implementation/);
    expect(TACTIC_SHARED_INSTRUCTIONS).toMatch(/recapture/);
    expect(TACTIC_SHARED_INSTRUCTIONS).toMatch(
      /completed worker turn does not prove task completion/,
    );
  });
});
