import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflow = parse(
  await readFile(new URL("../.github/workflows/security-review.yml", import.meta.url), "utf8"),
);
const { codeql, dependencies } = workflow.jobs;

describe("automated security reviews", () => {
  it("reviews every PR and main push, with scheduled and manual rescans", () => {
    expect(workflow.on.push).toEqual({ branches: ["main"] });
    expect(workflow.on).toHaveProperty("pull_request");
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(workflow.on.schedule).toEqual([{ cron: "23 7 * * 1" }]);
    expect(workflow.on).not.toHaveProperty("pull_request_target");
  });

  it("limits write permissions to CodeQL results and pins third-party actions", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(codeql.permissions).toEqual({ contents: "read", "security-events": "write" });
    expect(dependencies.permissions).toBeUndefined();
    expect(JSON.stringify(workflow)).not.toContain("secrets.");
    for (const job of Object.values(workflow.jobs)) {
      expect(job["runs-on"]).toBe("ubuntu-24.04");
      expect(job["timeout-minutes"]).toBeGreaterThan(0);
      expect(job).not.toHaveProperty("if");
      expect(job).not.toHaveProperty("continue-on-error");
      for (const step of job.steps) {
        if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
        expect(step).not.toHaveProperty("continue-on-error");
        if (step.uses?.startsWith("actions/checkout@"))
          expect(step.with["persist-credentials"]).toBe(false);
      }
    }
  });

  it("runs extended JavaScript and TypeScript SAST and publishes code scanning results", () => {
    const init = codeql.steps.find((step) => step.uses?.startsWith("github/codeql-action/init@"));
    expect(init.with).toEqual({
      languages: "javascript-typescript",
      "build-mode": "none",
      queries: "security-extended",
    });
    const analyze = codeql.steps.find((step) =>
      step.uses?.startsWith("github/codeql-action/analyze@"),
    );
    expect(analyze.with.category).toBe("/language:javascript-typescript");
    expect(analyze.with).not.toHaveProperty("upload");
    expect(analyze.with).not.toHaveProperty("skip-queries");
    expect(analyze).not.toHaveProperty("if");
    const artifact = codeql.steps.find((step) => step.uses?.startsWith("actions/upload-artifact@"));
    expect(artifact.if).toBe("always()");
    expect(artifact.with.path).toBe(`${analyze.with.output}/`);
    expect(artifact.with["retention-days"]).toBe(30);
    expect(artifact.with["if-no-files-found"]).toBe("error");
  });

  it("audits production and development dependencies without installing or hiding failures", () => {
    const audit = dependencies.steps.find((step) => step.name === "Audit locked dependencies");
    expect(audit.run).toContain(
      "npm audit --package-lock-only --ignore-scripts --include=dev --audit-level=high",
    );
    expect(audit.run).toContain("> security-reports/npm-audit.txt 2>&1");
    expect(audit.run).not.toMatch(/\|\||set \+e|exit 0/);
    expect(audit).not.toHaveProperty("if");
    expect(JSON.stringify(dependencies)).not.toContain("npm ci");
  });

  it("keeps a readable summary and complete audit artifact even when the audit fails", () => {
    const auditIndex = dependencies.steps.findIndex(
      (step) => step.name === "Audit locked dependencies",
    );
    const summary = dependencies.steps[auditIndex + 1];
    expect(summary.if).toBe("always()");
    expect(summary.run).toContain("cat security-reports/npm-audit.txt");
    expect(summary.run).toContain("The audit could not run.");
    expect(summary.run).toContain('>> "$GITHUB_STEP_SUMMARY"');
    const artifact = dependencies.steps[auditIndex + 2];
    expect(artifact.uses).toMatch(/^actions\/upload-artifact@/);
    expect(artifact.if).toBe("always()");
    expect(artifact.with).toEqual({
      name: "npm-security-report",
      path: "security-reports/npm-audit.txt",
      "retention-days": 30,
      "if-no-files-found": "error",
    });
  });
});
