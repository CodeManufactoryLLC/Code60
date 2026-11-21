import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { controlUserService, inspectUserService, userServiceDefinition } from "./user-service.js";

describe("per-user service supervisors", () => {
  const runtime = {
    executable: "/Applications/Code60 App/Code60",
    args: ["/app/agent's entry.js"],
    env: { ELECTRON_RUN_AS_NODE: "1", PATH: "/usr/bin:/path with spaces" },
  };
  it("keeps launchd arguments separate, safely encodes XML and throttles restarts", () => {
    const definition = userServiceDefinition("darwin", "/Users/test", "/state", runtime);
    expect(definition.contents).toContain("<string>/Applications/Code60 App/Code60</string>");
    expect(definition.contents).toContain("agent&apos;s entry.js");
    expect(definition.contents).toContain("ThrottleInterval");
    expect(definition.install[0]?.slice(0, 2)).toEqual(["launchctl", "bootstrap"]);
    expect(definition.start.map((argv) => argv[1])).toEqual(["bootstrap", "kickstart"]);
  });
  it("uses systemd --user, quoted arguments, no linger and a bounded stop", () => {
    const definition = userServiceDefinition("linux", "/home/test", "/state", runtime);
    expect(definition.contents).toContain('ExecStart="/Applications/Code60 App/Code60"');
    expect(definition.contents).toContain("TimeoutStopSec=60");
    expect(definition.contents).not.toContain("After=default.target");
    expect(JSON.stringify(definition)).not.toContain("linger");
    expect(definition.install[1]?.slice(0, 2)).toEqual(["systemctl", "--user"]);
  });
  it("starts an unloaded launchd job and tolerates bootstrap only when kickstart succeeds", async () => {
    const definition = userServiceDefinition("darwin", "/Users/test", "/state", runtime);
    const command = vi.fn(async (_argv: readonly string[]) => true);
    await controlUserService(definition, "stop", command);
    command.mockClear();
    await controlUserService(definition, "start", command);
    expect(command.mock.calls.map(([argv]) => argv)).toEqual(definition.start);
    command.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await expect(controlUserService(definition, "start", command)).resolves.toEqual({
      available: true,
    });
    command.mockResolvedValue(false);
    await expect(controlUserService(definition, "start", command)).rejects.toThrow(
      "control failed",
    );
  });
  it("rejects unsupported platforms and unsafe runtime fields", () => {
    expect(() => userServiceDefinition("freebsd", "/home", "/state", runtime)).toThrow(
      "unsupported",
    );
    expect(() =>
      userServiceDefinition("linux", "/home", "/state", { ...runtime, args: ["bad\n"] }),
    ).toThrow("Invalid");
  });
  it("writes registration atomically and invokes only fixed native commands", async () => {
    const root = await mkdtemp(join(tmpdir(), "c60-supervisor-"));
    try {
      const definition = userServiceDefinition("linux", root, root, runtime);
      const command = vi.fn(async (_argv: readonly string[]) => true);
      await controlUserService(definition, "install", command);
      expect(await readFile(definition.path, "utf8")).toBe(definition.contents);
      expect(command.mock.calls.map((call) => call[0])).toEqual(definition.install);
      expect(await controlUserService(definition, "status", command)).toEqual({ available: true });
      await controlUserService(definition, "start", command);
      await controlUserService(definition, "stop", command);
      await controlUserService(definition, "repair", command);
      await controlUserService(definition, "uninstall", command);
      await expect(readFile(definition.path)).rejects.toThrow();
      command.mockResolvedValue(false);
      await expect(controlUserService(definition, "install", command)).rejects.toThrow(
        "registration failed",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it.each(["running", "unavailable", "stopped"] as const)(
    "checks failed repair stops before replacement when native state is %s",
    async (state) => {
      const root = await mkdtemp(join(tmpdir(), "c60-repair-stop-"));
      try {
        const definition = userServiceDefinition("linux", root, root, runtime);
        await controlUserService(definition, "install", async () => true);
        const replacement = { ...definition, contents: "replacement" };
        const command = vi.fn(async (argv: readonly string[]) => !argv.includes("stop"));
        const inspect = vi.fn(async () => ({ definitionPresent: true, state }));
        const repair = controlUserService(replacement, "repair", command, inspect);
        if (state === "stopped") await repair;
        else await expect(repair).rejects.toThrow("could not stop");
        expect(await readFile(definition.path, "utf8")).toBe(
          state === "stopped" ? "replacement" : definition.contents,
        );
        expect(command.mock.calls.map(([argv]) => argv)).toEqual(
          state === "stopped" ? [...definition.stop, ...definition.install] : definition.stop,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it.each([
    [true, "LoadState=loaded\nActiveState=active\n", "running"],
    [true, "LoadState=loaded\nActiveState=inactive\n", "stopped"],
    [true, "LoadState=loaded\nActiveState=failed\n", "stopped"],
    [false, "LoadState=not-found\nActiveState=inactive\n", "stopped"],
    [false, "", "unavailable"],
    [true, "unexpected output", "unavailable"],
  ])("reads systemd state without writing service files, ok=%s", async (ok, stdout, state) => {
    const root = await mkdtemp(join(tmpdir(), "c60-service-inspect-"));
    try {
      const definition = userServiceDefinition("linux", root, root, runtime);
      const command = vi.fn(async () => ({ ok: !!ok, stdout: String(stdout) }));
      expect(await inspectUserService(definition, command)).toEqual({
        definitionPresent: false,
        state,
      });
      expect(command).toHaveBeenCalledOnce();
      await expect(readFile(definition.path)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it.each([
    [{ ok: true, stdout: "state = running\n" }, true, "running"],
    [{ ok: true, stdout: "state = not running\n" }, true, "stopped"],
    [{ ok: false, stdout: "" }, true, "stopped"],
    [{ ok: false, stdout: "" }, false, "unavailable"],
  ])(
    "distinguishes an unloaded launchd job from an unavailable supervisor",
    async (result, available, state) => {
      const definition = userServiceDefinition("darwin", "/no-such-code60-home", "/state", runtime);
      const command = vi
        .fn()
        .mockResolvedValueOnce(result)
        .mockResolvedValue({ ok: available, stdout: "{}" });
      expect(await inspectUserService(definition, command)).toEqual({
        definitionPresent: false,
        state,
      });
    },
  );
});
