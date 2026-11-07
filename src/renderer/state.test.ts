import { describe, expect, it } from "vitest";
import type { DesktopRun, Snapshot } from "../bridge/index.js";
import {
  applyCase,
  applyUpdate,
  defaultTextStyles,
  fitWidths,
  fontFamily,
  hasOrchestrationProvider,
  letterSpacing,
  migrateAppearance,
  migrateTypography,
  parseFitColumns,
  parseRowDensity,
  parseTableLines,
  parseTextStyles,
  parseTheme,
  parseTypeface,
  resolveText,
  rowHeight,
  sessionRows,
  textStyleProperties,
  transcript,
} from "./state.js";

const snapshot = (revision: number, directory = "/repo"): Snapshot => ({
  versions: {
    code60: "0.0.0-test",
    databaseSchema: 3,
    runRecordFormat: 1,
    acpProtocol: 1,
    mcpProtocol: "2025-03-26",
    electron: null,
    chromium: null,
    node: "22.12.0",
  },
  chats: [],
  chat: {
    run: null,
    directory: null,
    error: null,
    events: [],
    updates: { paused: false, pending: 0 },
  },
  orchestration: { provider: null, allowAll: true, connection: "idle", error: null },
  revision,
  database: "/db.sqlite",
  databaseError: null,
  projects: [],
  configurations: [],
  directory,
  agents: ["claude"],
  defaultAgent: "claude",
  maxParallel: 4,
  turnTimeout: "30m",
  runs: [],
  liveIds: [],
  active: false,
  warnings: [],
  events: [],
  worktrees: null,
  files: null,
  polling: { paused: false, sources: [] },
  prompts: [],
  workers: [],
});
const entry = (revision: number, text: string) => ({
  revision,
  event: { runId: "r1", at: "t", type: "message" as const, text },
});

describe("desktop stream state", () => {
  it("merges background chat events once and preserves them when selecting another chat", () => {
    const initial = snapshot(1);
    const makeChat = (id: string) => ({
      ...initial.chat,
      run: {
        id,
        agent: "claude",
        status: "idle" as const,
        turns: 0,
        branch: null,
        worktree: `/db/${id}`,
        pending: [],
        stopping: false,
      },
    });
    const first = makeChat("r1");
    const second = makeChat("r2");
    initial.chat = first;
    initial.chats = [first, second];
    const state = applyUpdate(undefined, initial);
    const next = snapshot(3, "/another-project");
    next.chat = second;
    next.chats = [
      { ...first, events: [entry(2, "background")] },
      {
        ...second,
        events: [
          { ...entry(3, "selected"), event: { ...entry(3, "selected").event, runId: "r2" } },
        ],
      },
    ];
    const merged = applyUpdate(state, next);
    expect(merged.chatEventsByRun.r1).toEqual([entry(2, "background").event]);
    expect(merged.chatEvents.map((event) => ("text" in event ? event.text : ""))).toEqual([
      "selected",
    ]);
    const selected = { ...next, revision: 4, chat: first };
    const switched = applyUpdate(merged, selected);
    expect(switched.chatEvents).toEqual([entry(2, "background").event]);
    expect(switched.chatEventsByRun.r2).toHaveLength(1);
    expect(applyUpdate(undefined, next).chatEventsByRun).toEqual(merged.chatEventsByRun);
    const replaced = { ...selected, revision: 5, chats: [second], chat: second };
    expect(applyUpdate(switched, replaced).chatEventsByRun.r1).toBeUndefined();
  });

  it("retains orchestration messages across project changes, deduplicates reloads, and resets for replacement sessions", () => {
    const initial = snapshot(2);
    initial.chat.run = {
      id: "chat-1",
      agent: "claude",
      status: "idle",
      turns: 1,
      branch: null,
      worktree: "/db/.code60_workspace",
      pending: [],
      stopping: false,
    };
    const event = (revision: number, text: string, runId = "chat-1") => ({
      revision,
      event: { type: "message" as const, runId, at: "t", text },
    });
    initial.chat.events = [event(2, "one")];
    const first = applyUpdate(undefined, initial);
    const switched = snapshot(3, "/other-project");
    switched.chat.run = initial.chat.run;
    switched.chat.events = [event(2, "one"), event(3, "two")];
    const next = applyUpdate(first, switched);
    expect(next.chatEvents.map((entry) => (entry.type === "message" ? entry.text : ""))).toEqual([
      "one",
      "two",
    ]);
    expect(applyUpdate(next, switched)).toBe(next);
    const reloaded = {
      ...switched,
      chat: { ...switched.chat, events: [event(2, "one"), event(3, "two")] },
    };
    expect(applyUpdate(undefined, reloaded).chatEvents).toEqual(next.chatEvents);
    const replaced = snapshot(4);
    if (!initial.chat.run) throw new Error("Missing initial chat fixture");
    replaced.chat.run = { ...initial.chat.run, id: "chat-2" };
    replaced.chat.events = [event(3, "old"), event(4, "fresh", "chat-2")];
    expect(applyUpdate(next, replaced).chatEvents).toEqual([event(4, "fresh", "chat-2").event]);
  });
  it("requires a saved, available orchestrator for splash entry", () => {
    const current = snapshot(1);
    expect(hasOrchestrationProvider(undefined)).toBe(false);
    expect(hasOrchestrationProvider(current)).toBe(false);
    current.orchestration.provider = "missing";
    expect(hasOrchestrationProvider(current)).toBe(false);
    current.orchestration.provider = "claude";
    expect(hasOrchestrationProvider(current)).toBe(false);
    current.agentSetup = {
      complete: true,
      primary: "claude",
      enabled: ["claude"],
      providers: [],
      session: null,
    };
    expect(hasOrchestrationProvider(current)).toBe(true);
    current.agents = [];
    expect(hasOrchestrationProvider(current)).toBe(false);
  });
  it("resets every appearance setting once, leaves other data intact, and preserves later choices", () => {
    const values = new Map([
      ["code60.theme", "dark"],
      ["code60.textStyles", '{"normalText":{"typeface":"georgia"}}'],
      ["code60.typeface", "d-din"],
      ["code60.tableLines", '{"horizontal":false}'],
      ["code60.rowDensity", "low"],
      ["code60.tableView.v1:sessions", "old presentation"],
      ["code60.fitColumns", "true"],
      ["code60.signals", "on"],
      ["code60.appearanceVersion", "signature-2"],
      ["unrelated", "keep"],
      ["code60.filters.v1:sessions:project", "saved definitions"],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    migrateAppearance(storage);
    expect([...values]).toEqual([
      ["code60.appearanceVersion", "theme-4"],
      ["unrelated", "keep"],
      ["code60.filters.v1:sessions:project", "saved definitions"],
    ]);
    expect(
      resolveText(parseTextStyles(storage.getItem("code60.textStyles")), "normalText").family,
    ).toMatch(/^"D-DIN"/);
    values.set("code60.theme", "light");
    values.set("code60.textStyles", '{"normalText":{"typeface":"georgia"}}');
    values.set("code60.tableLines", '{"horizontal":false,"vertical":false,"heading":false}');
    values.set("code60.rowDensity", "medium");
    const chosen = [...values];
    migrateAppearance(storage);
    expect([...values]).toEqual(chosen);
  });

  it("defaults every category to D-DIN Regular and sentence case", () => {
    for (const role of [
      "tableHeadings",
      "buttons",
      "agentMessages",
      "humanMessages",
      "pageTitles",
      "normalText",
    ] as const)
      expect(resolveText(defaultTextStyles, role)).toMatchObject({
        family: fontFamily("d-din"),
        weight: 400,
      });
    expect(resolveText(defaultTextStyles, "tableHeadings")).toMatchObject({
      size: 12,
      weight: 400,
      case: undefined,
    });
    expect(resolveText(defaultTextStyles, "pageTitles")).toMatchObject({ size: 18, weight: 400 });
    expect(parseTextStyles(JSON.stringify(defaultTextStyles))).toEqual(defaultTextStyles);
    expect(defaultTextStyles.normalText).toEqual({});
  });

  it("updates only typography once and preserves sizes, case and later choices", () => {
    const values = new Map([
      ["code60.typographyVersion", "old"],
      ["code60.theme", "dark"],
      ["code60.tableView.v1:sessions", "saved layout"],
      [
        "code60.textStyles",
        JSON.stringify({
          normalText: { typeface: "georgia", weight: 700, size: 22, case: "lower" },
          humanMessages: { typeface: "ibm-plex-serif", weight: 600 },
        }),
      ],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    migrateTypography(storage);
    const styles = parseTextStyles(storage.getItem("code60.textStyles"));
    for (const role of Object.keys(defaultTextStyles) as (keyof typeof defaultTextStyles)[])
      expect(resolveText(styles, role)).toMatchObject({ family: fontFamily("d-din"), weight: 400 });
    expect(styles.normalText).toEqual({ size: 22, case: "lower" });
    expect(storage.getItem("code60.theme")).toBe("dark");
    expect(storage.getItem("code60.tableView.v1:sessions")).toBe("saved layout");
    expect(storage.getItem("code60.typographyVersion")).toBe("d-din-regular-1");
    storage.setItem("code60.textStyles", '{"normalText":{"typeface":"georgia","weight":700}}');
    const later = [...values];
    migrateTypography(storage);
    expect([...values]).toEqual(later);
  });

  it("validates stored role styles without accepting arbitrary fonts or values", () => {
    const styles = parseTextStyles(
      JSON.stringify({
        tableHeadings: { typeface: "georgia", size: 18, weight: 700, case: "upper" },
        buttons: { typeface: "url(remote)", size: 49, weight: 800, case: "capitalize" },
        agentMessages: { size: 7 },
        humanMessages: { size: 12.5 },
        normalText: { size: "14" },
      }),
    );
    expect(styles.tableHeadings).toEqual({
      typeface: "georgia",
      size: 18,
      weight: 700,
      case: "upper",
    });
    expect(styles.buttons).toEqual({});
    expect(styles.agentMessages).toEqual({});
    expect(styles.humanMessages).toEqual({});
    expect(styles.normalText).toEqual({});
    for (const invalid of ["invalid", "null", "4"])
      expect(parseTextStyles(invalid)).toEqual(defaultTextStyles);
  });

  it("resolves independent roles, produces removable overrides, and changes only displayed case", () => {
    const styles = parseTextStyles(
      JSON.stringify({
        normalText: { typeface: "d-din", size: 22, weight: 700, case: "lower" },
        tableHeadings: { typeface: "georgia", size: 16, weight: 500, case: "upper" },
      }),
    );
    expect(resolveText(styles, "tableHeadings")).toEqual({
      family: "Georgia, serif",
      spacing: "normal",
      size: 16,
      weight: 500,
      case: "upper",
    });
    expect(resolveText(styles, "buttons")).toMatchObject({
      size: 13,
      weight: 400,
      case: undefined,
    });
    expect(resolveText(styles, "normalText")).toMatchObject({ weight: 700, case: "lower" });
    expect(textStyleProperties(styles)).toMatchObject({
      "--heading-size": "16px",
      "--heading-weight": "500",
      "--heading-case": "uppercase",
      "--text-size": "22px",
      "--text-case": "lowercase",
    });
    expect(textStyleProperties(defaultTextStyles)).toMatchObject({
      "--heading-size": "12px",
      "--heading-weight": "400",
      "--heading-case": undefined,
      "--text-size": "13px",
    });
    expect(applyCase("Agent ID", "upper")).toBe("AGENT ID");
    expect(applyCase("Agent ID", "lower")).toBe("agent id");
    expect(applyCase("Agent ID", undefined)).toBe("Agent ID");
    const preserveCase = parseTextStyles('{"tableHeadings":{"case":"none"}}');
    expect(resolveText(preserveCase, "tableHeadings").case).toBe("none");
    expect(textStyleProperties(preserveCase)["--heading-case"]).toBe("none");
    expect(applyCase("Agent ID", "none")).toBe("Agent ID");
  });
  it("does not lose or duplicate events when a snapshot overlaps buffered updates", () => {
    let state = applyUpdate(undefined, { ...snapshot(5), events: [entry(1, "a"), entry(4, "b")] });
    state = applyUpdate(state, { ...snapshot(7), events: [entry(4, "b"), entry(6, "c")] });
    expect(state.events.r1?.map((event) => event.type === "message" && event.text)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(applyUpdate(state, snapshot(5))).toBe(state);
    expect(applyUpdate(state, snapshot(7))).toBe(state);
  });

  it("clears transcripts when switching workspaces", () => {
    const state = applyUpdate(undefined, { ...snapshot(2), events: [entry(1, "private")] });
    expect(applyUpdate(state, snapshot(3, "/other")).events).toEqual({});
  });

  it("joins message chunks and updates tools without creating duplicate cards", () => {
    const base = { runId: "r1", at: "t" };
    const blocks = transcript([
      { ...base, type: "message", text: "<script>" },
      { ...base, type: "message", text: "literal text" },
      {
        ...base,
        type: "toolCall",
        toolCallId: "x",
        title: "test",
        kind: "execute",
        status: "pending",
      },
      {
        ...base,
        type: "toolCall",
        toolCallId: "x",
        title: "test",
        kind: "execute",
        status: "completed",
      },
      { ...base, type: "status", status: "idle", reason: "turn 1 ended: end_turn" },
      { ...base, type: "prompt", turn: 2, text: "next" },
      { ...base, type: "stderr", text: "diagnostics" },
      { ...base, type: "note", text: "Started a fresh session.", detail: "summary" },
      { ...base, type: "note", text: "Reconnected." },
    ]);
    expect(blocks.slice(4)).toEqual([
      { key: "7", type: "note", text: "Started a fresh session.", detail: "summary" },
      { key: "8", type: "note", text: "Reconnected." },
    ]);
    blocks.splice(4);
    expect(blocks).toHaveLength(4);
    expect(blocks[0]?.text).toBe("<script>literal text");
    expect(blocks[1]?.text).toBe("test\nexecute / completed");
    // Status changes, speakers, and turn numbers are not shown in the chat.
    expect(blocks.map((block) => [block.type, block.text])).toEqual([
      ["message", "<script>literal text"],
      ["toolCall", "test\nexecute / completed"],
      ["prompt", "next"],
      ["stderr", "diagnostics"],
    ]);
  });

  it("supports light, dark, and system appearance, mapping retired Paper selections to Light", () => {
    expect(["light", "paper", "dark", "system", null, "invalid"].map(parseTheme)).toEqual([
      "light",
      "light",
      "dark",
      "system",
      "system",
      "system",
    ]);
  });
});

describe("sessionRows", () => {
  const run = (
    id: string,
    startedAt: string,
    extra: Partial<DesktopRun["record"]> = {},
  ): DesktopRun =>
    ({
      record: {
        id,
        agent: "claude",
        status: "finished",
        firstPrompt: "",
        turns: 1,
        base: "abc",
        branch: `code60/${id}`,
        worktree: "/w",
        ownerPid: 1,
        startedAt,
        ...extra,
      },
      agentAlive: false,
    }) as DesktopRun;

  it("orders newest first and formats IDs, branches, and discarded runs", () => {
    const rows = sessionRows([
      run("20260101-aaaaaa", "2026-01-01T00:00:00.000Z", { branch: null, base: null }),
      run("20260102-bbbbbb", "2026-01-02T00:00:00.000Z", {
        status: "timed_out",
        agentPid: 4321,
        discardedAt: "2026-01-03T00:00:00.000Z",
      }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["20260102-bbbbbb", "20260101-aaaaaa"]);
    expect(rows[0]).toMatchObject({
      shortId: "bbbbbb",
      status: "timed_out",
      statusLabel: "Timed out / discarded",
      branch: "code60/20260102-bbbbbb",
      approvals: 0,
      pid: 4321,
    });
    expect(rows[1]).toMatchObject({
      shortId: "aaaaaa",
      branch: null,
      pid: null,
      statusLabel: "Finished",
    });
  });

  it("prefers the live view's status, turns, and pending approvals", () => {
    const live = run("20260101-cccccc", "2026-01-01T00:00:00.000Z");
    live.view = {
      status: "waiting",
      turns: 3,
      pending: [{ id: "x#1" }, { id: "x#2" }],
    } as unknown as NonNullable<DesktopRun["view"]>;
    expect(sessionRows([live])[0]).toMatchObject({
      status: "waiting",
      statusLabel: "Needs approval",
      turns: 3,
      approvals: 2,
    });
  });
});

describe("table line settings", () => {
  it("defaults to tonal rows without gridlines", () => {
    const rules = { horizontal: false, vertical: false, heading: false };
    expect(parseTableLines(null)).toEqual(rules);
    expect(parseTableLines("not json")).toEqual(rules);
  });

  it("keeps stored booleans and ignores invalid values", () => {
    expect(parseTableLines('{"horizontal":true,"vertical":true,"heading":true}')).toEqual({
      horizontal: true,
      vertical: true,
      heading: true,
    });
    expect(parseTableLines('{"horizontal":false}')).toEqual({
      horizontal: false,
      vertical: false,
      heading: false,
    });
    expect(parseTableLines('{"horizontal":"no","vertical":1,"heading":0}')).toEqual({
      horizontal: false,
      vertical: false,
      heading: false,
    });
  });
});

describe("fit columns to width", () => {
  it("is off unless stored as true", () => {
    expect([null, "false", "1", "true"].map(parseFitColumns)).toEqual([false, false, false, true]);
  });

  it("scales widths to fill the space exactly, keeping proportions", () => {
    expect(fitWidths([100, 200, 100], 800)).toEqual([200, 400, 200]);
    expect(fitWidths([100, 200, 100], 200)).toEqual([50, 100, 50]);
    const odd = fitWidths([95, 125, 70], 1001);
    expect(odd.reduce((sum, width) => sum + width, 0)).toBe(1001);
  });

  it("keeps a minimum width when the space is too small", () => {
    expect(fitWidths([100, 200, 100], 30)).toEqual([20, 20, 20]);
    expect(fitWidths([], 500)).toEqual([]);
  });
});

describe("row density setting", () => {
  it("defaults to high and keeps known densities", () => {
    expect(parseRowDensity(null)).toBe("high");
    expect(parseRowDensity("dense")).toBe("high");
    expect(parseRowDensity("high")).toBe("high");
    expect(parseRowDensity("low")).toBe("low");
  });

  it("gives denser settings shorter rows", () => {
    expect([rowHeight("high"), rowHeight("medium"), rowHeight("low")]).toEqual([24, 32, 44]);
  });
});

describe("typeface setting", () => {
  it("defaults to the system font and keeps known typefaces", () => {
    expect(parseTypeface(null)).toBe("system");
    expect(parseTypeface("comic-sans")).toBe("system");
    expect(parseTypeface("d-din")).toBe("d-din");
    expect(parseTypeface("roboto")).toBe("roboto");
    expect(parseTypeface("system")).toBe("system");
  });

  it("falls back to the system font for removed typefaces", () => {
    for (const removed of ["fractal-monolith-grotesk", "kryon-null-grotesk", "quantum-grotesk"]) {
      expect(parseTypeface(removed)).toBe("system");
      expect(
        parseTextStyles(JSON.stringify({ normalText: { typeface: removed } })).normalText,
      ).toEqual({});
    }
  });

  it("maps typefaces to font stacks with fallbacks", () => {
    expect(fontFamily("d-din")).toMatch(/^"D-DIN", -apple-system/);
    expect(fontFamily("computer-modern")).toBe('"CMU Serif", Georgia, serif');
  });

  it("uses normal letter spacing for the bundled typefaces", () => {
    expect(letterSpacing("d-din")).toBe("normal");
    expect(letterSpacing("ocr-a")).toBe("normal");
  });
});
