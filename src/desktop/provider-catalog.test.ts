import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../core/index.js";
import { desktopConfig, detectProvider, executableExists, PROVIDERS } from "./provider-catalog.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
it("keeps the catalog alphabetical and preserves overrides without changing CLI defaults", () => {
  expect(PROVIDERS.map((p) => p.name)).toEqual([
    "Antigravity",
    "Claude",
    "Codex",
    "Copilot",
    "Droid",
    "Kiro",
    "OpenCode",
  ]);
  const config = desktopConfig({
    ...DEFAULT_CONFIG,
    agents: { ...DEFAULT_CONFIG.agents, kiro: { command: ["/custom/kiro", "acp"] } },
  });
  expect(config.agents.kiro?.command).toEqual(["/custom/kiro", "acp"]);
  expect(config.agents.antigravity?.command).toEqual(["agy", "acp"]);
  expect(config.agents.copilot?.command).toEqual(["copilot", "--acp", "--stdio"]);
  expect(DEFAULT_CONFIG.agents.kiro).toBeUndefined();
});
it.each(["claude", "codex"])("does not detect %s from npx alone", async (id) => {
  const command = PROVIDERS.find((p) => p.id === id)?.command ?? ["missing"];
  await expect(detectProvider(id, command, {}, async (file) => file === "npx")).rejects.toThrow(
    "was not found",
  );
  await expect(
    detectProvider(id, command, {}, async (file) => file === "npx" || file === id),
  ).resolves.toBeUndefined();
  await expect(
    detectProvider(id, ["/custom/adapter", "acp"], {}, async (file) => file === "/custom/adapter"),
  ).resolves.toBeUndefined();
});
it.runIf(process.platform !== "win32")(
  "discovers executable absolute/PATH overrides on POSIX and rechecks newly installed tools",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "code60-executables-"));
    directories.push(dir);
    const file = join(dir, "agy");
    expect(await executableExists("agy", { PATH: dir }, "darwin")).toBe(false);
    await writeFile(file, "#!/bin/sh\n", { mode: 0o700 });
    for (const platform of ["darwin", "linux"] as const) {
      expect(await executableExists("agy", { PATH: dir }, platform)).toBe(true);
      expect(await executableExists(file, { PATH: "" }, platform)).toBe(true);
      expect(await executableExists("./agy", { PATH: dir }, platform)).toBe(false);
    }
    await chmod(file, 0o600);
    expect(await executableExists(file, {}, "linux")).toBe(false);
    await mkdir(join(dir, "kiro-cli"));
    expect(await executableExists("kiro-cli", { PATH: dir }, "linux")).toBe(false);
  },
);
it.runIf(process.platform === "win32")(
  "discovers Windows npm shims and absolute commands without implicit cwd lookup",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "code60-executables-"));
    directories.push(dir);
    await mkdir(join(dir, "node_modules/npm/bin"), { recursive: true });
    await writeFile(join(dir, "node_modules/npm/bin/npx-cli.js"), "");
    await writeFile(
      join(dir, "npx.cmd"),
      "@echo off\r\nnode node_modules/npm/bin/npx-cli.js %*\r\n",
    );
    await writeFile(join(dir, "node.exe"), "");
    expect(await executableExists("npx", { Path: dir }, "win32")).toBe(true);
    expect(await executableExists(join(dir, "node.exe"), {}, "win32")).toBe(true);
    expect(await executableExists(".\\node.exe", { PATH: dir }, "win32")).toBe(false);
    await rm(join(dir, "node.exe"));
    expect(await executableExists("npx", { PATH: dir }, "win32")).toBe(false);
  },
);
