import { describe, expect, it } from "vitest";
import {
  PROMPT_TEMPLATE_LIMIT,
  parseAction,
  parseBoolean,
  parseConfigurationId,
  parseDatabaseMode,
  parseFileContext,
  parseOrchestrationChatAction,
  parseOrchestrationProvider,
  parsePollKeys,
  parsePollSettings,
  parsePollVisibility,
  parseProjectPath,
  parsePromptTemplateId,
  parseRunSettings,
  parseSaveConfiguration,
  parseSavePromptTemplate,
  parseStart,
  parseUpdateAction,
} from "./index.js";

describe("desktop IPC validation", () => {
  it("allows only fixed update actions, never URLs, paths or commands", () => {
    for (const action of [
      "status",
      "check",
      "download",
      "cancel",
      "install",
      "auto-on",
      "auto-off",
    ])
      expect(parseUpdateAction(action)).toBe(action);
    for (const value of [
      null,
      undefined,
      "",
      "https://example.invalid",
      { action: "install", path: "/tmp/file" },
    ])
      expect(() => parseUpdateAction(value)).toThrow();
  });
  it("preserves POSIX file names while rejecting Windows devices, streams and ambiguous names", () => {
    const context = (root: string, preview: string) => ({
      project: root,
      root,
      directories: [""],
      preview,
    });
    for (const path of ["con.txt", "name:stream", "a?b", "trailing.", "space "]) {
      expect(parseFileContext(context("/repo", path))).toEqual(context("/repo", path));
      expect(() => parseFileContext(context("C:\\repo", path))).toThrow();
    }
    expect(parseFileContext(context("D:\\雪 project", "src/雪.ts"))).toEqual(
      context("D:\\雪 project", "src/雪.ts"),
    );
    for (const path of ["../escape", "src\\escape", "/absolute", "a\0b"])
      expect(() => parseFileContext(context("C:\\repo", path))).toThrow();
    for (const root of ["C:repo", "\\\\server\\share", "\\\\?\\C:\\repo", "C:\\repo:stream"])
      expect(() => parseProjectPath(root)).toThrow();
  });

  it("validates orchestration chat messages and session-bound controls", () => {
    expect(parseOrchestrationChatAction({ type: "send", id: "run-1", text: "hello" })).toEqual({
      type: "send",
      id: "run-1",
      text: "hello",
    });
    expect(parseOrchestrationChatAction({ type: "restart", id: null })).toEqual({
      type: "restart",
      id: null,
    });
    expect(parseOrchestrationChatAction({ type: "resume-updates", id: "run-1" })).toEqual({
      type: "resume-updates",
      id: "run-1",
    });
    for (const value of [
      { type: "send", id: null, text: "hello" },
      { type: "send", id: "run-1", text: "   " },
      { type: "send", id: "run-1", text: "a".repeat(1_000_001) },
      { type: "stop", id: "../run" },
      { type: "resume-updates", id: null },
      { type: "restart", id: null, command: ["sh"] },
      { type: "send", id: "run-1", text: "hello", directory: "/tmp" },
      { type: "delete", id: "run-1" },
    ])
      expect(() => parseOrchestrationChatAction(value)).toThrow();
  });
  it("accepts only a bounded provider name or an explicit unset", () => {
    expect(parseOrchestrationProvider("claude")).toBe("claude");
    expect(parseOrchestrationProvider(null)).toBeNull();
    for (const value of [
      undefined,
      "",
      "  ",
      "a\nb",
      "x".repeat(129),
      false,
      { provider: "claude", allowAll: false },
    ])
      expect(() => parseOrchestrationProvider(value)).toThrow();
  });
  it("accepts only known prompt templates with valid merge fields", () => {
    expect(parsePromptTemplateId("handoffTurn")).toBe("handoffTurn");
    for (const value of ["other", "", null, 1])
      expect(() => parsePromptTemplateId(value)).toThrow();
    expect(parseSavePromptTemplate({ id: "handoffTurn", template: "Hi {{message}}" })).toEqual({
      id: "handoffTurn",
      template: "Hi {{message}}",
    });
    for (const value of [
      { id: "handoffTurn", template: "{{summary}}" },
      { id: "handoffSummary", template: "{{nope}}" },
      { id: "handoffSummary", template: "" },
      { id: "handoffSummary", template: "x".repeat(PROMPT_TEMPLATE_LIMIT + 1) },
      { id: "handoffSummary", template: 5 },
      { id: "other", template: "x" },
      { id: "handoffTurn", template: "{{message}}", extra: true },
      "handoffTurn",
    ])
      expect(() => parseSavePromptTemplate(value)).toThrow();
  });
  it("validates polling requests", () => {
    expect(parsePollKeys(["history", "worktrees"])).toEqual(["history", "worktrees"]);
    for (const value of [[], ["history", "history"], ["unknown"], "history", null])
      expect(() => parsePollKeys(value)).toThrow();
    expect(parsePollKeys(["files"])).toEqual(["files"]);
    const history = { intervalMs: 2000, idleIntervalMs: 300000 };
    expect(parsePollSettings({ history, config: null })).toEqual({ history, config: null });
    expect(parsePollSettings({ config: { intervalMs: null, idleIntervalMs: null } })).toEqual({
      config: { intervalMs: null, idleIntervalMs: null },
    });
    for (const value of [
      { history: { intervalMs: 1999, idleIntervalMs: 30000 } },
      { history: { intervalMs: null, idleIntervalMs: 30000 } },
      { config: { intervalMs: 5000.5, idleIntervalMs: null } },
      { config: { intervalMs: 5000 } },
      { config: undefined },
      { config: { intervalMs: 5000, idleIntervalMs: null, extra: 1 } },
      { unknown: null },
      [],
    ])
      expect(() => parsePollSettings(value)).toThrow();
    expect(parsePollVisibility({ visible: true, worktrees: false })).toEqual({
      visible: true,
      worktrees: false,
    });
    for (const value of [{ visible: true }, { visible: 1, worktrees: false }, null])
      expect(() => parsePollVisibility(value)).toThrow();
  });

  it("accepts only booleans for window appearance and hit testing", () => {
    expect(parseBoolean(true)).toBe(true);
    expect(parseBoolean(false)).toBe(false);
    for (const value of [undefined, null, 0, 1, "true", {}, { enabled: true }])
      expect(() => parseBoolean(value)).toThrow();
  });
  const settings = { agents: ["claude", "codex"], allow: ["execute"], allowAll: false };
  it("validates named settings and launch-backed saves without accepting prompts", () => {
    expect(parseSaveConfiguration({ name: " Team ", settings })).toEqual({
      name: "Team",
      settings,
    });
    expect(parseSaveConfiguration({ name: "Team", launchId: "run-1" })).toEqual({
      name: "Team",
      launchId: "run-1",
    });
    expect(parseStart({ ...settings, configurationId: "config-1" }).configurationId).toBe(
      "config-1",
    );
    for (const value of [
      { name: "", settings },
      { name: "a\nb", settings },
      { name: "a".repeat(129), settings },
      { name: "Team", settings, launchId: "run-1" },
      { name: "Team" },
      { name: "Team", settings: { ...settings, prompt: "secret" } },
      { name: "Team", launchId: "run-1", id: "config-1" },
      { name: "Team", settings, extra: true },
    ])
      expect(() => parseSaveConfiguration(value)).toThrow();
    for (const value of ["../config", "", "/file", null, "a".repeat(81)])
      expect(() => parseConfigurationId(value)).toThrow();
  });

  it("checks saved settings without launching agents", () => {
    expect(parseRunSettings({ ...settings, turnTimeout: "1h30m", parallel: "2" })).toMatchObject({
      parallel: "2",
    });
    for (const patch of [
      { agents: [] },
      { agents: [""] },
      { parallel: "0" },
      { parallel: "1.5" },
      { parallel: "9007199254740992" },
      { turnTimeout: "0m" },
      { turnTimeout: "forever" },
      { base: "\0" },
      { allow: ["unknown"] },
      { agents: ["claude"], parallel: "33" },
    ])
      expect(() => parseRunSettings({ ...settings, ...patch })).toThrow();
  });
  it("accepts only the structured run options", () => {
    expect(
      parseStart({
        agents: ["claude", "claude"],
        allow: ["execute"],
        allowAll: false,
        parallel: "2",
      }),
    ).toEqual({ agents: ["claude", "claude"], allow: ["execute"], allowAll: false, parallel: "2" });
  });

  it("keeps UTF-16 limits and never coerces boundary inputs", () => {
    expect(parseStart({ ...settings, prompt: "😀".repeat(500_000) }).prompt?.length).toBe(
      1_000_000,
    );
    expect(() => parseStart({ ...settings, prompt: "😀".repeat(500_001) })).toThrow(
      "Invalid prompt",
    );
    expect(() => parseStart({ ...settings, agents: ["😀".repeat(65)] })).toThrow("Invalid agents");
    expect(() => parseStart({ ...settings, parallel: 2 })).toThrow();
    expect(() => parseRunSettings({ ...settings, turnTimeout: "9007199254740992ms" })).toThrow(
      "Invalid turn timeout",
    );
    expect(() => parseRunSettings({ ...settings, turnTimeout: `${"9".repeat(200)}h` })).toThrow();
    expect(parseStart({ ...settings, prompt: undefined })).not.toHaveProperty("prompt");
    expect(parseRunSettings({ ...settings, parallel: undefined })).not.toHaveProperty("parallel");
  });

  it.each([
    null,
    [],
    { agents: "claude", allow: [], allowAll: false },
    { agents: [], allow: [], allowAll: "true" },
    { agents: [], allow: [], allowAll: false, cwd: "/etc" },
    { agents: Array(33).fill("claude"), allow: [], allowAll: false },
    { agents: [], allow: [], allowAll: false, prompt: "a".repeat(1_000_001) },
  ])("rejects malformed or excessive run requests", (value) => {
    expect(() => parseStart(value)).toThrow();
  });

  it("accepts scoped actions and once-only permission decisions", () => {
    expect(parseAction({ type: "reply", id: "run-1", text: "continue" })).toEqual({
      type: "reply",
      id: "run-1",
      text: "continue",
    });
    expect(parseAction({ type: "permission", id: "run-1#2", answer: "deny" })).toEqual({
      type: "permission",
      id: "run-1#2",
      answer: "deny",
    });
    expect(parseAction({ type: "continue", id: "run-1", text: "keep going" })).toEqual({
      type: "continue",
      id: "run-1",
      text: "keep going",
    });
  });

  it.each([
    { type: "diff", id: "../../etc" },
    { type: "execute", id: "r1" },
    { type: "permission", id: "r1#1", answer: "allow_always" },
    { type: "reply", id: "r1", text: 1 },
    { type: "stop", id: "r1", command: "anything" },
    { type: "resume", id: "r1" },
    { type: "handoff", id: "r1" },
    { type: "continue", id: "r1" },
    { type: "continue", id: "../outside", text: "hi" },
    { type: "continue", id: "r1", text: "hi", prompt: "extra" },
  ])("rejects unknown actions, paths, extra fields, and invalid decisions", (value) => {
    expect(() => parseAction(value)).toThrow();
  });

  it("accepts only known database modes and absolute project paths", () => {
    expect(parseDatabaseMode("open")).toBe("open");
    expect(parseDatabaseMode("create")).toBe("create");
    expect(parseProjectPath("/Users/me/repo")).toBe("/Users/me/repo");
    for (const value of ["delete", "", 1, { mode: "open" }])
      expect(() => parseDatabaseMode(value)).toThrow();
    for (const value of ["repo", "", "/a\0b", `/${"a".repeat(4096)}`, ["/repo"], null])
      expect(() => parseProjectPath(value)).toThrow();
  });
});

describe("harness mode IPC", () => {
  it("accepts only scoped bounded mode selections", () => {
    const value = {
      type: "set-mode",
      id: "run-1",
      change: { source: "config", configId: "permissions", value: "ask" },
    };
    for (const parse of [parseAction, parseOrchestrationChatAction]) {
      expect(parse(value)).toEqual(value);
      for (const invalid of [
        { ...value, id: "../outside" },
        { ...value, command: "shell" },
        { ...value, change: { ...value.change, source: "unknown" } },
        { ...value, change: { ...value.change, value: true } },
        { ...value, change: { ...value.change, value: "x".repeat(257) } },
        { ...value, change: { ...value.change, allowAll: true } },
      ])
        expect(() => parse(invalid)).toThrow();
    }
  });
});
