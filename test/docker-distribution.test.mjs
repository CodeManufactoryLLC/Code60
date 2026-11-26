import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { parsePackageDockerArgs } from "../scripts/package-docker.mjs";
import {
  DEFAULT_DOCKERHUB_REPOSITORY,
  dockerTagsForRelease,
  normalizeDockerRepository,
} from "../scripts/release/docker-tags.mjs";
import { parseTestDockerArgs } from "../scripts/test-docker.mjs";

const dockerfile = await readFile(new URL("../docker/Dockerfile", import.meta.url), "utf8");
const compose = parse(await readFile(new URL("../docker/compose.yaml", import.meta.url), "utf8"));
const releaseWorkflow = parse(
  await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8"),
);
const publishDockerWorkflow = parse(
  await readFile(new URL("../.github/workflows/publish-docker.yml", import.meta.url), "utf8"),
);

describe("Docker Hub tag and repository validation", () => {
  it("defaults to mjholliday/code60 and rejects malformed repository names", () => {
    expect(DEFAULT_DOCKERHUB_REPOSITORY).toBe("mjholliday/code60");
    expect(normalizeDockerRepository(undefined)).toBe("mjholliday/code60");
    expect(normalizeDockerRepository("  ")).toBe("mjholliday/code60");
    expect(normalizeDockerRepository("codemanufactory/code60")).toBe("codemanufactory/code60");
    for (const bad of ["UPPER/code60", "noslash", "a/b/c", "-bad/name", "owner/name:tag"])
      expect(() => normalizeDockerRepository(bad)).toThrow("Invalid Docker Hub repository");
  });

  it("publishes rolling semver and latest tags only for stable releases", () => {
    expect(dockerTagsForRelease("v0.4.1")).toEqual({
      repository: "mjholliday/code60",
      version: "0.4.1",
      prerelease: false,
      tags: [
        "mjholliday/code60:0.4.1",
        "mjholliday/code60:0.4",
        "mjholliday/code60:0",
        "mjholliday/code60:latest",
      ],
    });
    expect(dockerTagsForRelease("v0.5.0-beta.1", "mjholliday/code60")).toEqual({
      repository: "mjholliday/code60",
      version: "0.5.0-beta.1",
      prerelease: true,
      tags: ["mjholliday/code60:0.5.0-beta.1"],
    });
  });
});

describe("Docker CLI helper argument parsing", () => {
  it("parses package-docker options cleanly and rejects malformed flags", () => {
    const cwd = "/tmp/code60-test";
    expect(
      parsePackageDockerArgs(
        [
          "release/payloads/linux-x64.json",
          "--tag",
          "mjholliday/code60:0.4.1",
          "--label",
          "com.code60.test=1",
          "--require-clean",
        ],
        cwd,
      ),
    ).toEqual({
      descriptorPath: resolve(cwd, "release/payloads/linux-x64.json"),
      stageOnly: undefined,
      requireClean: true,
      tags: ["mjholliday/code60:0.4.1"],
      labels: ["com.code60.test=1"],
    });
    expect(parsePackageDockerArgs(["--stage-only", "out/stage"], cwd).stageOnly).toBe(
      resolve(cwd, "out/stage"),
    );
    for (const bad of [
      ["--unknown"],
      ["--stage-only"],
      ["--tag"],
      ["--label", "no-equals"],
      ["a.json", "b.json"],
    ])
      expect(() => parsePackageDockerArgs(bad, cwd)).toThrow();
  });

  it("parses test-docker options cleanly and rejects malformed flags", () => {
    const cwd = "/tmp/code60-test";
    expect(parseTestDockerArgs([], cwd)).toEqual({
      descriptorPath: resolve(cwd, "release/payloads/linux-x64.json"),
      image: undefined,
    });
    expect(parseTestDockerArgs(["--image", "mjholliday/code60:0.4.1"], cwd).image).toBe(
      "mjholliday/code60:0.4.1",
    );
    for (const bad of [["--image"], ["--bad"], ["a.json", "b.json"]])
      expect(() => parseTestDockerArgs(bad, cwd)).toThrow();
  });
});

describe("Docker image and workflow definitions", () => {
  it("pins Debian Node 24 linux/amd64, runs non-root on port 6060, and uses tini", () => {
    expect(dockerfile).toContain(
      "FROM --platform=linux/amd64 node:24.22.0-bookworm-slim@sha256:a8efdaa8f2458a83ad61c9b8e957c94c2312a9e60604d5b9b093cf89ad9f5984",
    );
    expect(dockerfile).toContain("libgomp1");
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toContain("EXPOSE 6060");
    expect(dockerfile).toContain("CODE60_PORT=6060");
    expect(dockerfile).toContain('ENTRYPOINT ["/usr/bin/tini", "--", "code60-gateway"]');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal Compose interpolation
    expect(compose.services.code60.image).toBe("mjholliday/code60:${CODE60_IMAGE_TAG:-latest}");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal Compose interpolation
    expect(compose.services.code60.ports).toEqual(["127.0.0.1:${CODE60_HOST_PORT:-6060}:6060"]);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal Compose interpolation
    expect(compose.volumes["code60-home"]?.name).toBe("${CODE60_HOME_VOLUME:-code60-home}");
  });

  it("validates the Docker image in release.yml and gates Hub push behind dockerhub_release", () => {
    expect(releaseWorkflow.jobs.docker.needs).toEqual(["preflight", "payload"]);
    expect(
      releaseWorkflow.jobs.docker.steps.some(
        (step) => step.run === "npm run test:docker -- release/payloads/linux-x64.json",
      ),
    ).toBe(true);

    expect(Object.keys(publishDockerWorkflow.on)).toEqual(["workflow_dispatch"]);
    expect(publishDockerWorkflow.on.workflow_dispatch.inputs.push.default).toBe(false);
    expect(publishDockerWorkflow.jobs.preflight.if).toBe("github.ref == 'refs/heads/main'");
    expect(publishDockerWorkflow.jobs.publish.environment).toBe("dockerhub_release");
    expect(publishDockerWorkflow.jobs.publish.needs).toEqual(["preflight", "build-and-test"]);
    const pushStep = publishDockerWorkflow.jobs.publish.steps.find((step) =>
      step.uses?.startsWith("docker/build-push-action@"),
    );
    expect(pushStep.with).toMatchObject({
      platforms: "linux/amd64",
      push: true,
      provenance: true,
      sbom: true,
    });
  });
});
