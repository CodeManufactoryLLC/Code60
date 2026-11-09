import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CoreDeps,
  type Orchestrator,
  parseConfig,
  prepareOrchestrationChat,
  prepareRecovery,
  prepareRuns,
} from "../src/core/index.js";
import { FakeAgents, FakeClock, FakeGit, FakeProcesses, flush } from "./fakes.js";

const mcpServers = {
  local: {
    type: "stdio",
    command: "node",
    args: ["/private/server.js"],
    env: { TOKEN: "private-token" },
  },
  remote: {
    type: "http",
    url: "https://example.com/mcp",
    headers: { Authorization: "private-header" },
  },
  legacy: { type: "sse", url: "http://localhost/sse" },
};
const expected = [
  {
    name: "local",
    type: "stdio",
    command: "node",
    args: ["/private/server.js"],
    env: [{ name: "TOKEN", value: "private-token" }],
  },
  {
    name: "remote",
    type: "http",
    url: "https://example.com/mcp",
    headers: [{ name: "Authorization", value: "private-header" }],
  },
  { name: "legacy", type: "sse", url: "http://localhost/sse", headers: [] },
];

describe("MCP session preparation", () => {
  let directory: string;
  let deps: CoreDeps;
  let agents: FakeAgents;
  let env: Record<string, string>;
  const orchestrators: Orchestrator[] = [];
  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), "code60-mcp-"));
    agents = new FakeAgents();
    const git = new FakeGit();
    git.repoInfo = async () => {
      throw new Error("not a repository");
    };
    deps = {
      agents,
      git,
      fs: fs as unknown as CoreDeps["fs"],
      clock: new FakeClock(),
      processes: new FakeProcesses(),
      ownerPid: 500,
    };
    env = { XDG_CONFIG_HOME: join(directory, "config"), XDG_STATE_HOME: join(directory, "state") };
    await fs.mkdir(join(env.XDG_CONFIG_HOME as string, "code60"), { recursive: true });
    await fs.writeFile(
      join(env.XDG_CONFIG_HOME as string, "code60", "config.json"),
      JSON.stringify({ mcpServers }),
    );
  });
  afterEach(async () => {
    await Promise.all(orchestrators.splice(0).map((orchestrator) => orchestrator.shutdown(true)));
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("passes the starter servers only after explicitly adding them to user config", async () => {
    const starter = JSON.parse(
      await fs.readFile(new URL("../mcp.default.json", import.meta.url), "utf8"),
    );
    await fs.writeFile(
      join(env.XDG_CONFIG_HOME as string, "code60", "config.json"),
      JSON.stringify(starter),
    );
    const { orchestrator } = await prepareRuns(deps, {
      cwd: directory,
      env,
      mode: "headless",
      agents: [],
      prompt: "hello",
    });
    orchestrators.push(orchestrator);
    orchestrator.start();
    await orchestrator.done;
    expect(agents.specs[0]?.mcpServers).toEqual([
      { name: "playwright", ...starter.mcpServers.playwright, env: [] },
      { name: "context7", ...starter.mcpServers.context7, env: [] },
    ]);
  });

  it.each(["headless", "interactive"] as const)(
    "passes configured servers to %s runs without exposing definitions",
    async (mode) => {
      const { orchestrator, workspace } = await prepareRuns(deps, {
        cwd: directory,
        env,
        mode,
        agents: [],
        prompt: "hello",
      });
      orchestrators.push(orchestrator);
      orchestrator.start();
      if (mode === "headless") await orchestrator.done;
      else await expect.poll(() => agents.specs.length).toBe(1);
      expect(agents.specs[0]?.mcpServers).toEqual(expected);
      if (mode === "interactive") await orchestrator.shutdown(true);
      const record = (await workspace.store.list())[0];
      expect(record).toBeDefined();
      const publicData = JSON.stringify([
        record,
        await workspace.store.readEvents(record?.id ?? ""),
        orchestrator.runs(),
        await orchestrator.results(),
      ]);
      for (const value of [
        "mcpServers",
        "/private/server.js",
        "private-token",
        "private-header",
        "https://example.com/mcp",
      ])
        expect(publicData).not.toContain(value);
    },
  );

  it("combines configured servers with only the chat's built-in stdio server", async () => {
    const builtin = { name: "code60", command: "/node", args: ["/code60/mcp-server.js"], env: [] };
    const orchestrator = await prepareOrchestrationChat(
      deps,
      join(directory, "chat"),
      "claude",
      parseConfig({ mcpServers }),
      { mcpServers: [builtin] },
    );
    orchestrators.push(orchestrator);
    orchestrator.start();
    await expect.poll(() => agents.specs.length).toBe(1);
    expect(agents.specs[0]?.mcpServers).toEqual([...expected, builtin]);
  });

  it.each(["restoration", "fresh handoff"] as const)(
    "resolves current config on explicit %s, not from the run record",
    async (method) => {
      const initial = await prepareRuns(
        deps,
        { cwd: directory, env, mode: "headless", agents: [], prompt: "hello" },
        parseConfig({}),
      );
      orchestrators.push(initial.orchestrator);
      initial.orchestrator.start();
      await initial.orchestrator.done;
      const record = (await initial.workspace.store.list())[0];
      if (!record) throw new Error("missing record");
      const { orchestrator } = await prepareRecovery(deps, initial.workspace, record, env);
      orchestrators.push(orchestrator);
      if (method === "restoration") {
        expect(await orchestrator.restore(record.id)).toEqual({ type: "restored" });
        expect(agents.restores[0]?.spec.mcpServers).toEqual(expected);
        expect(agents.sessions.at(-1)?.prompts).toEqual([]);
      } else {
        agents.restoreUnavailable = true;
        expect((await orchestrator.restore(record.id)).type).toBe("handoff-required");
        await orchestrator.handoff(
          record.id,
          "Check existing work.",
          "continue",
          "restore unavailable",
        );
        expect(agents.specs.at(-1)?.mcpServers).toEqual(expected);
      }
      await flush();
      expect(JSON.stringify(orchestrator.runs())).not.toContain("mcpServers");
    },
  );
});
