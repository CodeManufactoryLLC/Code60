import { link, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { batchCommand, resolveCommand, spawnOwnedProcess } from "./index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("command resolution", () => {
  it.runIf(process.platform === "win32")(
    "round trips representable batch arguments and rejects injection before launch",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "code60 batch 雪 "));
      directories.push(directory);
      const file = join(directory, "launcher.cmd");
      const script = join(directory, "argv.cjs");
      const output = join(directory, "argv.json");
      await writeFile(
        script,
        `require('node:fs').writeFileSync(${JSON.stringify(output)},JSON.stringify(process.argv.slice(2)))`,
      );
      await link(process.execPath, join(directory, "node.exe"));
      await writeFile(file, '@echo off\r\n"%~dp0node.exe" "%~dp0argv.cjs" %*\r\n');
      const args = ["", "space here", "雪", "middle\\slash"];
      const child = await spawnOwnedProcess([file, ...args], directory);
      let stderr = "";
      child.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      try {
        expect((await child.exited).code, stderr).toBe(0);
      } finally {
        await child.stop(0);
      }
      expect(JSON.parse(await readFile(output, "utf8"))).toEqual(args);
      for (const arg of ["a&echo marker", "%PATH%", "!", '"', "end\\"])
        await expect(spawnOwnedProcess([file, arg], directory)).rejects.toThrow(/safely/);
      expect(JSON.parse(await readFile(output, "utf8"))).toEqual(args);
    },
  );

  it("keeps POSIX argv and the caller environment unchanged", async () => {
    const command = ["npm", "", "%", "!", "a b", '"', "雪"] as const;
    expect(await resolveCommand(command, {}, "linux")).toEqual({
      file: "npm",
      args: [...command.slice(1)],
    });
  });
  it.each([
    '"',
    "%PATH%",
    "!",
    "a&echo marker",
    "|",
    "^",
    "(echo marker)",
    "<",
    ">",
    "\r",
    "\n",
    "\0",
    "end\\",
  ])("rejects batch syntax rather than invoking it: %j", (arg) => {
    expect(() =>
      batchCommand("C:\\Tools\\launcher.cmd", [arg], { SystemRoot: "C:\\Windows" }),
    ).toThrow(/safely/);
  });
  it("uses one fixed cmd adapter with delayed expansion and profiles disabled", () => {
    const command = batchCommand("C:\\Tools\\launcher.cmd", ["", "space here", "雪"], {
      SystemRoot: "C:\\Windows",
    });
    expect(command.file).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(command.args.slice(0, 4)).toEqual(["/d", "/s", "/v:off", "/c"]);
  });
  it.runIf(process.platform === "win32")(
    "launches standard npm/npx entrypoints without cmd.exe and preserves hostile argv",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "code60 npm 雪 "));
      directories.push(directory);
      const bin = join(directory, "node_modules", "npm", "bin");
      await mkdir(bin, { recursive: true });
      await link(process.execPath, join(directory, "node.exe"));
      const args = ["", "a b", "雪", '"', "end\\", "%", "!", "&", "|", "^", "()", "<", ">"];
      for (const name of ["npm", "npx"]) {
        const entry = join(bin, `${name}-cli.js`);
        const output = join(directory, `${name}.json`);
        await writeFile(
          entry,
          `require('node:fs').writeFileSync(${JSON.stringify(output)},JSON.stringify(process.argv.slice(2)))`,
        );
        await writeFile(
          join(directory, `${name}.cmd`),
          `@echo off\r\nnode "%~dp0\\node_modules\\npm\\bin\\${name}-cli.js" %*\r\n`,
        );
        const env = { ...process.env, PATH: directory };
        const resolved = await resolveCommand([name, ...args], env);
        expect(resolved.file).toBe(join(directory, "node.exe"));
        expect(resolved.args).toEqual([entry, ...args]);
        const child = await spawnOwnedProcess([name, ...args], directory, env);
        try {
          expect((await child.exited).code).toBe(0);
        } finally {
          await child.stop(0);
        }
        expect(JSON.parse(await readFile(output, "utf8"))).toEqual(args);
        await writeFile(join(directory, `${name}.cmd`), `${name}-cli.js${"x".repeat(16 * 1024)}`);
        await expect(resolveCommand([name], env)).rejects.toThrow(/Unrecognized/);
      }
    },
  );
});
