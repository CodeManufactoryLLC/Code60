import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { launchDesktop, removeDesktopFixture as rm } from "./electron-launcher.js";

const fixture = resolve(import.meta.dirname, "fixtures/packaged-agent.mjs");
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

for (const location of process.platform === "win32"
  ? ["fallback", "inherited"]
  : ["fallback", "shell"]) {
  test(`discovers default Droid and npx workers from ${location} PATH`, async () => {
    test.setTimeout(60_000);
    const directory = await mkdtemp(join(tmpdir(), "code60-discovery-"));
    const home = join(directory, "home");
    const bin =
      location === "fallback" ? join(home, ".local/bin") : join(directory, "custom tools");
    await mkdir(bin, { recursive: true });
    const probe = join(directory, "mcp-ok");
    // The host Node path is explicit only inside the fake executable. Application
    // configuration is absent: Code60 must resolve its shipped Droid/npx commands.
    for (const name of ["droid", "npx"]) {
      if (process.platform === "win32") {
        const entry =
          name === "npx"
            ? join(bin, "node_modules", "npm", "bin", "npx-cli.js")
            : join(bin, "droid.cjs");
        await mkdir(join(bin, "node_modules", "npm", "bin"), { recursive: true });
        await copyFile(process.execPath, join(bin, "node.exe"));
        const expected =
          name === "droid"
            ? ["exec", "--output-format", "acp"]
            : ["-y", "@agentclientprotocol/codex-acp"];
        await writeFile(
          entry,
          `
          require("node:assert/strict").deepEqual(process.argv.slice(2), ${JSON.stringify(expected)});
          process.env.CODE60_TEST_DISPATCH = "1";
          process.argv = [process.execPath, __filename, ${JSON.stringify(probe)}];
          import(${JSON.stringify(pathToFileURL(fixture).href)});
        `,
        );
        await writeFile(
          join(bin, `${name}.cmd`),
          `@echo off\r\n"${join(bin, "node.exe")}" "${entry}" %*\r\n`,
        );
        continue;
      }
      const check =
        name === "droid"
          ? '[ "$1" = exec ] && [ "$2" = --output-format ] && [ "$3" = acp ]'
          : '[ "$1" = -y ] && [ "$2" = @agentclientprotocol/codex-acp ]';
      await writeFile(
        join(bin, name),
        `#!/bin/sh\n${check} || exit 91\nexport CODE60_TEST_DISPATCH=1\nexec ${quote(process.execPath)} ${quote(fixture)} ${quote(probe)}\n`,
        { mode: 0o700 },
      );
    }
    const shell = join(directory, "login-shell");
    if (location === "shell") {
      await writeFile(
        shell,
        '#!/bin/sh\necho "shell greeting"\nexport PATH="$CODE60_TEST_AGENT_BIN:$PATH"\nexec /bin/sh -c "$2"\n',
        { mode: 0o700 },
      );
    }
    const app = await launchDesktop(directory, directory, join(directory, "db.sqlite"), true, {
      SHELL: shell, // Missing shell deliberately exercises the fallback branch.
      CODE60_TEST_AGENT_BIN: bin,
      ...(location === "inherited" ? { PATH: `${bin};${process.env.SystemRoot}\\System32` } : {}),
    });
    try {
      const page = await app.firstWindow();
      await expect(page.locator(".splash-title")).toHaveText("Code60");
      await page.evaluate(() => window.desktop.connectDatabase("create"));
      await page.evaluate(() => window.desktop.chooseFolder());
      await page.evaluate(() => window.desktop.setOrchestrationProvider("droid"));
      await expect.poll(() => readFile(probe, "utf8").catch(() => "")).toBe("ok\n");
      await expect
        .poll(() =>
          page.evaluate(async () => {
            const snapshot = await window.desktop.snapshot();
            return snapshot.runs.find((run) => run.record.agent === "codex")?.view?.status;
          }),
        )
        .toBe("idle");
      await page.evaluate(() => window.desktop.testOrchestrationProvider());
      expect(
        await page.evaluate(async () => (await window.desktop.snapshot()).orchestration.connection),
      ).toBe("connected");
      await expect(readFile(join(directory, "config/code60/config.json"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(readFile(join(directory, "unexpected-runtime"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
