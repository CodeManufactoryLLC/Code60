import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { expect, it } from "vitest";
import { guardOptionalOutput } from "./optional-output.js";

it("handles only EPIPE and releases exactly its own error listener", () => {
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  const dispose = guardOptionalOutput(stream);
  const broken = Object.assign(new Error("synthetic closed reader"), { code: "EPIPE" });
  expect(() => stream.emit("error", broken)).not.toThrow();
  const other = Object.assign(new Error("synthetic other failure"), { code: "EIO" });
  expect(() => stream.emit("error", other)).toThrow(other);
  let handled: Error | undefined;
  stream.once("error", (error) => {
    handled = error;
  });
  expect(() => stream.emit("error", other)).not.toThrow();
  expect(handled).toBe(other);
  dispose();
  dispose();
  expect(stream.listenerCount("error")).toBe(0);
  expect(() => stream.emit("error", broken)).toThrow(broken);
  stream.destroy();
});

it("preserves normal writes and stream completion", async () => {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  const dispose = guardOptionalOutput(stream);
  stream.end("normal output\n");
  await once(stream, "finish");
  expect(chunks).toEqual(["normal output\n"]);
  dispose();
});

it.each([false, true])(
  "reproduces a real console broken pipe and protects it only when guarded=%s",
  async (guarded) => {
    const directory = await mkdtemp(join(tmpdir(), "code60-output-pipe-"));
    const evidence = join(directory, "failure.json");
    const child = spawn(
      process.execPath,
      [
        "-e",
        `
    const {Console} = require('node:console');
    const {writeFileSync} = require('node:fs');
    const guard = (${guardOptionalOutput.toString()});
    if (process.argv[1] === 'guarded') guard(process.stderr);
    process.on('uncaughtExceptionMonitor', error => writeFileSync(process.argv[2], JSON.stringify({code:error.code})));
    const output = new Console({stdout:process.stdout, stderr:process.stderr, ignoreErrors:false});
    process.once('message', () => {
      output.error('Synthetic diagnostic through a closed terminal pipe');
      setImmediate(() => {
        output.error('Repeated diagnostic after the pipe closed');
        output.log('healthy output survives');
        process.disconnect();
      });
    });
    process.send('ready');
  `,
        guarded ? "guarded" : "unguarded",
        evidence,
      ],
      { stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    const exited = once(child, "close");
    try {
      await once(child, "message");
      if (!child.stderr) throw new Error("Missing owned diagnostic pipe");
      const closed = once(child.stderr, "close");
      child.stderr.destroy();
      await closed;
      child.send("write");
      const [code] = await exited;
      expect(code).toBe(guarded ? 0 : 1);
      if (guarded) {
        expect(stdout).toBe("healthy output survives\n");
        await expect(readFile(evidence)).rejects.toMatchObject({ code: "ENOENT" });
      } else expect(JSON.parse(await readFile(evidence, "utf8"))).toEqual({ code: "EPIPE" });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
      await rm(directory, { recursive: true, force: true });
    }
  },
);
