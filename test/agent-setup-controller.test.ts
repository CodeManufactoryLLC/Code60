import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { CoreDeps } from "../src/core/index.js";
import { DesktopController } from "../src/desktop/controller.js";
import { filePreferences } from "../src/desktop/preferences.js";
import { openProjectDatabase } from "../src/desktop/projects.js";
import { FakeAgents, FakeClock, FakeGit, FakeProcesses } from "./fakes.js";

const directories: string[] = [];
const controllers: DesktopController[] = [];
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.shutdown(true)));
  await Promise.all(
    directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});
async function fixture() {
  const dir = await fs.mkdtemp(join(tmpdir(), "code60-setup-controller-"));
  directories.push(dir);
  const agents = new FakeAgents();
  const preferences = filePreferences(join(dir, "state", "desktop.json"));
  const detect = vi.fn(async () => {});
  const openDatabase = vi.fn(openProjectDatabase);
  const env = { XDG_CONFIG_HOME: join(dir, "config"), XDG_STATE_HOME: join(dir, "state") };
  const create = () => {
    const controller = new DesktopController(
      {
        agents,
        fs: fs as unknown as CoreDeps["fs"],
        git: new FakeGit(),
        clock: new FakeClock(),
        processes: new FakeProcesses(),
        ownerPid: process.pid,
      },
      env,
      { confirm: async () => true },
      { preferences, openDatabase, detectAgent: detect },
    );
    controllers.push(controller);
    return controller;
  };
  const controller = create();
  await controller.restore();
  const identity = () => ({ sessionId: controller.snapshot().agentSetup?.session?.id ?? "" });
  const attempt = (provider: string) => controller.attemptAgentSetup({ ...identity(), provider });
  return { dir, controller, agents, preferences, detect, openDatabase, create, identity, attempt };
}
it("requires setup for legacy installations and cannot bypass the gate through old IPC", async () => {
  const { controller, preferences, openDatabase, agents } = await fixture();
  await preferences.setOrchestrationProvider("claude");
  await controller.restore();
  expect(controller.snapshot().agentSetup?.complete).toBe(false);
  expect(controller.snapshot().agents).toEqual([]);
  await expect(controller.setOrchestrationProvider("claude")).rejects.toThrow("Use agent setup");
  await expect(controller.orchestrationChatAction({ type: "new" })).rejects.toThrow();
  expect(agents.specs).toEqual([]);
  expect(openDatabase).not.toHaveBeenCalled();
});
it("sets up primary and two additions before a database, persists identities and restores transient connection state", async () => {
  const { controller, agents, preferences, create, identity, attempt, openDatabase } =
    await fixture();
  await controller.beginAgentSetup({ mode: "primary" });
  await attempt("claude");
  await attempt("codex");
  await attempt("droid");
  expect(controller.snapshot().agents).toEqual([]);
  expect(await preferences.agentSetup?.()).toBeNull();
  const snapshot = controller.snapshot();
  expect(snapshot.agentSetup?.session?.primary).toBe("claude");
  // Snapshots are detached; a renderer cannot mutate main's verified membership.
  snapshot.agentSetup?.session?.verified.push("kiro");
  await controller.finishAgentSetup(identity());
  expect(controller.snapshot().agents).toEqual(["claude", "codex", "droid"]);
  expect(agents.specs).toHaveLength(3);
  expect(agents.sessions.every((s) => s.prompts.length === 0 && s.stops.length === 1)).toBe(true);
  const restarted = create();
  await restarted.restore();
  expect(restarted.snapshot().agentSetup).toMatchObject({
    complete: true,
    primary: "claude",
    enabled: ["claude", "codex", "droid"],
    session: null,
  });
  expect(restarted.snapshot().orchestration.connection).toBe("idle");
  expect(openDatabase).not.toHaveBeenCalled();
});
it("keeps reload state and cancellation cannot persist a late successful candidate", async () => {
  const { controller, agents, identity, attempt } = await fixture();
  await controller.beginAgentSetup({ mode: "primary" });
  agents.startGate = new Promise(() => {});
  const pending = attempt("claude");
  await vi.waitFor(() =>
    expect(controller.snapshot().agentSetup?.session?.phase).toBe("connecting"),
  );
  const sessionId = identity().sessionId;
  await controller.cancelAgentSetup();
  await pending;
  expect(identity().sessionId).toBe(sessionId);
  expect(controller.snapshot().agentSetup?.session).toMatchObject({
    phase: "select",
    verified: [],
  });
  await expect(controller.finishAgentSetup(identity())).rejects.toThrow();
});
it("rechecks config before committing or dispatching and retains preferences on failure", async () => {
  const { dir, controller, preferences, identity, attempt } = await fixture();
  await controller.beginAgentSetup({ mode: "primary" });
  await attempt("claude");
  await fs.mkdir(join(dir, "config/code60"), { recursive: true });
  await fs.writeFile(
    join(dir, "config/code60/config.json"),
    JSON.stringify({ agents: { claude: { command: ["different"] } } }),
  );
  await expect(controller.finishAgentSetup(identity())).rejects.toThrow("commands changed");
  expect(await preferences.agentSetup?.()).toBeNull();
  expect(controller.snapshot().agents).toEqual([]);
});
it("a failed addition remains disabled after abandonment", async () => {
  const { controller, agents, identity, attempt } = await fixture();
  await controller.beginAgentSetup({ mode: "primary" });
  await attempt("claude");
  await controller.finishAgentSetup(identity());
  await controller.beginAgentSetup({ mode: "add" });
  agents.startError = new Error("Please log in");
  await attempt("codex");
  await expect(controller.finishAgentSetup(identity())).rejects.toThrow();
  await controller.abandonAgentSetup(identity());
  expect(controller.snapshot().agents).toEqual(["claude"]);
  expect(controller.snapshot().orchestration.provider).toBe("claude");
});

it("enforces enabled membership in manual dispatch, saved configurations and authenticated worker tools", async () => {
  const { dir, controller, agents, identity, attempt } = await fixture();
  await controller.beginAgentSetup({ mode: "primary" });
  await attempt("claude");
  await controller.finishAgentSetup(identity());
  await controller.connect(join(dir, "projects.sqlite"), true);
  await vi.waitFor(() => expect(controller.snapshot().chat.run?.status).toBe("idle"));
  await controller.open(dir);
  const request = { agents: ["codex"], allow: [], allowAll: false };
  await expect(controller.start(request)).rejects.toThrow("unknown agent");
  await expect(
    controller.saveConfiguration({ name: "Unverified", settings: request }),
  ).rejects.toThrow("not enabled");
  expect(controller.snapshot().runs).toEqual([]);
  const server = agents.specs.find((spec) => spec.mcpServers)?.mcpServers?.[0];
  if (!server) throw new Error("Missing chat gateway");
  const env = Object.fromEntries(server.env.map((item) => [item.name, item.value]));
  const call = async (name: string, args = {}) => {
    const response = await fetch(env.CODE60_MCP_GATEWAY_URL as string, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.CODE60_MCP_GATEWAY_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name, arguments: args }),
    });
    return { status: response.status, body: await response.json() };
  };
  const context = await call("code60_get_context");
  expect(context.body.result.providers).toEqual(["claude"]);
  const denied = await call("code60_dispatch_agent", {
    scope: context.body.result.scope,
    requestId: "disabled",
    provider: "codex",
    prompt: "No dispatch",
  });
  expect(denied.status).toBe(400);
  expect(denied.body.error).toContain("not enabled");
  expect(controller.snapshot().runs).toEqual([]);
  const chatId = controller.snapshot().chat.run?.id;
  await controller.beginAgentSetup({ mode: "add" });
  await attempt("codex");
  await controller.finishAgentSetup(identity());
  expect(controller.snapshot().chat.run?.id).toBe(chatId);
  expect((await call("code60_get_context")).body.result.providers).toEqual(["claude", "codex"]);
  agents.script = () => "hang";
  await controller.orchestrationChatAction({ type: "send", id: chatId as string, text: "work" });
  await expect(controller.beginAgentSetup({ mode: "primary" })).rejects.toThrow(
    "active orchestration work",
  );
});
