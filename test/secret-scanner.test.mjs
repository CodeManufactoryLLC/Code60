import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARCHIVES,
  downloadArchive,
  safeFindings,
  scan,
  VERSION,
  verifyArchive,
} from "../scripts/scan-secrets.mjs";

let directory;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "code60-scanner-test-"));
});
afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

describe("pinned secret scanner", () => {
  it("pins checksums for supported platforms and rejects tampered downloads", () => {
    expect(VERSION).toBe("8.30.1");
    for (const [asset, digest] of Object.values(ARCHIVES)) {
      expect(asset).toMatch(/\.(tar\.gz|zip)$/);
      expect(digest).toMatch(/^[a-f0-9]{64}$/);
    }
    const bytes = Buffer.from("synthetic archive");
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(() => verifyArchive(bytes, digest)).not.toThrow();
    expect(() => verifyArchive(Buffer.from("tampered"), digest)).toThrow(/checksum mismatch/);
  });

  it("retries a server failure once through the same official asset and verifies its checksum", async () => {
    const bytes = Buffer.from("synthetic archive");
    const asset = ["linux_x64.tar.gz", createHash("sha256").update(bytes).digest("hex")];
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 504 }))
      .mockResolvedValueOnce(new Response(bytes));
    expect(await downloadArchive(asset, request)).toEqual(bytes);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_linux_x64.tar.gz`,
      `https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_linux_x64.tar.gz?download=1`,
    ]);
    for (const [, options] of request.mock.calls)
      expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it("never accepts changed bytes or retries indefinitely or on missing assets", async () => {
    const asset = ["linux_x64.tar.gz", createHash("sha256").update("expected").digest("hex")];
    const tampered = vi.fn().mockResolvedValue(new Response("changed"));
    await expect(downloadArchive(asset, tampered)).rejects.toThrow("checksum mismatch");
    expect(tampered).toHaveBeenCalledTimes(1);
    for (const [status, count] of [
      [404, 1],
      [504, 2],
    ]) {
      const failed = vi.fn(async () => new Response("unavailable", { status }));
      await expect(downloadArchive(asset, failed)).rejects.toThrow(`HTTP ${status}`);
      expect(failed).toHaveBeenCalledTimes(count);
    }
  });

  it("scans all history and current files without inline or fingerprint bypasses", async () => {
    const run = vi.fn(async (_binary, args) => {
      const report = args[args.indexOf("--report-path") + 1];
      await writeFile(report, "[]");
    });
    expect(await scan("/scanner", "git", directory, directory, run)).toEqual([]);
    expect(await scan("/scanner", "dir", directory, directory, run)).toEqual([]);
    expect(run.mock.calls[0][1]).toContain("--log-opts=--all --full-history");
    for (const [, args, options] of run.mock.calls) {
      expect(args).toContain("--redact=100");
      expect(args).toContain("--ignore-gitleaks-allow");
      expect(args).toContain("--gitleaks-ignore-path");
      expect(args).not.toContain("--baseline-path");
      expect(options.timeout).toBeGreaterThan(0);
    }
  });

  it("retains only safe finding locations even when scanner data contains a secret", async () => {
    const finding = {
      RuleID: "synthetic-rule",
      File: ".env.local",
      StartLine: 1,
      Commit: "",
      Secret: "never print",
      Match: "never print",
      Author: "private author",
      Email: "private email",
      Message: "private message",
    };
    const run = async (_binary, args) => {
      await writeFile(args[args.indexOf("--report-path") + 1], JSON.stringify([finding]));
      throw Object.assign(new Error("private stderr"), { code: 10 });
    };
    expect(await scan("/scanner", "dir", directory, directory, run)).toEqual([
      {
        source: "dir",
        rule: "synthetic-rule",
        file: ".env.local",
        line: 1,
        commit: "",
      },
    ]);
    expect(JSON.stringify(safeFindings([finding], "git"))).not.toMatch(/private|never print/);
  });

  it("fails closed for execution errors, missing/invalid reports, and inconsistent status", async () => {
    await expect(
      scan("/scanner", "git", directory, directory, async () => {
        throw Object.assign(new Error("private stderr"), { code: 2 });
      }),
    ).rejects.toThrow("could not complete");
    await expect(scan("/scanner", "git", directory, directory, async () => {})).rejects.toThrow();
    await writeFile(join(directory, "git-report.json"), "{}");
    await expect(scan("/scanner", "git", directory, directory, async () => {})).rejects.toThrow();
    await writeFile(join(directory, "git-report.json"), "[]");
    await expect(
      scan("/scanner", "git", directory, directory, async () => {
        throw Object.assign(new Error("private stderr"), { code: 10 });
      }),
    ).rejects.toThrow(/disagree/);
  });

  it("excludes generated artifacts, not tests or environment files", async () => {
    const config = await readFile(new URL("../.gitleaks.toml", import.meta.url), "utf8");
    expect(config).toContain("useDefault = true");
    expect(config).toContain("node_modules");
    expect(config).not.toMatch(/disabledRules|stopwords|commits\s*=|\.env|tests?\//);
  });
});
