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
    expect(ci.jobs.passed.if).toBe("always()");
    expect(ci.jobs.passed.needs).toEqual([
      "check",
      "browser",
      "package",
      "clean-install",
      "payload",
    ]);
  });
});

describe("browser and package validation", () => {
  it("requires packaged setup acceptance and keeps native setup behind isolated fixtures", () => {
    expect(
      ci.jobs.payload.steps.some(
        (step) => step.run === "npm run devcontainer -- exec npm run test:setup",
      ),
    ).toBe(true);
    expect(
      ci.jobs.payload.steps.some(
        (step) =>
          step.run === "npm run test:packaged:clean -- --setup release/payloads/linux-x64.json",
      ),
    ).toBe(true);
    expect(nativeTests.jobs.test.steps.some((step) => step.run === "npm run test:setup")).toBe(
      true,
    );
    expect(
      ci.jobs.payload.steps.some(
        (step) => step.run === "npm run devcontainer -- exec npm run test:update",
      ),
    ).toBe(true);
    expect(nativeTests.jobs.test.steps.some((step) => step.run === "npm run test:update")).toBe(
      true,
    );
    expect(
      nativeTests.jobs.test.steps.some((step) => step.run === "npm run test:transmission"),
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
    expect(ci.jobs["clean-install"].needs).toBe("package");
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
    expect(ci.jobs.passed.steps[0].env.CLEAN_INSTALL).toContain("needs.clean-install.result");
    expect(
      ci.jobs.payload.steps.some(
        (step) => step.run === "npm run devcontainer -- exec npm run package:payload",
      ),
    ).toBe(true);
    expect(
      ci.jobs.payload.steps.some(
        (step) =>
          step.run === "npm run test:packaged:clean -- --payload release/payloads/linux-x64.json",
      ),
    ).toBe(true);
    expect(ci.jobs.passed.steps[0].env.PAYLOAD).toContain("needs.payload.result");
    expect(
      ci.jobs.payload.steps.some(
        (step) =>
          step.run === "npm run test:packaged:clean -- --managed release/payloads/linux-x64.json",
      ),
    ).toBe(true);
    expect(
      ci.jobs.payload.steps.some(
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
    expect(release.jobs.bootstrap.needs).toEqual(["preflight", "mac", "payload"]);
    expect(nativeTests.jobs.test.steps.some((step) => step.run === "npm run test:payload")).toBe(
      true,
    );
    expect(JSON.stringify(release)).not.toContain("npm publish");
    expect(release.permissions).toEqual({ contents: "read" });
    expect(packageJson.scripts["test:browser"]).toBe("npm run build && playwright test");
  });
});
