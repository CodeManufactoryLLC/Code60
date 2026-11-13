import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("..", import.meta.url));
const [mode, directory, expectedSourceHash] = process.argv.slice(2);
if (mode === "worker") {
  const began = performance.now();
  const initialRss = process.memoryUsage().rss;
  const delay = monitorEventLoopDelay({ resolution: 1 });
  delay.enable();
  const { DEFAULT_CONFIG, defaultDeps } = await import("../dist/core/index.js");
  const { RelayStore } = await import("../dist/desktop/relay-store.js");
  const { RelayService } = await import("../dist/desktop/relay-service.js");
  const read = RelayStore.prototype.history;
  let historyBytesRead = 0;
  let sourceMaxBytesRead = 0;
  RelayStore.prototype.history = async function (...args) {
    const page = await read.apply(this, args);
    historyBytesRead += page.bytesRead;
    return page;
  };
  const readSource = RelayStore.prototype.source;
  RelayStore.prototype.source = async function (...args) {
    const page = await readSource.apply(this, args);
    sourceMaxBytesRead = Math.max(sourceMaxBytesRead, page.bytesRead);
    return page;
  };
  const deps = defaultDeps();
  const delivered = [];
  const agents = {
    ...deps.agents,
    start: async (...args) => {
      const session = await deps.agents.start(...args);
      return {
        ...session,
        prompt: (text) => {
          delivered.push(text);
          return session.prompt(text);
        },
      };
    },
  };
  let notify;
  const relay = new RelayService(
    { ...deps, agents },
    { ...process.env, XDG_STATE_HOME: directory },
    () => notify?.(),
  );
  const until = (predicate) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Relay fixture timed out")), 10_000);
      notify = () => {
        const snapshot = relay.snapshot();
        if (snapshot.error || snapshot.run?.status === "failed") {
          clearTimeout(timeout);
          reject(new Error("Relay fixture connection failed"));
        } else if (predicate(snapshot)) {
          clearTimeout(timeout);
          resolve(snapshot);
        }
      };
      notify();
    });
  try {
    await relay.sync("claude", {
      ...DEFAULT_CONFIG,
      agents: {
        claude: {
          ...DEFAULT_CONFIG.agents.claude,
          command: [process.execPath, join(root, "test/fixtures/fake-agent.mjs")],
        },
      },
    });
    const snapshot = await until((snapshot) => snapshot.run?.status === "idle");
    const startupMs = performance.now() - began;
    const startupBytesRead = historyBytesRead;
    const history = snapshot.history;
    assert.ok(history);
    assert.equal(snapshot.run.turns, 0);
    assert.equal(delivered.length, 0);
    assert.equal(history.incomplete, false);
    assert.equal([...history.serialized].length, history.characters);
    assert.ok(history.characters <= 64_000);
    assert.ok(startupBytesRead < 512_000);
    let started = performance.now();
    if (history.cursor)
      await relay.action({ type: "history", id: snapshot.run.id, before: history.cursor });
    const olderPageMs = performance.now() - started;
    assert.equal(delivered.length, 0);
    assert.ok(relay.snapshot().history.characters <= 64_000);
    assert.ok(historyBytesRead - startupBytesRead < 512_000);
    const excerpt = history.messages.find((message) => message.partial && message.source);
    let sourceCopyMs;
    let sourceCharacters;
    if (excerpt) {
      const digest = createHash("sha256");
      sourceCharacters = 0;
      started = performance.now();
      let cursor;
      do {
        const page = await relay.readMessage({
          conversationId: snapshot.conversationId,
          source: excerpt.source,
          ...(cursor ? { cursor } : {}),
        });
        digest.update(page.text);
        sourceCharacters += [...page.text].length;
        assert.ok([...page.text].length <= 16_000);
        cursor = page.cursor;
      } while (cursor);
      sourceCopyMs = performance.now() - started;
      assert.equal(digest.digest("hex"), expectedSourceHash);
      assert.ok(sourceMaxBytesRead <= 132_106);
      assert.equal(delivered.length, 0);
    } else assert.equal(expectedSourceHash, undefined);
    started = performance.now();
    await relay.action({
      type: "send",
      id: snapshot.run.id,
      text: "Benchmark explicit human request",
    });
    await until((snapshot) => snapshot.run?.status === "idle" && snapshot.run.turns === 1);
    const firstSendMs = performance.now() - started;
    assert.equal(delivered.length, 1);
    assert.ok(delivered[0].includes(history.serialized));
    await relay.action({
      type: "send",
      id: snapshot.run.id,
      text: "Benchmark second explicit human request",
    });
    await until((snapshot) => snapshot.run?.status === "idle" && snapshot.run.turns === 2);
    assert.equal(delivered.length, 2);
    assert.ok(!delivered[1].includes(history.serialized));
    delay.disable();
    console.log(
      JSON.stringify({
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        startupMs,
        startupBytesRead,
        olderPageMs,
        firstSendMs,
        historyCharacters: history.characters,
        ...(sourceCopyMs === undefined
          ? {}
          : {
              sourceCopyMs,
              sourceCharacters,
              sourceMaxBytesRead,
            }),
        maxEventLoopDelayMs: delay.max / 1e6,
        parentRssGrowthMiB: (process.memoryUsage().rss - initialRss) / 1048576,
        parentPeakRssMiB: process.resourceUsage().maxRSS / 1024,
      }),
    );
  } finally {
    delay.disable();
    await relay.shutdown(true);
  }
} else {
  const { RelayStore } = await import("../dist/desktop/relay-store.js");
  const fixture = await realpath(await mkdtemp(join(tmpdir(), "code60-relay-benchmark-")));
  try {
    for (const { messages, oversized } of [
      { messages: 1 },
      { messages: 512 },
      { messages: 8192 },
      { messages: 1, oversized: true },
    ]) {
      const directory = join(fixture, oversized ? "oversized" : String(messages));
      const store = await RelayStore.open(join(directory, "code60", "relay"));
      let sourceHash;
      try {
        for (let index = 0; index < messages; index++) {
          const text = `Synthetic history ${index}\n${"😀".repeat(oversized ? 500_000 : 15_900)}`;
          if (oversized) sourceHash = createHash("sha256").update(text).digest("hex");
          await store.append({
            id: randomUUID(),
            role: index % 2 ? "assistant" : "human",
            at: "2026-11-02T12:00:00.000Z",
            text,
          });
        }
      } finally {
        await store.close();
      }
      const journalBytes = (await stat(join(store.root, "history.frames"))).size;
      const began = performance.now();
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [fileURLToPath(import.meta.url), "worker", directory, ...(sourceHash ? [sourceHash] : [])],
        { cwd: root, timeout: 20_000, maxBuffer: 64 * 1024 },
      );
      console.log(
        JSON.stringify({
          messages,
          ...(oversized ? { oversized: true } : {}),
          journalBytes,
          ...JSON.parse(stdout.trim()),
          freshProcessWallMs: performance.now() - began,
        }),
      );
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}
