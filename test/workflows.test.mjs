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
const nativeTests = parse(
  await readFile(new URL("../.github/workflows/native-tests.yml", import.meta.url), "utf8"),
);
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const linuxDesktop = parse(
  await readFile(
    new URL("../.github/actions/setup-linux-desktop/action.yml", import.meta.url),
    "utf8",
  ),
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
  it("bounds Linux desktop package downloads and uses the primary signed Ubuntu mirror", () => {
    const setup = linuxDesktop.runs.steps[0].run;
    expect(setup).toContain('"$(dpkg --print-architecture)" == amd64');
    expect(setup).toContain("-f /etc/apt/apt-mirrors.txt");
    expect(setup).toContain("https://archive.ubuntu.com/ubuntu");
    expect(setup).toContain("Acquire::Retries=2");
    expect(setup).toContain("Acquire::http::Timeout=30");
    expect(setup).toContain("Acquire::https::Timeout=30");
    expect(setup).toContain('apt-get "${apt_options[@]}" update');
    expect(setup).toContain('apt-get "${apt_options[@]}" install');
    expect(setup).not.toContain("--allow-unauthenticated");
    expect(
      ci.jobs.desktop.steps.some((step) => step.uses === "./.github/actions/setup-linux-desktop"),
    ).toBe(true);
  });

  it("enables SQLite for Node 22.12 so database tests participate in coverage", () => {
    for (const job of [ci.jobs.check, release.jobs["linux-check"]]) {
      expect(job.strategy.matrix.node).toContain("22.12");
      expect(job.env.NODE_OPTIONS).toBe(
        "${{ matrix.node == '22.12' && '--experimental-sqlite' || '' }}",
      );
      expect(job.steps.some((step) => step.run === "npm run check")).toBe(true);
    }
    expect(ci.jobs.passed.needs).toContain("check");
  });

  it("passes only declared inputs to every reusable native test call", () => {
    const inputs = nativeTests.on.workflow_call.inputs;
    for (const workflow of [native, release]) {
      for (const [name, job] of Object.entries(workflow.jobs)) {
        if (job.uses !== "./.github/workflows/native-tests.yml") continue;
        const supplied = job.with ?? {};
        expect(
          Object.keys(supplied).filter((key) => !(key in inputs)),
          name,
        ).toEqual([]);
        for (const [key, definition] of Object.entries(inputs)) {
          if (definition.required) expect(supplied, `${name}.${key}`).toHaveProperty(key);
        }
      }
    }
  });
  it("shares one secret-free native test workflow between validation and release", () => {
    expect(Object.keys(nativeTests.on)).toEqual(["workflow_call"]);
    expect(Object.keys(nativeTests.on.workflow_call.inputs).sort()).toEqual([
      "desktop_grep",
      "ref",
      "release",
      "shard",
      "shards",
      "suite",
      "unit_filter",
    ]);
    expect(nativeTests.permissions).toEqual({ contents: "read" });
    expect(Object.keys(nativeTests.jobs)).toEqual(["test"]);
    const job = nativeTests.jobs.test;
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression, not JavaScript.
    expect(job["runs-on"]).toBe("macos-15");
    expect(job.steps.find((step) => step.uses?.startsWith("actions/checkout@")).with).toEqual({
      // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression, not JavaScript.
      ref: "${{ inputs.ref }}",
      "persist-credentials": false,
    });
    const identity = job.steps.find((step) => step.name?.startsWith("Verify runner architecture"));
    expect(identity.run).toBe(
      release.jobs.mac.steps.find((step) => step.name === identity.name).run,
    );
    expect(job.steps.filter((step) => step.run && !step.name).map((step) => step.run)).toEqual([
      "npm ci",
      "node scripts/install-electron.mjs",
      "npm run prepare:models",
    ]);
    const full = job.steps.find((step) => step.name === "Unit tests with coverage gates");
    expect(full).toMatchObject({
      if: "inputs.suite == 'unit' && inputs.unit_filter == ''",
      run: "npm run check",
    });
    // Filters reach the shell only through the environment.
    const filtered = job.steps.find((step) => step.name?.startsWith("Filtered unit tests"));
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression, not JavaScript.
    expect(filtered.env).toEqual({ UNIT_FILTER: "${{ inputs.unit_filter }}" });
    expect(filtered.run).toContain('vitest.mjs run "$UNIT_FILTER"');
    expect(filtered.run).not.toContain("${{");
    const desktop = job.steps.find((step) => step.name === "Desktop tests");
    expect(desktop.if).toBe("inputs.suite == 'desktop'");
    expect(desktop.run).not.toContain("${{");
    expect(desktop.run).toContain('args=(--fully-parallel "--shard=$SHARD/$SHARDS")');
    expect(desktop.run).toContain('args+=(--grep "$DESKTOP_GREP" --pass-with-no-tests)');
    // The step replicates test:desktop so the grep avoids cmd.exe argument quoting.
    expect(packageJson.scripts["test:desktop"]).toBe("npm run build && playwright test");
    expect(desktop.run).toContain("npm run build\nnode node_modules/@playwright/test/cli.js test");
    expect(JSON.stringify(nativeTests)).not.toContain("secrets.");
  });
  it("separates superseding acceptance runs from independent diagnosis runs", () => {
    expect(Object.keys(native.on)).toEqual(["workflow_dispatch"]);
    const inputs = native.on.workflow_dispatch.inputs;
    expect(inputs.platform).toBeUndefined();
    expect(inputs.suite).toMatchObject({ default: "full", options: ["full", "unit", "desktop"] });
    expect(inputs.unit_filter.default).toBe("");
    expect(inputs.desktop_grep.default).toBe("");
    const acceptance =
      "inputs.suite == 'full' && inputs.unit_filter == '' && inputs.desktop_grep == ''";
    expect(native["run-name"]).toContain(`(${acceptance}) && 'acceptance' || 'diagnosis'`);
    expect(native.concurrency).toEqual({
      group: `native-validation-\${{ github.ref }}-\${{ (${acceptance}) && 'acceptance' || github.run_id }}`,
      "cancel-in-progress": `\${{ ${acceptance} }}`,
    });
    expect(native.jobs.passed.steps[0].env.ACCEPTANCE).toBe(`\${{ ${acceptance} }}`);
    expect(native.permissions).toEqual({ contents: "read" });
    expect(Object.keys(native.jobs)).toEqual(["unit", "desktop", "passed"]);
    for (const name of ["unit", "desktop"]) {
      const job = native.jobs[name];
      expect(job.uses).toBe("./.github/workflows/native-tests.yml");
      if (name === "desktop") expect(job.strategy["fail-fast"]).toBe(false);
      expect(job.secrets).toBeUndefined();
      // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression, not JavaScript.
      expect(job.with.ref).toBe("${{ github.sha }}");
      expect(job.with.suite).toBe(name);
    }
    expect(native.jobs.desktop.needs).toBeUndefined();
    expect(native.jobs.desktop.strategy.matrix.shard).toBe(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression, not JavaScript.
      "${{ fromJSON(inputs.desktop_grep == '' && '[1,2,3]' || '[1]') }}",
    );
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression, not JavaScript.
    expect(native.jobs.desktop.with.shards).toBe("${{ inputs.desktop_grep == '' && 3 || 1 }}");
    expect(native.jobs.passed).toMatchObject({
      name: "Native validation passed",
      needs: ["unit", "desktop"],
      if: "always()",
    });
    const summary = native.jobs.passed.steps[0].run;
    expect(summary).toContain("Acceptance: release evidence");
    expect(summary).toContain("Diagnosis: not release evidence");
    expect(summary).toContain('test "$UNIT" = success && test "$DESKTOP" = success');
    expect(JSON.stringify(native)).not.toContain("secrets.");
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
    expect(release.jobs.mac.needs).toEqual(["preflight", "linux-check", "mac-unit", "mac-desktop"]);
    expect(release.jobs.mac["runs-on"]).toBe("macos-15");
    const tests = {
      "mac-unit": "unit",
      "mac-desktop": "desktop",
    };
    for (const [name, suite] of Object.entries(tests)) {
      const job = release.jobs[name];
      expect(job.needs).toEqual(["preflight", "linux-check"]);
      expect(job.uses).toBe("./.github/workflows/native-tests.yml");
      expect(job.secrets).toBeUndefined();
      expect(job.environment).toBeUndefined();
      expect(job.with).toMatchObject({ suite, release: true });
      if (suite === "desktop") {
        expect(job.strategy).toEqual({ "fail-fast": false, matrix: { shard: [1, 2, 3] } });
        // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression, not JavaScript.
        expect(job.with).toMatchObject({ shard: "${{ matrix.shard }}", shards: 3 });
      }
    }
    expect(release.concurrency["cancel-in-progress"]).toBe(false);
  });
  it("blocks promotion after failure, cancellation or skip of any required job", () => {
    const publish = release.jobs.publish;
    const required = [
      "preflight",
      "linux-check",
      "linux-installers",
      "mac-unit",
      "mac-desktop",
      "mac",
    ];
    expect(publish.needs).toEqual(required);
    expect(publish.if).toBe(
      `\${{ success() && ${required.map((name) => `needs.${name}.result == 'success'`).join(" && ")} }}`,
    );
    expect(publish.permissions).toEqual({ contents: "write" });
    expect(publish.concurrency.group).toBe("code60-release-publication");
    for (const [name, job] of Object.entries(release.jobs)) {
      if (name !== "publish")
        expect(job.permissions ?? release.permissions).toEqual({ contents: "read" });
    }
  });
  it("builds the validated SHA and downloads only this run's tested artifacts", () => {
    for (const name of ["mac-unit", "mac-desktop"]) {
      // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub expression, not JavaScript.
      expect(release.jobs[name].with.ref).toBe("${{ needs.preflight.outputs.sha }}");
    }
    for (const name of ["linux-check", "linux-installers", "mac"]) {
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
