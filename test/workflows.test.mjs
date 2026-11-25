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
    expect(ci.on).toHaveProperty("workflow_dispatch", null);
    expect(ci.jobs.passed.if).toBe("always()");
    expect(ci.jobs.passed.needs).toEqual([
      "impact",
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
    ]);
  });
});

describe("browser and package validation", () => {
  it("splits Linux payload production from independent verified acceptance consumers", () => {
    const producer = ci.jobs.payload;
    expect(producer.needs).toBe("impact");
    expect(producer["timeout-minutes"]).toBe(15);
    expect(
      producer.steps.some(
        (step) => step.run === "npm run devcontainer -- exec npm run package:payload",
      ),
    ).toBe(true);
    expect(
      producer.steps.some(
        (step) => step.run === "npm run devcontainer -- down" && step.if === "always()",
      ),
    ).toBe(true);
    const upload = producer.steps.find((step) => step.with?.name === "code60-linux-payload");
    expect(upload.if).toBeUndefined();
    expect(upload.with).toMatchObject({
      name: "code60-linux-payload",
      path: "release/payloads/",
      "if-no-files-found": "error",
    });
    for (const forbidden of [
      "process-identity.test.ts",
      "test:payload",
      "test:setup",
      "test:update",
      "test:uninstall",
      "test:installation",
      "test:packaged:clean",
      "test:packaged:concurrent",
    ]) {
      expect(producer.steps.some((step) => step.run?.includes(forbidden))).toBe(false);
    }

    const consumers = {
      "payload-acceptance": {
        evidence: "payload-acceptance-evidence",
        expectedRun: "npm run devcontainer -- exec npm run test:payload -- --workflows",
        needsHostBuild: false,
      },
      "payload-clean-install": {
        evidence: "payload-clean-install-evidence",
        expectedRun: "npm run test:packaged:clean -- --payload release/payloads/linux-x64.json",
        needsHostBuild: true,
      },
      update: {
        evidence: "offline-update-evidence",
        expectedRun: "npm run test:packaged:clean -- --update release/payloads/linux-x64.json",
        needsHostBuild: true,
      },
      uninstall: {
        evidence: "concurrent-uninstall-evidence",
        expectedRun:
          "npm run test:packaged:concurrent -- --uninstall release/payloads/linux-x64.json",
        needsHostBuild: true,
      },
    };
    for (const [name, spec] of Object.entries(consumers)) {
      const job = ci.jobs[name];
      expect(job.needs).toEqual(["impact", "payload"]);
      expect(job["timeout-minutes"]).toBe(30);
      expect(job.steps[0].with.ref).toBe(producer.steps[0].with.ref);
      const download = job.steps.findIndex((step) =>
        step.uses?.startsWith("actions/download-artifact@"),
      );
      const verify = job.steps.findIndex(
        (step) => step.run === "npm run verify:artifact -- release/payloads/linux-x64.json",
      );
      const run = job.steps.findIndex((step) => step.run === spec.expectedRun);
      expect(job.steps[download].with).toEqual({
        name: "code60-linux-payload",
        path: "release/payloads/",
      });
      expect(download).toBeLessThan(verify);
      expect(verify).toBeLessThan(run);
      if (spec.needsHostBuild) {
        const install = job.steps.findIndex(
          (step) => step.run === "ONNXRUNTIME_NODE_INSTALL=skip npm ci",
        );
        const build = job.steps.findIndex((step) => step.run === "npm run build:distribution");
        expect(install).toBeGreaterThanOrEqual(0);
        expect(build).toBeGreaterThan(install);
        expect(build).toBeLessThan(run);
      } else {
        const containerBuild = job.steps.findIndex(
          (step) => step.run === "npm run devcontainer -- exec npm run build",
        );
        expect(containerBuild).toBeGreaterThan(verify);
        expect(containerBuild).toBeLessThan(run);
        expect(
          job.steps.some(
            (step) => step.run === "npm run devcontainer -- down" && step.if === "always()",
          ),
        ).toBe(true);
      }
      const evidenceUpload = job.steps.find((step) => step.with?.name === spec.evidence);
      expect(evidenceUpload.if).toBe("always()");
      expect(evidenceUpload.with.path).toContain("test-results/artifact-handoff/");
    }

    const passedStep = ci.jobs.passed.steps.at(-1);
    expect(passedStep.env.CI_NEEDS).toContain("toJSON(needs)");
    expect(passedStep.run).toBe("node scripts/ci-impact.mjs gate");
  });
  it("requires real installed uninstall/reinstall and isolated native engine checks", () => {
    expect(
      ci.jobs.uninstall.steps.some(
        (step) =>
          step.run ===
          "npm run test:packaged:concurrent -- --uninstall release/payloads/linux-x64.json",
      ),
    ).toBe(true);
    for (const command of ["npm run test:uninstall", "npm run test:uninstall:engines"])
      expect(nativeTests.jobs.uninstall.steps.some((step) => step.run === command)).toBe(true);
    for (const [workflow, devcontainerJob] of [
      [ci, ci.jobs["payload-acceptance"]],
      [release, release.jobs.payload],
    ]) {
      const job = workflow.jobs.uninstall;
      expect([job.needs].flat()).toContain("payload");
      expect(job["timeout-minutes"]).toBe(30);
      expect(job.steps[0].with.ref).toBe(workflow.jobs.payload.steps[0].with.ref);
      const download = job.steps.findIndex((step) =>
        step.uses?.startsWith("actions/download-artifact@"),
      );
      const verify = job.steps.findIndex(
        (step) => step.run === "npm run verify:artifact -- release/payloads/linux-x64.json",
      );
      const run = job.steps.findIndex(
        (step) =>
          step.run ===
          "npm run test:packaged:concurrent -- --uninstall release/payloads/linux-x64.json",
      );
      expect(job.steps[download].with.name).toBe("code60-linux-payload");
      expect(download).toBeLessThan(verify);
      expect(verify).toBeLessThan(run);
      const build = job.steps.findIndex((step) => step.run === "npm run build:distribution");
      const install = job.steps.findIndex(
        (step) => step.run === "ONNXRUNTIME_NODE_INSTALL=skip npm ci",
      );
      expect(install).toBeGreaterThanOrEqual(0);
      expect(build).toBeGreaterThan(install);
      expect(build).toBeLessThan(run);
      expect(
        job.steps.some(
          (step) =>
            step.if === "always()" &&
            step.with?.path?.includes("test-results/clean-install-concurrent/"),
        ),
      ).toBe(true);
      expect(
        workflow.jobs.payload.steps.some((step) => step.run?.includes("test:packaged:concurrent")),
      ).toBe(false);
      expect(
        devcontainerJob.steps.some(
          (step) =>
            step.run ===
            "npm run devcontainer -- exec env CODE60_REQUIRE_NATIVE_PROCESS_INSPECTION=1 npx --no-install vitest run src/platform/process-identity.test.ts",
        ),
      ).toBe(true);
      expect(
        devcontainerJob.steps.some(
          (step) =>
            step.run ===
            "npm run devcontainer -- exec npm run test:uninstall:engines -- release/payloads/linux-x64.json",
        ),
      ).toBe(true);
      expect(
        devcontainerJob.steps.some((step) =>
          step.with?.path?.includes("test-results/uninstall-engines/"),
        ),
      ).toBe(true);
    }
    expect(nativeTests.jobs.uninstall.needs).toBe("test");
    expect(nativeTests.jobs.test["timeout-minutes"]).toBe(45);
    expect(nativeTests.jobs.uninstall["timeout-minutes"]).toBe(35);
    expect(nativeTests.jobs.test.steps.some((step) => step.run === "npm run test:uninstall")).toBe(
      false,
    );
    const steps = nativeTests.jobs.uninstall.steps;
    expect(steps.some((step) => step.run === "ONNXRUNTIME_NODE_INSTALL=skip npm ci")).toBe(true);
    const download = steps.findIndex((step) => step.uses?.startsWith("actions/download-artifact@"));
    expect(steps[download].with).toEqual({
      name: "code60-darwin-payload",
      path: "release/payloads/",
    });
    const verify = steps.findIndex(
      (step) => step.run === "npm run verify:artifact -- release/payloads/darwin-arm64.json",
    );
    expect(download).toBeLessThan(verify);
    expect(verify).toBeLessThan(steps.findIndex((step) => step.run === "npm run test:uninstall"));
    expect(steps[0].with).toMatchObject({
      ref: expect.stringMatching(/^\$\{\{ inputs\.ref \}\}$/),
      "persist-credentials": false,
    });
    expect(steps[0].with.ref).toBe(nativeTests.jobs.test.steps[0].with.ref);
    expect(
      nativeTests.jobs.uninstall.steps.find(
        (step) => step.with?.name === "native-uninstall-evidence",
      ).with.path,
    ).toContain("test-results/uninstall/");
    expect(
      ci.jobs["payload-clean-install"].steps.find(
        (step) => step.with?.name === "payload-clean-install-evidence",
      ).with.path,
    ).toContain("test-results/clean-install/");
    expect(
      ci.jobs.update.steps.find((step) => step.with?.name === "offline-update-evidence").with.path,
    ).toContain("test-results/clean-install/");
    expect(
      ci.jobs.uninstall.steps.find((step) => step.with?.name === "concurrent-uninstall-evidence")
        .with.path,
    ).toContain("test-results/clean-install-concurrent/");
    expect(
      release.jobs.uninstall.steps.some(
        (step) =>
          step.run ===
          "npm run test:packaged:concurrent -- --uninstall release/payloads/linux-x64.json",
      ),
    ).toBe(true);
  });
  it("requires packaged setup acceptance and keeps native setup behind isolated fixtures", () => {
    expect(
      ci.jobs["payload-acceptance"].steps.some(
        (step) => step.run === "npm run devcontainer -- exec npm run test:setup",
      ),
    ).toBe(true);
    expect(
      ci.jobs["payload-clean-install"].steps.some(
        (step) =>
          step.run === "npm run test:packaged:clean -- --setup release/payloads/linux-x64.json",
      ),
    ).toBe(true);
    expect(nativeTests.jobs.test.steps.some((step) => step.run === "npm run test:setup")).toBe(
      true,
    );
    expect(
      ci.jobs["payload-acceptance"].steps.some(
        (step) => step.run === "npm run devcontainer -- exec npm run test:update",
      ),
    ).toBe(true);
    const acceptanceCommands = ci.jobs["payload-acceptance"].steps.map((step) => step.run);
    const chromiumInstall = acceptanceCommands.indexOf(
      "npm run devcontainer -- exec npx --no-install playwright install chromium",
    );
    expect(chromiumInstall).toBeGreaterThanOrEqual(0);
    expect(chromiumInstall).toBeLessThan(
      acceptanceCommands.indexOf(
        "npm run devcontainer -- exec npm run test:payload -- --workflows",
      ),
    );
    expect(chromiumInstall).toBeLessThan(
      acceptanceCommands.indexOf("npm run devcontainer -- exec npm run test:update"),
    );
    expect(
      ci.jobs.update.steps.some(
        (step) =>
          step.run === "npm run test:packaged:clean -- --update release/payloads/linux-x64.json",
      ),
    ).toBe(true);
    expect(nativeTests.jobs.workflows.strategy.matrix.include[0].command).toBe(
      "npm run test:update",
    );
  });
  it("requires every native journey in bounded single-worker batches with separate evidence", () => {
    const job = nativeTests.jobs.workflows;
    const commands = job.strategy.matrix.include.map((entry) => entry.command).slice(1);
    expect(commands).toEqual([
      "npm run test:transmission -- --grep-invert 'native update:' --output test-results/transmission-native/regressions",
      "npm run test:transmission -- --grep 'native update:' --fully-parallel --shard=1/2 --output test-results/transmission-native/update-1",
      "npm run test:transmission -- --grep 'native update:' --fully-parallel --shard=2/2 --output test-results/transmission-native/update-2",
    ]);
    expect(job.needs).toBe("test");
    expect(job["timeout-minutes"]).toBe(35);
    expect(job.strategy["fail-fast"]).toBe(false);
    expect(job.strategy["max-parallel"]).toBe(2);
    expect(job.steps[0].with.ref).toBe(nativeTests.jobs.test.steps[0].with.ref);
    const download = job.steps.findIndex((step) =>
      step.uses?.startsWith("actions/download-artifact@"),
    );
    const verify = job.steps.findIndex(
      (step) => step.run === "npm run verify:artifact -- release/payloads/darwin-arm64.json",
    );
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
    const run = job.steps.findIndex((step) => step.run === "${{ matrix.command }}");
    expect(job.steps[download].with.name).toBe("code60-darwin-payload");
    expect(download).toBeLessThan(verify);
    expect(verify).toBeLessThan(run);
    expect(job.steps.some((step) => step.run === "npm run prepare:engines")).toBe(true);
    expect(
      job.steps.some(
        (step) =>
          // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
          step.if === "always()" && step.with?.name === "native-workflows-${{ matrix.name }}",
      ),
    ).toBe(true);
  });
  it("uses Node 24 and validates the real browser and installed package", () => {
    for (const name of ["check", "browser", "package"])
      expect(
        ci.jobs[name].steps.some(
          (step) =>
            step.uses?.startsWith("actions/setup-node") && step.with["node-version"] === "24",
        ),
      ).toBe(true);
    expect(ci.jobs.browser.steps.some((step) => step.run === "npm run test:browser")).toBe(true);
    expect(ci.jobs.package.steps.some((step) => step.run === "npm run test:packaged")).toBe(true);
    expect(ci.jobs["clean-install"].needs).toEqual(["impact", "package"]);
    expect(ci.jobs["clean-install"]["timeout-minutes"]).toBe(30);
    expect(
      ci.jobs["clean-install"].steps.some(
        (step) =>
          step.name === "Prepare isolated runner Docker engine" && step["timeout-minutes"] === 2,
      ),
    ).toBe(true);
    expect(
      ci.jobs["clean-install"].steps.some((step) => step.run === "npm run test:packaged:clean"),
    ).toBe(true);
    expect(ci.jobs.passed.steps.at(-1).env.CI_NEEDS).toContain("toJSON(needs)");
    expect(
      ci.jobs.payload.steps.some(
        (step) => step.run === "npm run devcontainer -- exec npm run package:payload",
      ),
    ).toBe(true);
    expect(
      ci.jobs["payload-clean-install"].steps.some(
        (step) =>
          step.run === "npm run test:packaged:clean -- --payload release/payloads/linux-x64.json",
      ),
    ).toBe(true);
    expect(ci.jobs.passed.steps.at(-1).run).toBe("node scripts/ci-impact.mjs gate");
    expect(
      ci.jobs["payload-clean-install"].steps.some(
        (step) =>
          step.run === "npm run test:packaged:clean -- --managed release/payloads/linux-x64.json",
      ),
    ).toBe(true);
    expect(
      ci.jobs["payload-acceptance"].steps.some(
        (step) =>
          step.run === "npm run devcontainer -- exec npm run test:installation -- --require-fish",
      ),
    ).toBe(true);
    expect(JSON.stringify(ci)).not.toContain("electron");
  });
  it("runs native Apple Silicon validation without signing secrets or real service installation", () => {
    expect(nativeTests.jobs.test["runs-on"]).toBe("macos-15");
    expect(JSON.stringify(nativeTests)).not.toContain("secrets.");
    expect(nativeTests.jobs.test.steps.some((step) => step.run === "npm run test:browser")).toBe(
      true,
    );
    expect(JSON.stringify(nativeTests)).not.toContain("service install");
    expect(native.jobs.mac.uses).toBe("./.github/workflows/native-tests.yml");
  });
  it("requires exact main-based release preflight and both native and Linux validation", () => {
    expect(Object.keys(release.on)).toEqual(["workflow_dispatch"]);
    expect(release.jobs.preflight.if).toBe("github.ref == 'refs/heads/main'");
    expect(release.jobs.package.needs).toEqual(["preflight", "mac"]);
    expect(release.jobs.payload.env).toEqual({ COMPOSE_BAKE: "false" });
    expect(release.jobs.bootstrap.needs).toEqual([
      "preflight",
      "mac",
      "package",
      "payload",
      "uninstall",
    ]);
    expect(nativeTests.jobs.test.steps.some((step) => step.run === "npm run test:payload")).toBe(
      true,
    );
    expect(JSON.stringify(release)).not.toContain("npm publish");
    expect(release.permissions).toEqual({ contents: "read" });
    expect(packageJson.scripts["test:browser"]).toBe("npm run build && playwright test");
  });
});

describe("impact-selected steps and unconditional release coverage", () => {
  const stepFor = (job, command) => job.steps.find((step) => step.run === command);
  it("binds each Linux payload scenario to its own condition", () => {
    const exec = "npm run devcontainer -- exec npm run ";
    for (const [jobName, suite, command] of [
      ["payload-acceptance", "engines", `${exec}test:payload -- --workflows`],
      ["payload-acceptance", "setup", `${exec}test:setup`],
      ["payload-acceptance", "shell", `${exec}test:installation -- --require-fish`],
      ["payload-acceptance", "update", `${exec}test:update`],
      [
        "payload-acceptance",
        "uninstall-engines",
        `${exec}test:uninstall:engines -- release/payloads/linux-x64.json`,
      ],
      ...[
        ["clean-payload", "payload"],
        ["managed", "managed"],
        ["clean-setup", "setup"],
      ].map(([key, mode]) => [
        "payload-clean-install",
        key,
        `npm run test:packaged:clean -- --${mode} release/payloads/linux-x64.json`,
      ]),
    ]) {
      expect(stepFor(ci.jobs[jobName], command)?.if).toBe(
        `contains(fromJSON(needs.impact.outputs.plan), '${suite}')`,
      );
      expect(stepFor(release.jobs.payload, command)).toBeDefined();
      expect(stepFor(release.jobs.payload, command).if).toBeUndefined();
    }
    expect(stepFor(ci.jobs["payload-acceptance"], `${exec}test:payload`).if).toContain(
      "'payload-smoke'",
    );
    expect(
      stepFor(
        release.jobs.payload,
        "npm run test:packaged:clean -- --update release/payloads/linux-x64.json",
      )?.if,
    ).toBeUndefined();
    expect(
      stepFor(
        release.jobs.uninstall,
        "npm run test:packaged:concurrent -- --uninstall release/payloads/linux-x64.json",
      )?.if,
    ).toBeUndefined();
    expect(stepFor(release.jobs.package, "npm run test:packaged:clean").if).toBeUndefined();
    expect(stepFor(release.jobs.package, "node scripts/test-rag-model.mjs").if).toBeUndefined();
  });

  it("selects native suites for PRs and defaults to all native checks for a release", () => {
    expect(ci.jobs.mac.with.suites).toContain("needs.impact.outputs.plan");
    expect(release.jobs.mac.with.ref).toContain("needs.preflight.outputs.sha");
    expect(release.jobs.mac.with.suites).toBeUndefined();
    expect(JSON.parse(nativeTests.on.workflow_call.inputs.suites.default)).toEqual(["mac-full"]);
    for (const [command, suite] of [
      ["npm run test:setup", "mac-setup"],
      ["npm run test:installation -- --require-fish", "mac-shell"],
      ["npm run test:packaged", "mac-package"],
      ["npm run test:payload", "mac-payload"],
    ]) {
      const condition = stepFor(nativeTests.jobs.test, command).if;
      expect(condition).toContain("'mac-full'");
      expect(condition).toContain(`'${suite}'`);
    }
    expect(nativeTests.jobs.workflows.if).toContain("'mac-full'");
    expect(nativeTests.jobs.workflows.if).toContain("'mac-update'");
    expect(nativeTests.jobs.workflows.if).toContain("'mac-engines'");
    expect(nativeTests.jobs.workflows.strategy.matrix.include.map((entry) => entry.suite)).toEqual([
      "mac-update",
      "mac-engines",
      "mac-engines",
      "mac-engines",
    ]);
    expect(nativeTests.jobs.uninstall.if).toContain("'mac-full'");
    expect(nativeTests.jobs.uninstall.if).toContain("'mac-uninstall'");
    for (const job of [
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
    ]) {
      expect(ci.jobs[job].if).toBe(`contains(fromJSON(needs.impact.outputs.jobs), '${job}')`);
    }
  });
});
