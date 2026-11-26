import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const suites = [
  "check",
  "browser",
  "package",
  "clean-install",
  "payload-smoke",
  "clean-payload",
  "setup",
  "shell",
  "managed",
  "clean-setup",
  "update",
  "clean-update",
  "clean-uninstall",
  "mac-package",
  "mac-payload",
  "mac-setup",
  "mac-shell",
  "mac-update",
  "mac-uninstall",
  "mac-full",
];
const jobs = [
  "check",
  "browser",
  "package",
  "clean-install",
  "payload",
  "payload-acceptance",
  "payload-clean-install",
  "update",
  "uninstall",
  "mac",
];
const npmPackage = ["package", "clean-install", "mac-package"];
const payload = ["payload-smoke", "clean-payload", "mac-payload"];
const setup = ["setup", "shell", "managed", "clean-setup", "mac-setup", "mac-shell"];
const update = ["update", "clean-update", "mac-update"];
const uninstall = ["clean-uninstall", "mac-uninstall"];
const acceptanceSuites = ["payload-smoke", "setup", "update", "shell"];
const cleanPayloadSuites = ["clean-payload", "managed", "clean-setup"];

function forPath(path) {
  if (
    /^(?:[A-Z][A-Z0-9_-]*\.md|src\/[a-z]+\/AGENTS\.md)$/.test(path) ||
    /^(?:docs|ad-hoc-plans|\.factory\/skills)\/.+\.md$/.test(path) ||
    /^(?:\.devcontainer|test\/clean-install)\/README\.md$/.test(path) ||
    /^docs\/review\/.+\.(?:png|webp|jpe?g)$/.test(path)
  )
    return ["instructions"];

  if (
    /^(?:src\/(?:application|core)\/(?:rag[.-]|memory-worker\.)|scripts\/(?:prepare-models|test-rag-model|distribution\/probe-native)|models\/)/.test(
      path,
    )
  )
    return ["check", ...npmPackage, ...payload];
  if (
    /^(?:src\/(?:platform\/update-registry|management\/update)|scripts\/(?:test-update|distribution\/update-fixture)|test\/(?:update[.-]|fixtures\/update-command))/.test(
      path,
    )
  )
    return ["check", ...update];
  if (
    /^(?:scripts\/test-(?:uninstall|concurrent-clean-install)\.mjs|test\/(?:uninstall-installed\.e2e\.ts|uninstall\.config\.ts|fixtures\/uninstall-journey\.mjs))$/.test(
      path,
    )
  )
    return ["check", ...uninstall];
  if (/^test\/clean-install\/uninstall\.mjs$/.test(path)) return ["check", "clean-uninstall"];
  if (
    /^src\/(?:(?:automation|gateway)\/registration|management\/(?:install|shell-integration|shell-removal|uninstall|removal-|main\.|cli\.)|platform\/(?:installation-|user-service|process-identity|private-state))/.test(
      path,
    )
  )
    return ["check", "browser", ...setup, ...update, ...uninstall];
  if (/^(?:src\/(?:management\/setup|application\/setup-database)|scripts\/test-setup)/.test(path))
    return ["check", "browser", ...setup];
  if (/^(?:scripts\/test-installation|test\/installation\.test)/.test(path))
    return ["check", ...setup];
  if (/^scripts\/test-package\.mjs$/.test(path)) return ["check", ...npmPackage];
  if (/^scripts\/test-payload\.mjs$/.test(path)) return ["check", ...payload];
  // Shared fixtures, build inputs, packaging, CI and new top-level owners default to full.
  if (
    /^test\/(?:workflows|ci-impact|build|release(?:-git)?|distribution|clean-install(?:-supervisor)?|concurrent-clean-install|artifact-handoff|backend-supervisor|devcontainer[^/]*)\.test\./.test(
      path,
    )
  )
    return suites;
  if (/^test\/clean-install\/install-payload\.mjs$/.test(path)) return ["check", "clean-payload"];
  if (/^test\/clean-install\/install-managed\.mjs$/.test(path)) return ["check", "managed"];
  if (/^test\/clean-install\/install-setup\.mjs$/.test(path)) return ["check", "clean-setup"];
  if (/^test\/clean-install\/install\.mjs$/.test(path)) return ["check", ...npmPackage];
  if (/^test\/(?:clean-install\/|fixtures\/golden-journey)/.test(path)) return suites;
  if (
    /^test\/fixtures\/(?:carbon-tables|renderer-replay|navigation-icons|system-manager|automation-transcript)/.test(
      path,
    )
  )
    return ["check", "browser"];
  if (/^test\/[^/]+\.e2e\.ts$/.test(path)) return ["check", "browser"];
  if (/^test\/[^/]+\.test\.[cm]?[jt]sx?$/.test(path)) return ["check"];
  if (/^scripts\/dev(?:-backend|-ports)?\.mjs$/.test(path)) return ["check", "browser"];
  if (
    /^src\/(?:renderer|gateway|agents|application|automation|bridge|contracts|core|git)\//.test(
      path,
    ) &&
    /\.(?:[cm]?[jt]sx?|css|scss|html|png|svg|woff2?)$/.test(path)
  )
    return ["check", "browser"];
  return suites;
}

export function classify(paths) {
  const selected = new Set(paths?.length ? paths.flatMap(forPath) : suites);
  if (selected.has("check")) selected.delete("instructions"); // npm run check includes it
  return ["instructions", ...suites].filter((suite) => selected.has(suite));
}

export function selectedJobs(plan) {
  const needsAcceptance = acceptanceSuites.some((suite) => plan.includes(suite));
  const needsCleanPayload = cleanPayloadSuites.some((suite) => plan.includes(suite));
  const needsUpdate = plan.includes("clean-update");
  const needsUninstall = plan.includes("clean-uninstall");
  return jobs.filter((job) => {
    if (job === "check") return plan.includes("instructions") || plan.includes("check");
    if (job === "mac") return plan.some((suite) => suite.startsWith("mac-"));
    if (job === "payload")
      return needsAcceptance || needsCleanPayload || needsUpdate || needsUninstall;
    if (job === "payload-acceptance") return needsAcceptance;
    if (job === "payload-clean-install") return needsCleanPayload;
    if (job === "update") return needsUpdate;
    if (job === "uninstall") return needsUninstall;
    return plan.includes(job);
  });
}

export function changedPaths(event, cwd) {
  const pr = event.pull_request;
  const base = pr ? pr.base.sha : event.before;
  const head = pr ? pr.head.sha : event.after;
  if (
    ![base, head].every(
      (sha) => typeof sha === "string" && /^[0-9a-f]{40}$/.test(sha) && !/^0+$/.test(sha),
    )
  )
    return null;
  try {
    // Represent a rename as delete + add. NUL delimiters preserve arbitrary Git names.
    const result = execFileSync(
      "git",
      [
        "diff",
        "--no-renames",
        "--name-only",
        "-z",
        pr ? `${base}...${head}` : base,
        ...(pr ? [] : [head]),
        "--",
      ],
      { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    return result.split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

export function checkGate(plan, needs) {
  if (needs.impact?.result !== "success") throw Error("Impact classification did not succeed");
  const required = selectedJobs(plan);
  for (const job of jobs) {
    const expected = required.includes(job) ? "success" : "skipped";
    if (needs[job]?.result !== expected)
      throw Error(`${job} expected ${expected}, got ${needs[job]?.result}`);
  }
}

function summary(paths, plan) {
  const displayPath = (s) =>
    JSON.stringify(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const list = paths
    ?.map(
      (p) => `${displayPath(p)} → ${forPath(p) === suites ? "full matrix" : forPath(p).join(", ")}`,
    )
    .join("\n");
  return [
    "## CI impact",
    "",
    `Selected: ${plan.join(", ")}`,
    "",
    "Skipped: " +
      (["instructions", ...suites].filter((s) => !plan.includes(s)).join(", ") || "none"),
    "",
    "<details><summary>Changed paths and routing</summary><pre>",
    list || "Empty or unavailable diff; full matrix selected.",
    "</pre></details>",
    "",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paths = changedPaths(JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")));
  const plan = classify(paths);
  if (process.argv[2] === "gate") {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(paths, plan));
    const needs = JSON.parse(process.env.CI_NEEDS);
    if (JSON.stringify(plan) !== needs.impact.outputs.plan) throw Error("CI plan mismatch");
    checkGate(plan, needs);
  } else {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `plan=${JSON.stringify(plan)}\njobs=${JSON.stringify(selectedJobs(plan))}\n`,
    );
  }
}
