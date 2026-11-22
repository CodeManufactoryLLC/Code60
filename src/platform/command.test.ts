import { afterEach, expect, it, vi } from "vitest";
import { resolveCommand, spawnOwnedProcess } from "./index.js";

afterEach(() => vi.unstubAllGlobals());
it("passes executable and arguments literally without a shell", async () => {
  const args = ["node", "a b", "$(touch unsafe)", "雪", "a; echo b"] as const;
  expect(await resolveCommand(args)).toEqual({ file: "node", args: args.slice(1) });
});
it.each(["win32", "freebsd"] as const)(
  "rejects %s before launching a process",
  async (platform) => {
    await expect(resolveCommand(["node"], {}, platform)).rejects.toThrow("macOS and Linux only");
    vi.stubGlobal("process", { ...process, platform });
    await expect(spawnOwnedProcess(["node"], process.cwd())).rejects.toThrow(
      "macOS and Linux only",
    );
  },
);
