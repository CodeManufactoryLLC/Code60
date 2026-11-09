import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [mode, directory] = process.argv.slice(2);
if (mode === "worker") {
  const startup = performance.now();
  const { DesktopLogStore, LOG_QUOTA } = await import("../dist/desktop/log-store.js");
  const { parseLogQuery } = await import("../dist/bridge/index.js");
  const store = new DesktopLogStore(directory);
  const importMs = performance.now() - startup;
  const initialRss = process.memoryUsage().rss;
  const delay = monitorEventLoopDelay({ resolution: 1 });
  delay.enable();
  await new Promise((done) => setImmediate(done));
  const query = parseLogQuery({
    scope: "all",
    limit: 200,
    conditions: Array.from({ length: 24 }, () => ({
      column: "message",
      op: "contains",
      value: "Desktop",
    })),
    columnConditions: Array.from({ length: 24 }, () => ({
      column: "message",
      op: "contains",
      value: "Desktop",
    })),
  });
  let start = performance.now();
  const first = await store.query(query);
  const queryMs = performance.now() - start;
  assert.equal(first.records.length, 200);
  assert.ok(first.cursor);
  start = performance.now();
  const filtered = await store.query(
    parseLogQuery({
      scope: "all",
      search: "not-present-in-any-record-".repeat(10).slice(0, 200),
      limit: 200,
    }),
  );
  const noMatchMs = performance.now() - start;
  assert.equal(filtered.records.length, 0);
  start = performance.now();
  for (let index = 0; index < 512; index++)
    store.sink({
      event: "turn.end",
      operationId: randomUUID(),
      outcome: "succeeded",
    });
  const captureMs = performance.now() - start;
  start = performance.now();
  assert.equal(await store.flush(2000), true);
  const flushMs = performance.now() - start;
  const status = store.status();
  assert.equal(status.dropped, 0);
  assert.equal(status.persistenceFailures, 0);
  const names = (await readdir(directory)).filter((name) => name.endsWith(".jsonl"));
  const bytes = (
    await Promise.all(names.map(async (name) => (await stat(join(directory, name))).size))
  ).reduce((a, b) => a + b, 0);
  assert.ok(bytes <= LOG_QUOTA);
  for (let index = 0; index < 512; index++)
    store.sink({
      event: "turn.end",
      operationId: randomUUID(),
      outcome: "succeeded",
    });
  start = performance.now();
  const closeFlushed = await store.close();
  const closeMs = performance.now() - start;
  delay.disable();
  await store.flush(2000);
  console.log(
    JSON.stringify({
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      importMs,
      queryMs,
      noMatchMs,
      capture512Ms: captureMs,
      flush512Ms: flushMs,
      closeMs,
      closeFlushed,
      closeDropped: store.status().dropped,
      maxEventLoopDelayMs: delay.max / 1e6,
      rssGrowthMiB: (process.memoryUsage().rss - initialRss) / 1048576,
      peakRssMiB: process.resourceUsage().maxRSS / 1024,
      retainedBytes: bytes,
      status,
    }),
  );
} else {
  const { DesktopLogStore, LOG_QUOTA } = await import("../dist/desktop/log-store.js");
  const { privateDirectory, writePrivateFile } = await import("../dist/platform/index.js");
  const fixture = await realpath(await mkdtemp(join(tmpdir(), "code60-log-benchmark-")));
  try {
    const logs = join(fixture, "code60", "logs");
    await privateDirectory(logs);
    const launch = new DesktopLogStore(logs).appLaunchId;
    const now = Date.now();
    let records = 0;
    let segments = 0;
    const fragmented = process.argv.includes("--fragmented");
    const writeSegment = async (size, at) => {
      const lines = [];
      let bytes = 0;
      while (bytes + 384 <= size) {
        const record = {
          version: 1,
          id: randomUUID(),
          timestamp: new Date(Math.min(now - records, at)).toISOString(),
          event: "app.start",
          component: "desktop",
          message: "Desktop startup started",
          outcome: "started",
          severity: "info",
          operationId: randomUUID(),
          appLaunchId: launch,
        };
        const text = JSON.stringify(record);
        assert.ok(Buffer.byteLength(text) < 384);
        lines.push(`${text}${" ".repeat(383 - Buffer.byteLength(text))}\n`);
        bytes += 384;
        records++;
      }
      // Keep every segment exactly full without exceeding the 2 KiB record cap.
      const last = lines.pop();
      lines.push(`${last.slice(0, -1)}${" ".repeat(size - bytes)}\n`);
      await writePrivateFile(join(logs, `${at}-${randomUUID()}.jsonl`), lines.join(""), {
        mode: 0o600,
        flag: "wx",
      });
      segments++;
    };
    let remaining = LOG_QUOTA;
    if (fragmented) {
      // A quiet seven-day history can have far more files than a dense 80-segment quota.
      for (let segment = 0; segment < 10000; segment++) {
        await writeSegment(384, now - (10000 - segment) * 60000);
        remaining -= 384;
      }
    }
    while (remaining) {
      const size = Math.min(256 * 1024, remaining);
      await writeSegment(size, now - 80000 + segments);
      remaining -= size;
    }
    console.log(
      JSON.stringify({
        fixtureBytes: LOG_QUOTA,
        records,
        segments,
        fragmented,
        conditions: 48,
        pageLimit: 200,
      }),
    );
    const cold = performance.now();
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [join(root, "scripts/benchmark-logs.mjs"), "worker", logs],
      { cwd: root, timeout: 60000 },
    );
    console.log(stdout.trim());
    console.log(JSON.stringify({ freshProcessWallMs: performance.now() - cold }));
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}
