import * as fs from "node:fs/promises";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configPath, DEFAULT_CONFIG, loadConfig, parseConfig, parseDuration } from "./config.js";
import { decide, parseToolKinds } from "./policy.js";
import { createRecordStore, directoryRunsDir, type RecordFs, runsDir } from "./records.js";
import type { RunRecord } from "./types.js";

describe("parseDuration", () => {
  it.each([
    ["30m", 1_800_000],
    ["90s", 90_000],
    ["1h30m", 5_400_000],
    ["500ms", 500],
  ])("parses %s", (text, ms) => {
    expect(parseDuration(text)).toBe(ms);
  });

  it.each(["", "30", "m", "1.5h", "-1m", "0s", "30 minutes"])("rejects %j", (text) => {
    expect(() => parseDuration(text)).toThrow(/duration/);
  });

  it.each(["9007199254740992ms", `${"9".repeat(400)}h`])(
    "rejects overflowing duration %s",
    (text) => {
      expect(() => parseDuration(text)).toThrow(/safe integer/);
    },
  );
});

describe("config", () => {
  it("uses XDG_CONFIG_HOME, then ~/.config", () => {
    expect(configPath({ XDG_CONFIG_HOME: "/x" })).toBe("/x/code60/config.json");
    expect(configPath({ HOME: "/home/u" })).toBe("/home/u/.config/code60/config.json");
  });

  it("returns the defaults when the file is missing", async () => {
    const enoent = Object.assign(new Error("missing"), { code: "ENOENT" });
    const config = await loadConfig(
      { readFile: () => Promise.reject(enoent) },
      { XDG_CONFIG_HOME: "/x" },
    );
    expect(config).toEqual(DEFAULT_CONFIG);
    expect(config.agents.droid?.command).toEqual(["droid", "exec", "--output-format", "acp"]);
  });

  it("merges user agents and permissions over the defaults", () => {
    const config = parseConfig({
      defaultAgent: "mine",
      maxParallel: 2,
      permissions: { execute: "allow", edit: "ask" },
      agents: { mine: { command: ["my-agent", "--acp"] } },
    });
    expect(config.agents.mine?.command).toEqual(["my-agent", "--acp"]);
    expect(config.agents.claude).toBeDefined();
    expect(config.permissions).toMatchObject({
      read: "allow",
      edit: "ask",
      execute: "allow",
      default: "ask",
    });
    expect(config.maxParallel).toBe(2);
  });

  it("merges prompt template overrides over the built-in templates", () => {
    const config = parseConfig({ prompts: { handoffTurn: "{{summary}}\n---\n{{message}}" } });
    expect(config.prompts.handoffTurn).toBe("{{summary}}\n---\n{{message}}");
    expect(config.prompts.handoffSummary).toBe(DEFAULT_CONFIG.prompts.handoffSummary);
  });

  it.each([
    [[], /must be a JSON object/],
    [{ bogus: 1 }, /unknown key 'bogus'/],
    [{ maxParallel: 0 }, /maxParallel/],
    [{ turnTimeout: "soon" }, /turnTimeout/],
    [{ permissions: { teleport: "allow" } }, /unknown tool-call kind 'teleport'/],
    [{ permissions: { read: "maybe" } }, /permissions.read/],
    [{ agents: { x: { command: [] } } }, /agents.x.command/],
    [{ defaultAgent: "nobody" }, /defaultAgent 'nobody'/],
    [{ defaultAgent: "toString" }, /not a configured agent/],
    [{ maxParallel: Number.POSITIVE_INFINITY }, /maxParallel/],
    [{ agents: { x: { command: ["agent"], cwd: "/elsewhere" } } }, /unknown key 'cwd'/],
    [{ prompts: [] }, /prompts must be an object/],
    [{ prompts: { other: "x" } }, /prompts: unknown key 'other'/],
    [{ prompts: { handoffSummary: 1 } }, /prompts.handoffSummary must be a string/],
    [
      { prompts: { handoffSummary: "{{nope}}" } },
      /prompts.handoffSummary: unknown merge field 'nope'/,
    ],
    [{ prompts: { handoffTurn: "{{summary}}" } }, /prompts.handoffTurn: must include/],
  ])("rejects invalid config %j", (raw, message) => {
    expect(() => parseConfig(raw)).toThrow(message);
  });

  it("reports invalid JSON as a usage error", async () => {
    await expect(
      loadConfig({ readFile: async () => "{" }, { XDG_CONFIG_HOME: "/x" }),
    ).rejects.toThrow(/invalid JSON/);
  });
});

describe("policy", () => {
  const policy = DEFAULT_CONFIG.permissions;

  it("applies the policy, with ask denied in headless mode", () => {
    expect(decide("read", policy, "headless")).toBe("allow");
    expect(decide("execute", policy, "interactive")).toBe("ask");
    expect(decide("execute", policy, "headless")).toBe("deny");
    expect(decide("delete", { ...policy, delete: "deny" }, "interactive")).toBe("deny");
  });

  it("lets flags override the policy", () => {
    expect(decide("execute", policy, "headless", { allow: ["execute"] })).toBe("allow");
    expect(decide("delete", { ...policy, delete: "deny" }, "interactive", { allowAll: true })).toBe(
      "allow",
    );
    expect(decide("fetch", policy, "headless", { allow: ["execute"] })).toBe("deny");
  });

  it("validates --allow kinds", () => {
    expect(parseToolKinds(["execute", "switch_mode"])).toEqual(["execute", "switch_mode"]);
    expect(() => parseToolKinds(["teleport"])).toThrow(/unknown tool-call kind 'teleport'/);
  });
});

describe("record store", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "code60-records-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const record = (id: string, startedAt: string): RunRecord => ({
    id,
    agent: "claude",
    status: "queued",
    firstPrompt: "do it",
    turns: 0,
    base: "abc",
    branch: `code60/${id}`,
    worktree: `/w/${id}`,
    ownerPid: 1,
    startedAt,
  });

  it("writes run.json atomically and appends events, both with mode 0600", async () => {
    const store = createRecordStore(fs as unknown as RecordFs, runsDir(dir));
    const r = record("r1", "2026-01-01T00:00:00.000Z");
    await Promise.all([
      store.save(r),
      store.save({ ...r, status: "running" }),
      ...Array.from({ length: 20 }, (_, i) =>
        store.appendEvent({ runId: "r1", at: "t", type: "message", text: String(i) }),
      ),
    ]);
    const runDir = join(dir, "code60", "runs", "r1");
    expect((await readdir(runDir)).sort()).toEqual(["events.jsonl", "run.json"]);
    expect((await stat(join(runDir, "run.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(runDir, "events.jsonl"))).mode & 0o777).toBe(0o600);
    expect((await store.read("r1")).status).toBe("running");
    const events = await store.readEvents("r1");
    expect(events.map((e) => (e.type === "message" ? e.text : ""))).toEqual(
      Array.from({ length: 20 }, (_, i) => String(i)),
    );
    expect(JSON.parse(await readFile(join(runDir, "run.json"), "utf8")).id).toBe("r1");
  });

  it("reports missing transcripts instead of treating a failed read as empty history", async () => {
    const store = createRecordStore(fs as unknown as RecordFs, runsDir(dir));
    await store.save(record("missing", "2026-01-01T00:00:00Z"));
    await expect(store.readEvents("missing")).rejects.toThrow(
      "Could not read events.jsonl for run 'missing'",
    );
  });

  it("keys records outside a repository by directory", () => {
    expect(directoryRunsDir("/state", "/a")).toBe(directoryRunsDir("/state", "/a"));
    expect(directoryRunsDir("/state", "/a")).not.toBe(directoryRunsDir("/state", "/b"));
    expect(directoryRunsDir("/state", "/a")).toMatch(/^\/state\/code60\/dirs\/[0-9a-f]{16}\/runs$/);
  });

  it("lists runs by start time and rejects unknown or unsafe IDs", async () => {
    const store = createRecordStore(fs as unknown as RecordFs, runsDir(dir));
    expect(await store.list()).toEqual([]);
    await store.save(record("b", "2026-01-02T00:00:00.000Z"));
    await store.save(record("a", "2026-01-03T00:00:00.000Z"));
    expect((await store.list()).map((r) => r.id)).toEqual(["b", "a"]);
    await expect(store.read("zzz")).rejects.toThrow(/no run with ID 'zzz'/);
    await expect(store.read("../x")).rejects.toThrow(/invalid run ID/);
  });

  it("reads older records without an ACP session ID", async () => {
    const store = createRecordStore(fs as unknown as RecordFs, runsDir(dir));
    const legacy = record("legacy", "2026-01-01T00:00:00.000Z");
    await store.save(legacy);
    expect(await store.read("legacy")).not.toHaveProperty("acpSessionId");
  });

  it("writes format 1, reads unversioned records, and refuses newer formats", async () => {
    const store = createRecordStore(fs as unknown as RecordFs, runsDir(dir));
    const original = record("r1", "2026-01-01T00:00:00.000Z");
    await store.save(original);
    const path = join(runsDir(dir), "r1", "run.json");
    expect(JSON.parse(await readFile(path, "utf8")).format).toBe(1);
    expect(await store.read("r1")).toEqual(original);
    await fs.writeFile(path, JSON.stringify(original));
    expect(await store.read("r1")).toEqual(original);
    await fs.writeFile(path, JSON.stringify({ ...original, format: 2 }));
    await expect(store.read("r1")).rejects.toThrow("created by a newer version of Code60");
    expect(await store.list()).toEqual([]);
  });

  it("rejects malformed records and mismatched IDs without exposing their contents", async () => {
    const store = createRecordStore(fs as unknown as RecordFs, runsDir(dir));
    const valid = record("r1", "2026-01-01T00:00:00.000Z");
    await store.save(valid);
    const path = join(runsDir(dir), "r1", "run.json");
    const secret = "private prompt must never appear in an error";
    for (const invalid of [
      null,
      { ...valid, status: secret },
      { ...valid, ownerPid: -1 },
      { ...valid, agentPid: 0 },
      { ...valid, turns: 1.5 },
      ...[0, -1, 1.5, "1", null].map((format) => ({ ...valid, format })),
      { ...valid, id: "r2" },
      { ...valid, base: null },
      { ...valid, firstPrompt: { secret } },
      { ...valid, lastStopReason: "unexpected" },
    ]) {
      await fs.writeFile(path, JSON.stringify(invalid));
      await expect(store.read("r1")).rejects.toThrow("Invalid run.json for run 'r1'");
      expect(await store.list()).toEqual([]);
    }
    await fs.writeFile(path, secret);
    await expect(store.read("r1")).rejects.toThrow("Invalid run.json for run 'r1'");
    await fs.writeFile(path, JSON.stringify({ ...valid, base: null, branch: null, future: true }));
    expect(await store.read("r1")).toEqual({ ...valid, base: null, branch: null });
  });

  it("validates every event variant and rejects events belonging to another run", async () => {
    const store = createRecordStore(fs as unknown as RecordFs, runsDir(dir));
    await store.save(record("r1", "2026-01-01T00:00:00.000Z"));
    const path = join(runsDir(dir), "r1", "events.jsonl");
    const envelope = { runId: "r1", at: "2026-01-01T00:00:00.000Z" };
    const bodies = [
      { type: "status", status: "idle" },
      { type: "prompt", turn: 1, text: "hello" },
      { type: "message", text: "reply" },
      { type: "thought", text: "thinking" },
      { type: "toolCall", toolCallId: "t1", title: "Read", kind: "read", status: "completed" },
      {
        type: "permission",
        toolCallId: "t1",
        title: "Read",
        kind: "read",
        decision: "allowed",
        by: "user",
      },
      { type: "stderr", text: "diagnostic" },
      { type: "note", text: "Reconnected" },
      { type: "turnEnd", turn: 1, stopReason: "max_tokens" },
      { type: "acp", update: "plan", payload: '{"sessionUpdate":"plan","entries":[]}', size: 37 },
      { type: "acp", update: "plan", payload: '{"sessionUpdate":', size: 300000, truncated: true },
      {
        type: "permission",
        toolCallId: "t2",
        title: "Edit",
        kind: "edit",
        decision: "denied",
        by: "policy",
        options: [{ optionId: "once", name: "Allow once", kind: "allow_once" }],
      },
    ];
    const events = bodies.map((body) => ({ ...envelope, ...body }));
    await fs.writeFile(path, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    expect(await store.readEvents("r1")).toEqual(events);
    for (const invalid of [
      { ...envelope, type: "message", text: 42 },
      { ...envelope, type: "message", text: "private", runId: "r2" },
      { ...envelope, type: "prompt", turn: 0, text: "private" },
      {
        ...envelope,
        type: "permission",
        toolCallId: "t1",
        title: "Read",
        kind: "read",
        decision: "allow_always",
        by: "user",
      },
      { ...envelope, type: "future", runId: "r2" },
      { ...envelope, type: 42 },
      { ...envelope, type: "turnEnd", turn: 0, stopReason: "end_turn" },
      { ...envelope, type: "acp", update: "plan", payload: 42, size: 1 },
    ]) {
      await fs.writeFile(path, `${JSON.stringify(events[0])}\n${JSON.stringify(invalid)}\n`);
      await expect(store.readEvents("r1")).rejects.toThrow(
        "Invalid events.jsonl for run 'r1' at event 2",
      );
    }
    await fs.writeFile(
      path,
      [
        JSON.stringify(events[0]),
        JSON.stringify({ ...envelope, type: "future", payload: { anything: true } }),
        JSON.stringify(events[1]),
      ].join("\n"),
    );
    expect(await store.readEvents("r1")).toEqual(events.slice(0, 2));
  });
});
