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

  it("requires reviewed PRs, resolved discussions, and prevents destructive branch updates", () => {
    expect(protection.rules.map((rule) => rule.type).sort()).toEqual([
      "deletion",
      "non_fast_forward",
      "pull_request",
      "required_status_checks",
    ]);
    const pullRequest = protection.rules.find((rule) => rule.type === "pull_request");
    expect(pullRequest.parameters).toMatchObject({
      required_approving_review_count: 1,
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
    expect(ci.jobs.passed.needs).toEqual(["check", "desktop", "windows"]);
  });
});

describe("CI and release gates", () => {
  it("checks Linux and native Windows without signing secrets or publication rights", () => {
    expect(ci.permissions).toEqual({ contents: "read" });
    for (const [name, job] of Object.entries(ci.jobs))
      expect(job["runs-on"]).toBe(name === "windows" ? "windows-2025" : "ubuntu-24.04");
    expect(JSON.stringify(ci)).not.toContain("secrets.");
    expect(ci.jobs.check.strategy.matrix.node).toEqual(["22.12", "24"]);
    expect(ci.jobs.passed.name).toBe("CI passed");
    expect(ci.jobs.passed.if).toBe("always()");
    expect(ci.jobs.passed.needs).toEqual(["check", "desktop", "windows"]);
    expect(ci.jobs.passed.steps[0].run).toBe(
      'test "$CHECK" = success && test "$DESKTOP" = success && test "$WINDOWS" = success',
    );
  });
  it("requires an explicit dispatch on main, then Linux success before Mac", () => {
    expect(Object.keys(release.on)).toEqual(["workflow_dispatch"]);
    expect(release.jobs.preflight.if).toBe("github.ref == 'refs/heads/main'");
    expect(release.jobs["linux-check"].needs).toBe("preflight");
    expect(release.jobs["linux-installers"].needs).toEqual(["preflight", "linux-check"]);
    expect(release.jobs.mac.needs).toEqual(["preflight", "linux-installers"]);
    expect(release.jobs.mac["runs-on"]).toBe("macos-15");
    expect(release.jobs.windows.needs).toEqual(["preflight", "linux-installers"]);
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
      if (name !== "publish")
        expect(job.permissions ?? release.permissions).toEqual({ contents: "read" });
    }
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
