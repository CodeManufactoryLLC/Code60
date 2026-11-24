import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentSession, type AgentSpec, createAgents } from "../src/agents/index.js";

// Supporting integration: real ACP + stdio subprocesses, synthetic private broker/upstream.
const provider = fileURLToPath(new URL("./fixtures/mcp-connector-provider.mjs", import.meta.url));
const adapter = fileURLToPath(new URL("./fixtures/mcp-connector-adapter.mjs", import.meta.url));
const listen = async (server: Server) => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture address");
  return `http://127.0.0.1:${address.port}`;
};
const close = async (server: Server) => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
};
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("managed connector ACP feasibility (not the production runtime)", () => {
  let directory: string;
  let endpoint: string;
  let upstream: Server;
  let broker: Server;
  let calls: string[];
  let cancelled: boolean;
  let secret: string;
  const sessions: AgentSession[] = [];
  const adapterPids: number[] = [];
  const capabilities = new Map<string, { owner: string; active: boolean; revoked: boolean }>();

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "code60-connector-proof-"));
    calls = [];
    cancelled = false;
    secret = `synthetic-upstream-${randomUUID()}`;
    upstream = createServer((req, res) => {
      void (async () => {
        expect(req.headers.authorization).toBe(`Bearer ${secret}`);
        let data = "";
        for await (const chunk of req) data += chunk;
        const body = JSON.parse(data);
        calls.push(body.method);
        res.setHeader("content-type", "application/json");
        if (body.method === "initialize")
          res.end(
            JSON.stringify({
              protocolVersion: "2025-03-26",
              capabilities: { tools: {} },
              serverInfo: { name: "synthetic-upstream", version: "1" },
            }),
          );
        else if (body.method === "tools/list")
          res.end(
            JSON.stringify({
              tools: [
                {
                  name: "fixture_tool",
                  inputSchema: { type: "object" },
                  annotations: { readOnlyHint: true },
                },
              ],
            }),
          );
        else if (body.params.arguments.slow)
          res.once("close", () => {
            cancelled = true;
          });
        else
          res.end(
            JSON.stringify({
              content: [{ type: "text", text: "upstream result" }],
              isError: false,
            }),
          );
      })().catch(() => {
        res.writeHead(500);
        res.end();
      });
    });
    const upstreamUrl = await listen(upstream);
    broker = createServer((req, res) => {
      const capability = capabilities.get(
        String(req.headers.authorization).replace(/^Bearer /, ""),
      );
      if (
        !capability ||
        capability.revoked ||
        req.headers["x-connector-owner"] !== capability.owner
      ) {
        res.writeHead(403);
        res.end();
        return;
      }
      const controller = new AbortController();
      res.once("close", () => {
        if (!res.writableEnded) controller.abort();
      });
      void (async () => {
        let data = "";
        for await (const chunk of req) data += chunk;
        const body = JSON.parse(data);
        if (body.method === "tools/call" && !capability.active) {
          res.writeHead(403);
          res.end();
          return;
        }
        const response = await fetch(upstreamUrl, {
          method: "POST",
          headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
          body: data,
          signal: controller.signal,
        });
        res.setHeader("content-type", "application/json");
        res.end(await response.text());
      })().catch(() => {
        if (!res.destroyed) {
          res.writeHead(502);
          res.end();
        }
      });
    });
    endpoint = `${await listen(broker)}/connector`;
  });

  afterEach(async () => {
    for (const session of sessions.splice(0)) {
      await session.stop();
      await session.exited;
      expect(alive(session.pid)).toBe(false);
    }
    await vi.waitFor(() => {
      for (const pid of adapterPids) expect(alive(pid)).toBe(false);
    });
    adapterPids.length = 0;
    capabilities.clear();
    await close(broker);
    await close(upstream);
    await rm(directory, { recursive: true, force: true });
  });

  const prepare = async (
    method: "new" | "load" | "resume",
    owner = randomUUID(),
    token = randomUUID(),
  ) => {
    capabilities.set(token, { owner, active: false, revoked: false });
    const evidence = join(directory, `${owner}-${randomUUID()}.json`);
    const spec: AgentSpec = {
      name: "fake",
      command: [process.execPath, provider],
      cwd: directory,
      env: { CONNECTOR_RESTORE: method, CONNECTOR_SESSION: owner, CONNECTOR_EVIDENCE: evidence },
      mcpServers: [
        {
          name: "docs",
          type: "stdio",
          command: process.execPath,
          args: [adapter],
          env: [
            { name: "CONNECTOR_ENDPOINT", value: endpoint },
            { name: "CONNECTOR_CAPABILITY", value: token },
            { name: "CONNECTOR_OWNER", value: owner },
          ],
        },
      ],
    };
    const agents = createAgents({ clientVersion: "phase-1-fixture" });
    const session =
      method === "new" ? await agents.start(spec) : await agents.restore?.(spec, owner);
    if (!session) throw new Error("Missing restore adapter");
    sessions.push(session);
    const setup = JSON.parse(await readFile(evidence, "utf8"));
    adapterPids.push(setup.adapterPid);
    expect(setup.method).toBe(method);
    expect(setup.params.mcpServers).toEqual([
      {
        name: "docs",
        command: process.execPath,
        args: [adapter],
        env: spec.mcpServers?.[0] && "env" in spec.mcpServers[0] ? spec.mcpServers[0].env : [],
      },
    ]);
    expect(JSON.stringify(setup)).not.toContain(secret);
    expect(setup.initialized.capabilities).toEqual({ tools: {} });
    return { session, spec, token, owner, setup };
  };

  it.each(["new", "load", "resume"] as const)(
    "discovers and forwards tools with fresh session/%s capabilities and no upstream credentials",
    async (method) => {
      const first = await prepare(method);
      expect(calls).toEqual(["initialize", "tools/list"]);
      const updates: string[] = [];
      first.session.onUpdate((update) => {
        if (update.type === "message") updates.push(update.text);
      });
      first.session.onPermission(async () => "deny");
      expect(await first.session.prompt("{}")).toBe("end_turn");
      expect(updates).toContain("denied");
      expect(calls).not.toContain("tools/call");
      first.session.onPermission(async () => "allow");
      // A provider's permission answer alone cannot grant backend execution authority.
      await first.session.prompt("{}");
      expect(updates).toContain("rejected");
      expect(calls).not.toContain("tools/call");
      const capability = capabilities.get(first.token);
      if (!capability) throw new Error("Missing fixture capability");
      capability.active = true;
      await first.session.prompt("{}");
      expect(calls.filter((method) => method === "tools/call")).toHaveLength(1);
      expect(updates).toContain(
        JSON.stringify({ content: [{ type: "text", text: "upstream result" }], isError: false }),
      );
      const callsBeforeUnsupported = calls.length;
      for (const method of [
        "resources/list",
        "prompts/list",
        "sampling/createMessage",
        "elicitation/create",
      ])
        await first.session.prompt(JSON.stringify({ method }));
      expect(calls).toHaveLength(callsBeforeUnsupported);
      expect(calls.filter((method) => method === "tools/call")).toHaveLength(1);
      capability.revoked = true;
      await first.session.prompt("{}");
      expect(calls.filter((method) => method === "tools/call")).toHaveLength(1);
      const replacement = await prepare(method, first.owner);
      expect(replacement.token).not.toBe(first.token);
      expect(capabilities.get(replacement.token)?.active).toBe(false);
      const stolen = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${replacement.token}`,
          "x-connector-owner": "different-session",
        },
        body: JSON.stringify({ method: "tools/list" }),
      });
      expect(stolen.status).toBe(403);
      expect(calls.filter((method) => method === "tools/call")).toHaveLength(1);
    },
    20000,
  );

  it("propagates session cancellation to the adapter and upstream without replay", async () => {
    const { session, token } = await prepare("new");
    const capability = capabilities.get(token);
    if (!capability) throw new Error("Missing fixture capability");
    capability.active = true;
    session.onPermission(async () => "allow");
    const prompt = session.prompt(JSON.stringify({ slow: true }));
    await vi.waitFor(() => expect(calls).toContain("tools/call"));
    await session.cancel();
    expect(await prompt).toBe("cancelled");
    await vi.waitFor(() => expect(cancelled).toBe(true));
    capability.revoked = true;
    expect(calls.filter((method) => method === "tools/call")).toHaveLength(1);
  }, 20000);
});
