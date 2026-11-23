import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { controlUserService, inspectUserService, userServiceDefinition } from "./user-service.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

/** Replace only the native executable; retain real process exit and output limits. */
async function launchdFixture(kind: "absent" | "loaded" | "overflow" | "failed" | "incomplete") {
  const root = await mkdtemp(join(tmpdir(), "c60-launchd-output-"));
  roots.push(root);
  const entries = "  0 0 com.example.background-job\n".repeat(5_000);
  // Even a complete services section cannot prove absence if later output overflows.
  const inventory =
    kind === "overflow"
      ? `services = {\n}\nendpoints = {\n${entries.repeat(14)}}\n`
      : `services = {\n${entries}${kind === "loaded" ? "  123 0 com.codemanufactory.code60.scheduler\n" : ""}${kind === "incomplete" ? "" : "}\n"}`;
  const trace = join(root, "commands.jsonl");
  await writeFile(
    join(root, "launchctl"),
    `#!${process.execPath}
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(trace)}, JSON.stringify(args) + "\\n");
if (args[0] === "bootout" || (args[0] === "print" && args[1].includes("/com."))) {
  process.exitCode = 113;
} else if (args[0] === "print") {
  process.stdout.write(${JSON.stringify(inventory)});
  process.exitCode = ${kind === "failed" ? 1 : 0};
} else if (args[0] !== "bootstrap") {
  throw new Error("Unexpected native command");
}
`,
    { mode: 0o700 },
  );
  vi.stubEnv("PATH", `${root}${delimiter}${process.env.PATH ?? ""}`);
  const definition = userServiceDefinition("darwin", root, root, {
    executable: process.execPath,
    args: [],
    env: {},
  });
  await controlUserService(definition, "install");
  return {
    definition,
    async commands() {
      return (await readFile(trace, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    },
  };
}

describe("launchd inspection subprocess output", () => {
  it.each(["repair", "stop", "uninstall"] as const)(
    "completes %s for an unloaded job with a domain inventory larger than 64 KiB",
    async (action) => {
      const { definition, commands } = await launchdFixture("absent");
      await expect(inspectUserService(definition)).resolves.toMatchObject({
        definitionPresent: true,
        state: "stopped",
        loaded: false,
      });
      const replacement = { ...definition, contents: "replacement" };
      await expect(controlUserService(replacement, action)).resolves.toEqual({
        available: action === "repair",
      });
      if (action === "uninstall")
        await expect(readFile(definition.path)).rejects.toMatchObject({ code: "ENOENT" });
      else
        expect(await readFile(definition.path, "utf8")).toBe(
          action === "repair" ? "replacement" : definition.contents,
        );
      expect(await commands()).toEqual([
        definition.install[0]?.slice(1),
        definition.status.slice(1),
        ["print", `gui/${process.getuid?.() ?? -1}`],
        definition.stop[0]?.slice(1),
        definition.status.slice(1),
        ["print", `gui/${process.getuid?.() ?? -1}`],
        ...(action === "repair" ? [definition.install[0]?.slice(1)] : []),
      ]);
    },
  );

  it.each(["loaded", "overflow", "failed", "incomplete"] as const)(
    "preserves registration when a large domain inventory is %s",
    async (kind) => {
      const { definition } = await launchdFixture(kind);
      await expect(inspectUserService(definition)).resolves.toMatchObject({ state: "unavailable" });
      for (const action of ["repair", "stop", "uninstall"] as const) {
        await expect(
          controlUserService({ ...definition, contents: "replacement" }, action),
        ).rejects.toThrow(action === "repair" ? "could not stop" : "control failed");
        expect(await readFile(definition.path, "utf8")).toBe(definition.contents);
      }
    },
  );
});
