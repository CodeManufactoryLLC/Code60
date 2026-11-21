import { execFileSync, spawn } from "node:child_process";
import { copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, expect, it } from "vitest";
import { createMcpGateway } from "../src/desktop/mcp-gateway.js";
import { readMcpTool } from "../src/desktop/mcp-tables.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Inside node_modules so the compiled sidecar resolves the project's dependencies.
const OUT = join(ROOT, "node_modules", ".cache", "code60-e2e", "dist");

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

beforeAll(async () => {
  execFileSync(process.execPath, [
    join(ROOT, "node_modules", "typescript", "bin", "tsc"),
    "-p",
    join(ROOT, "tsconfig.build.json"),
    "--outDir",
    OUT,
    "--sourceMap",
    "false",
  ]);
  // Mirror the installed layout, including the single source of the product version.
  await copyFile(join(ROOT, "package.json"), join(OUT, "..", "package.json"));
}, 60_000);

it("serves the Code60 MCP stdio protocol from a separate process", async () => {
  const gateway = await createMcpGateway((name, args) =>
    readMcpTool(name, args, async () => [{ id: "one", text: "Hello Code60" }]),
  );
  const child = spawn(process.execPath, [join(OUT, "desktop", "mcp-server.js")], {
    env: {
      ...process.env,
      CODE60_MCP_GATEWAY_URL: gateway.url,
      CODE60_MCP_GATEWAY_TOKEN: gateway.token,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  try {
    const result = await new Promise<Result>((resolveResult, reject) => {
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.on("error", reject);
      child.on("close", (code) => resolveResult({ code, stdout, stderr }));
      const requests = [
        { id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
        { method: "notifications/initialized" },
        { id: 2, method: "tools/list" },
        {
          id: 3,
          method: "tools/call",
          params: {
            name: "code60_search_messages",
            arguments: { query: "hello" },
          },
        },
        { id: 4, method: "tools/call", params: { name: "code60_write_messages", arguments: {} } },
      ];
      child.stdin.end(
        `${requests.map((request) => JSON.stringify({ jsonrpc: "2.0", ...request })).join("\n")}\n`,
      );
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const responses = new Map(
      result.stdout
        .trim()
        .split("\n")
        .map((line) => {
          const response = JSON.parse(line);
          return [response.id, response.result] as const;
        }),
    );
    expect(responses.get(1)).toMatchObject({
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
    });
    type Listed = {
      name: string;
      annotations: { readOnlyHint: boolean; destructiveHint: boolean };
    };
    const listed: Listed[] = responses.get(2).tools;
    expect(listed).toHaveLength(38);
    expect(listed.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        "code60_get_capabilities",
        "code60_get_app_state",
        "code60_list_customizations",
        "code60_read_customization",
        "code60_read_view",
        "code60_browser",
        "code60_create_command",
        "code60_create_memory",
        "code60_modify_memory",
        "code60_retrieve_memories",
        "code60_create_plan",
        "code60_read_plan",
        "code60_update_plan",
      ]),
    );
    const hint = (name: string) => listed.find((tool) => tool.name === name)?.annotations;
    expect(hint("code60_create_memory")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(hint("code60_modify_memory")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(hint("code60_retrieve_memories")).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(hint("code60_search_messages")).toMatchObject({ readOnlyHint: true });
    expect(hint("code60_read_events")).toMatchObject({ readOnlyHint: true });
    expect(hint("code60_search_events")).toMatchObject({ readOnlyHint: true });
    expect(hint("code60_list_agents")).toMatchObject({ readOnlyHint: true });
    expect(hint("code60_get_activity_context")).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(hint("code60_report_activity")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(hint("code60_read_review")).toMatchObject({ readOnlyHint: true });
    expect(hint("code60_address_feedback")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(hint("code60_create_command")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(hint("code60_dispatch_agent")).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(hint("code60_stop_agent")).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(JSON.parse(responses.get(3).content[0].text)).toMatchObject({
      table: "messages",
      total: 1,
      rows: [{ id: "one", text: "Hello Code60" }],
    });
    expect(responses.get(4).isError).toBe(true);
  } finally {
    child.kill();
    await gateway.close();
  }
}, 20_000);
