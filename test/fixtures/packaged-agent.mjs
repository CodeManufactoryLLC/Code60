// A real ACP fixture that exercises the MCP command supplied by the installed app.
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { Readable, Writable } from "node:stream";
import { ndJsonStream } from "@agentclientprotocol/sdk";
import { createFakeAgent } from "./fake-agent-app.mjs";

createFakeAgent({
  async onSessionNew(params) {
    const server = params.mcpServers.find((server) => server.name === "code60");
    if (!server) return; // Ordinary workers do not receive the orchestration gateway.
    const env = {
      ...process.env,
      ...Object.fromEntries(server.env.map(({ name, value }) => [name, value])),
    };
    const child = spawn(server.command, server.args, { env, stdio: ["pipe", "pipe", "pipe"] });
    const lines = createInterface({ input: child.stdout });
    let errors = "";
    child.stderr.on("data", (chunk) => {
      errors += chunk.toString();
    });
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Packaged MCP helper timed out: ${errors}`)),
          15_000,
        );
        const fail = (error) => {
          clearTimeout(timer);
          reject(error);
        };
        child.once("error", fail);
        child.once("exit", (code) =>
          fail(new Error(`Packaged MCP helper exited (${code}): ${errors}`)),
        );
        lines.on("line", (line) => {
          try {
            const result = JSON.parse(line);
            if (result.error || result.result?.isError) throw new Error("MCP request failed");
            if (result.id === 1) {
              child.stdin.write(
                `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "code60_get_context", arguments: {} } })}\n`,
              );
            } else if (result.id === 2) {
              clearTimeout(timer);
              resolve();
            }
          } catch (error) {
            fail(error);
          }
        });
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "installer-test", version: "1" } } })}\n`,
        );
      });
      await writeFile(process.argv[2], "ok\n");
    } finally {
      lines.close();
      child.kill("SIGKILL");
    }
  },
}).connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
