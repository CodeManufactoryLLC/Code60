import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ci = parse(await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"));
const release = parse(
  await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
);
const protection = JSON.parse(
  await readFile(new URL("../.github/rulesets/protected-branches.json", import.meta.url), "utf8"),
);
const native = parse(
  await readFile(new URL("../.github/workflows/native-validation.yml", import.meta.url), "utf8"),
);

describe("branch protection policy", () => {
  it("actively protects the default, main, and dev branches without bypasses or exclusions", () => {
    expect(protection.target).toBe("branch");
    expect(protection.enforcement).toBe("active");
    expect(protection.bypass_actors).toEqual([]);
    expect(protection.conditions).toEqual({
      ref_name: {
        include: ["~DEFAULT_BRANCH", "refs/heads/main", "refs/heads/dev"],
        exclude: [],
      },
    });
  });

  it("requires PRs without a second approver, resolved discussions, and prevents destructive branch updates", () => {
    expect(protection.rules.map((rule) => rule.type).sort()).toEqual([
      "deletion",
      "non_fast_forward",
      "pull_request",
      "required_status_checks",
    ]);
    const pullRequest = protection.rules.find((rule) => rule.type === "pull_request");
    expect(pullRequest.parameters).toMatchObject({
      required_approving_review_count: 0,
      dismiss_stale_reviews_on_push: true,
      required_review_thread_resolution: true,
    });
  });

  it("requires the real aggregate CI check from GitHub Actions on an up-to-date branch", () => {
    const checks = protection.rules.find((rule) => rule.type === "required_status_checks");
    expect(checks.parameters).toEqual({
      strict_required_status_checks_policy: true,
      do_not_enforce_on_create: false,
      required_status_checks: [{ context: ci.jobs.passed.name, integration_id: 15368 }],
    });
    // Every PR must emit the required check, including documentation-only PRs.
    expect(ci.on.pull_request).toBeNull();
    expect(ci.on.push).toEqual({ branches: ["main"] });
    expect(ci.jobs.passed.if).toBe("always()");
    expect(ci.jobs.passed.needs).toEqual(["check", "desktop"]);
  });
});

describe("CI and release gates", () => {
  it("allows explicit native checks without signing secrets or publication rights", () => {
    expect(Object.keys(native.on)).toEqual(["workflow_dispatch"]);
    expect(native.permissions).toEqual({ contents: "read" });
    expect(native.jobs.native.strategy.matrix.os).toEqual(["windows-2025", "macos-15"]);
    expect(native.jobs.native.strategy["fail-fast"]).toBe(false);
    const temp = native.jobs.native.steps.find(
      (step) => step.name === "Use runner temp for Windows fixtures",
    );
    expect(temp.if).toBe("runner.os == 'Windows'");
    expect(temp.shell).toBe("pwsh");
    expect(temp.run).toBe(
      '"TEMP=$env:RUNNER_TEMP" >> $env:GITHUB_ENV\n"TMP=$env:RUNNER_TEMP" >> $env:GITHUB_ENV\n',
    );
    expect(release.jobs.windows.steps.find((step) => step.name === temp.name)).toEqual({
      name: temp.name,
      shell: temp.shell,
      run: temp.run,
    });
    expect(
      native.jobs.native.steps.filter((step) => step.run && step !== temp).map((step) => step.run),
    ).toEqual([
      "npm ci",
      "node scripts/install-electron.mjs",
      "npm run check",
      "npm run test:desktop",
    ]);
    expect(JSON.stringify(native)).not.toContain("secrets.");
    expect(Object.keys(native.jobs)).toEqual(["native"]);
  });
  it("checks only Linux without signing secrets or publication rights", () => {
    expect(ci.permissions).toEqual({ contents: "read" });
    expect(Object.keys(ci.jobs).sort()).toEqual(["check", "desktop", "passed"]);
    for (const job of Object.values(ci.jobs)) expect(job["runs-on"]).toBe("ubuntu-24.04");
    expect(JSON.stringify(ci)).not.toContain("secrets.");
    expect(ci.jobs.check.strategy.matrix.node).toEqual(["22.12", "24"]);
    expect(ci.jobs.passed.name).toBe("CI passed");
    expect(ci.jobs.passed.if).toBe("always()");
    expect(ci.jobs.passed.needs).toEqual(["check", "desktop"]);
    expect(Object.keys(ci.jobs.passed.steps[0].env).sort()).toEqual(["CHECK", "DESKTOP"]);
    expect(ci.jobs.passed.steps[0].run).toBe(
      'test "$CHECK" = success && test "$DESKTOP" = success',
    );
  });
  it("requires an explicit dispatch on main, then Linux checks before parallel installer jobs", () => {
    expect(Object.keys(release.on)).toEqual(["workflow_dispatch"]);
    expect(release.jobs.preflight.if).toBe("github.ref == 'refs/heads/main'");
    expect(release.jobs["linux-check"].needs).toBe("preflight");
    expect(release.jobs["linux-installers"].needs).toEqual(["preflight", "linux-check"]);
    expect(release.jobs.mac.needs).toEqual(["preflight", "linux-check"]);
    expect(release.jobs.mac["runs-on"]).toBe("macos-15");
    expect(release.jobs.windows.needs).toEqual(["preflight", "linux-check"]);
    expect(release.jobs.windows["runs-on"]).toBe("windows-2025");
    expect(release.concurrency["cancel-in-progress"]).toBe(false);
  });
  it("blocks promotion after failure, cancellation or skip of any required job", () => {
    const publish = release.jobs.publish;
    const required = ["preflight", "linux-check", "linux-installers", "mac", "windows"];
    expect(publish.needs).toEqual(required);
    expect(publish.if).toBe(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression, not JavaScript.
      "${{ success() && needs.preflight.result == 'success' && needs.linux-check.result == 'success' && needs.linux-installers.result == 'success' && needs.mac.result == 'success' && needs.windows.result == 'success' }}",
    );
    expect(publish.permissions).toEqual({ contents: "write" });
    expect(publish.concurrency.group).toBe("code60-release-publication");
    for (const [name, job] of Object.entries(release.jobs)) {
      if (name !== "publish" && name !== "windows")
        expect(job.permissions ?? release.permissions).toEqual({ contents: "read" });
    }
    // Only Windows signing may request an OIDC token, and only inside its environment.
    expect(release.jobs.windows.permissions).toEqual({ contents: "read", "id-token": "write" });
    expect(release.jobs.windows.environment).toBe("windows-signing");
    expect(JSON.stringify(release)).not.toContain("WIN_CSC");
    const login = release.jobs.windows.steps.findIndex((step) =>
      step.uses?.startsWith("azure/login@"),
    );
    const build = release.jobs.windows.steps.findIndex(
      (step) => step.run === "npm run package:win",
    );
    expect(release.jobs.windows.steps[login].if).toBe(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression, not JavaScript.
      "${{ !inputs.unsigned_windows_beta }}",
    );
    // Sign in only after checks and tests, immediately before packaging.
    expect(build).toBe(login + 1);
  });
  it("builds the validated SHA and downloads only this run's tested artifacts", () => {
    for (const name of ["linux-check", "linux-installers", "mac", "windows"]) {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression, not JavaScript.
      expect(release.jobs[name].steps[0].with.ref).toBe("${{ needs.preflight.outputs.sha }}");
    }
    const download = release.jobs.publish.steps.find((step) =>
      step.uses?.startsWith("actions/download-artifact@"),
    );
    expect(download.with).toEqual({
      pattern: "installers-*",
      "merge-multiple": true,
      path: "release-assets/",
    });
    expect(
      release.jobs.mac.steps.find((step) => step.name === "Remove temporary signing material").if,
    ).toBe("always()");
  });
});
