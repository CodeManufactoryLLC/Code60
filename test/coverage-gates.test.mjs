import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { coverageFailures, metrics } from "../scripts/check-coverage.mjs";

const limits = Object.fromEntries(metrics.map((metric) => [metric, 80]));
const measured = Object.fromEntries(metrics.map((metric) => [metric, { pct: 80 }]));
const baseline = { version: 1, overall: limits, files: { "src/core/run.ts": limits } };
const summary = { total: measured, "/repo/src/core/run.ts": measured };

describe("versioned coverage gates", () => {
  it("versions nonzero floors for every metric and the critical lifecycle and diagnostic surfaces", async () => {
    const actual = JSON.parse(
      await readFile(new URL("../coverage-baseline.json", import.meta.url), "utf8"),
    );
    expect(actual.version).toBe(1);
    for (const file of [
      "src/agents/index.ts",
      "src/agents/process.ts",
      "src/core/run.ts",
      "src/core/orchestrator.ts",
      "src/core/policy.ts",
      "src/core/recovery.ts",
      "src/core/processes.ts",
      "src/platform/process.ts",
      "src/desktop/controller.ts",
      "src/desktop/conversation-coordinator.ts",
      "src/desktop/preload.cts",
      "src/desktop/log-store.ts",
      "src/contracts/logs.ts",
      "src/bridge/logs.ts",
      "src/renderer/log-model.ts",
    ])
      expect(Object.keys(actual.files)).toContain(file);
    for (const entry of [actual.overall, ...Object.values(actual.files)])
      for (const metric of metrics) expect(entry[metric]).toBeGreaterThan(0);
  });
  it("the actual command rejects every planted regression and never rewrites its baseline", async () => {
    const directory = await mkdtemp(join(tmpdir(), "code60-coverage-gate-"));
    try {
      await mkdir(join(directory, "scripts"));
      await mkdir(join(directory, "coverage"));
      const command = join(directory, "scripts", "check-coverage.mjs");
      await writeFile(
        command,
        await readFile(new URL("../scripts/check-coverage.mjs", import.meta.url), "utf8"),
      );
      const baselineFile = join(directory, "coverage-baseline.json");
      await writeFile(baselineFile, JSON.stringify(baseline));
      const file = join(await realpath(directory), "src", "core", "run.ts");
      const initial = { total: measured, [file]: measured };
      const report = join(directory, "coverage", "coverage-summary.json");
      const execute = () =>
        promisify(execFile)(process.execPath, [command], { timeout: 3000 }).then(
          (result) => ({ code: 0, ...result }),
          (error) => error,
        );
      await writeFile(report, JSON.stringify(initial));
      const passing = await execute();
      expect(passing.code).toBe(0);
      expect(passing.stdout).toContain("Coverage non-regression gates passed");
      for (const path of ["total", file])
        for (const metric of metrics) {
          const changed = structuredClone(initial);
          changed[path][metric].pct = 79.99;
          await writeFile(report, JSON.stringify(changed));
          const result = await execute();
          expect(result.code).toBe(1);
          expect(result.stderr).toContain("Coverage regression:");
          expect(result.stderr).toContain(metric);
          expect(await readFile(baselineFile, "utf8")).toBe(JSON.stringify(baseline));
        }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it.each(metrics)("rejects overall and critical-file %s regression independently", (metric) => {
    for (const path of ["total", "/repo/src/core/run.ts"]) {
      expect(
        coverageFailures(
          {
            ...summary,
            [path]: { ...measured, [metric]: { pct: 79.99 } },
          },
          baseline,
          "/repo",
        ),
      ).toHaveLength(1);
    }
  });
  it("accepts equality and normalizes Windows paths", () => {
    expect(coverageFailures(summary, baseline, "/repo")).toEqual([]);
    expect(
      coverageFailures(
        { total: measured, "C:\\repo\\src\\core\\run.ts": measured },
        baseline,
        "C:\\repo",
      ),
    ).toEqual([]);
  });
  it("fails closed for missing files, metrics, reports or invalid thresholds", () => {
    expect(coverageFailures({ total: measured }, baseline, "/repo")).not.toEqual([]);
    expect(
      coverageFailures({ total: {}, "/repo/src/core/run.ts": measured }, baseline, "/repo"),
    ).toHaveLength(4);
    expect(coverageFailures(summary, { version: 2 }, "/repo")).not.toEqual([]);
    expect(
      coverageFailures(summary, { ...baseline, overall: { ...limits, branches: -1 } }, "/repo"),
    ).not.toEqual([]);
  });
});
