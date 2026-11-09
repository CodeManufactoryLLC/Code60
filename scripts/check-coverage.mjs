import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const metrics = ["statements", "branches", "functions", "lines"];

/** Pure gate evaluation, shared with deterministic regression tests. Never updates baselines. */
export function coverageFailures(summary, baseline, root) {
  const failures = [];
  if (baseline?.version !== 1 || !baseline.files || !baseline.overall)
    return ["Invalid versioned coverage baseline"];
  const normalizedRoot = `${root.replaceAll("\\", "/").replace(/\/$/, "")}/`;
  const files = Object.fromEntries(
    Object.entries(summary).map(([path, value]) => [
      path.replaceAll("\\", "/").replace(normalizedRoot, ""),
      value,
    ]),
  );
  for (const [path, limits] of [["total", baseline.overall], ...Object.entries(baseline.files)]) {
    const measured = files[path];
    if (!measured) {
      failures.push(`${path}: coverage summary missing`);
      continue;
    }
    for (const metric of metrics) {
      const threshold = limits?.[metric];
      const actual = measured[metric]?.pct;
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100)
        failures.push(`${path}: invalid ${metric} baseline`);
      else if (!Number.isFinite(actual) || actual < threshold)
        failures.push(`${path}: ${metric} ${actual ?? "missing"}% is below ${threshold}%`);
    }
  }
  return failures;
}

// ESM canonicalizes symlinked roots (including macOS /var); argv does not.
const invoked = process.argv[1]
  ? await realpath(resolve(process.argv[1])).catch(() => undefined)
  : undefined;
if (invoked && invoked === (await realpath(fileURLToPath(import.meta.url)))) {
  try {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const summary = JSON.parse(
      await readFile(new URL("../coverage/coverage-summary.json", import.meta.url), "utf8"),
    );
    const baseline = JSON.parse(
      await readFile(new URL("../coverage-baseline.json", import.meta.url), "utf8"),
    );
    const failures = coverageFailures(summary, baseline, root);
    if (failures.length) {
      console.error(
        `Coverage regression:\n${failures.join("\n")}\nAdd meaningful tests. Lowering a baseline requires an explicit reviewed change.`,
      );
      process.exitCode = 1;
    } else console.log("Coverage non-regression gates passed for all four metrics.");
  } catch {
    console.error(
      "Coverage gates require a valid summary and versioned baseline. Run npm run test:coverage.",
    );
    process.exitCode = 1;
  }
}
