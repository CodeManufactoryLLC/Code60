import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UsageStore } from "../core/index.js";
import { parseUsageCliArgs, runUsageCli } from "./usage.js";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "code60-cli-usage-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("code60 usage CLI", () => {
  it("validates flags and rejects bad arguments", () => {
    const parsed = parseUsageCliArgs([
      "--since",
      "30d",
      "--provider",
      "claude",
      "--surface",
      "workflow",
      "--format",
      "markdown",
      "--turns",
      "--limit",
      "25",
    ]);
    expect(parsed.query).toEqual({ range: "30d", provider: "claude", surface: "workflow" });
    expect(parsed.format).toBe("markdown");
    expect(parsed.turns).toBe(true);
    expect(parsed.limit).toBe(25);

    expect(() => parseUsageCliArgs(["--format", "xml"])).toThrow(/Invalid --format/);
    expect(() => parseUsageCliArgs(["--surface", "bogus"])).toThrow(/Invalid --surface/);
    expect(() => parseUsageCliArgs(["--force"])).toThrow(/--force requires --out/);
    expect(() => parseUsageCliArgs(["--limit", "0"])).toThrow(/Invalid --limit/);
    expect(() => parseUsageCliArgs(["--unknown"])).toThrow(/Unknown option/);
  });

  it("reads offline SQLite store, renders table/json/markdown/csv, and guards --out overwrite", async () => {
    const state = tempDir();
    const store = new UsageStore(join(state, "code60", "usage"));
    store.record({
      at: new Date().toISOString(),
      provider: "claude",
      model: "claude-sonnet-4",
      sessionId: "s-1",
      turn: 1,
      stopReason: "end_turn",
      durationMs: 1_500,
      attribution: { surface: "relay", conversationId: "relay-1" },
      reported: {
        inputTokens: 10_000,
        outputTokens: 500,
        cachedReadTokens: 8_000,
        totalTokens: 10_500,
      },
      reportedScope: "turn",
      cost: { delta: 0.025, cumulative: 0.025, currency: "USD" },
      context: {
        usedBefore: 8_000,
        usedAfter: 10_500,
        peakUsed: 10_500,
        windowSize: 200_000,
        snapshots: [{ used: 10_500, size: 200_000 }],
        updatesCount: 1,
        compacted: false,
      },
      observed: {
        promptChars: 100,
        promptBytes: 100,
        promptCodeRatio: 0,
        messageChars: 200,
        messageBytes: 200,
        messageCodeRatio: 0,
        thoughtChars: 0,
        thoughtBytes: 0,
        toolCallCount: 1,
        toolWaves: 1,
        toolPayloadChars: 40,
        toolPayloadBytes: 40,
        rawAcpBytes: 600,
      },
    });
    store.close();

    const env = { ...process.env, XDG_STATE_HOME: state };
    const offlineOnly = async () => {
      throw new Error("gateway offline");
    };

    let tableOut = "";
    await runUsageCli(["--turns"], env, {
      stdout: (text) => {
        tableOut += text;
      },
      requestOnline: offlineOnly,
    });
    expect(tableOut).toContain("Code60 Token Usage Report");
    expect(tableOut).toContain("claude");
    expect(tableOut).toContain("Turn Audit Log");

    let jsonOut = "";
    await runUsageCli(["--format", "json"], env, {
      stdout: (text) => {
        jsonOut += text;
      },
      requestOnline: offlineOnly,
    });
    expect(JSON.parse(jsonOut).report.totals.totalTokens).toBe(10_500);

    const outPath = join(state, "report.md");
    await runUsageCli(["--format", "markdown", "--out", outPath], env, {
      stdout: () => {},
      requestOnline: offlineOnly,
    });
    expect(readFileSync(outPath, "utf8")).toContain("# Code60 Token Usage Report");

    // Refuses overwrite without --force
    await expect(
      runUsageCli(["--format", "markdown", "--out", outPath], env, {
        stdout: () => {},
        requestOnline: offlineOnly,
      }),
    ).rejects.toThrow(/EEXIST/);

    // Allows overwrite with --force
    await runUsageCli(["--format", "csv", "--out", outPath, "--force"], env, {
      stdout: () => {},
      requestOnline: offlineOnly,
    });
    expect(readFileSync(outPath, "utf8")).toContain("est_total_tokens");
  });
});
