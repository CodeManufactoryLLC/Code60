import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
const mode = request.account[0];
let child;
if (mode === "b")
  child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
await writeFile(
  join(process.env.HOME, "observed.json"),
  JSON.stringify({
    pid: process.pid,
    child: child?.pid,
    argumentsSafe: process.argv.length === 2,
    environmentSafe:
      !Object.hasOwn(process.env, "CODE60_PRIVATE_SENTINEL") &&
      !Object.values(process.env).includes(request.secret),
    receivedStdin: true,
  }),
);
if (mode === "b") setInterval(() => {}, 1000);
else if (mode === "c") process.stdout.write("x".repeat(300000));
else if (mode === "d") process.stdout.write(Buffer.from([255]));
else if (mode === "e") process.stdout.write('{"status":"locked"}');
else
  process.stdout.write(
    JSON.stringify({
      status: "available",
      ...(request.action === "get" ? { secret: "synthetic-private-response" } : {}),
    }),
  );
