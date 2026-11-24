#!/usr/bin/env node
import { request } from "node:http";
import { basename } from "node:path";

const socket = process.env.CODE60_TEST_GATEWAY_SOCKET;
if (!socket) throw Error("Acceptance refuses native supervisor/opener mutations");
const result = await new Promise((resolve, reject) => {
  const req = request({ socketPath: socket, path: "/", method: "POST" }, (res) => {
    let text = "";
    res.on("data", (part) => {
      text += part;
    });
    res.on("end", () => {
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
  });
  req.on("error", reject);
  req.setTimeout(30000, () => req.destroy(Error("Fixture supervisor deadline")));
  req.end(JSON.stringify({ name: basename(process.argv[1]), args: process.argv.slice(2) }));
});
if (result.error) process.stderr.write(`${result.error}\n`);
process.stdout.write(result.stdout);
process.exitCode = result.ok ? 0 : 2;
