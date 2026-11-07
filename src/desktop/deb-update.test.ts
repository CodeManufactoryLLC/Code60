import { beforeEach, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile: execute }));

import { installDeb } from "./deb-update.js";

type Callback = (error: Error | null) => void;
const respond = (error: Error | null) =>
  execute.mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback === "function") (callback as Callback)(error);
  });
const calls = () => execute.mock.calls.filter((args) => args.length > 0);

beforeEach(() => execute.mockReset());
it("uses bounded asynchronous PolicyKit authorization with an argument array", async () => {
  respond(null);
  await installDeb("/cache/space '雪;test.deb");
  expect(calls()).toEqual([
    [
      "/usr/bin/pkexec",
      ["/usr/bin/dpkg", "-i", "/cache/space '雪;test.deb"],
      expect.objectContaining({
        timeout: 300_000,
        maxBuffer: 65536,
        env: expect.objectContaining({ PATH: "/usr/sbin:/usr/bin:/sbin:/bin" }),
      }),
      expect.any(Function),
    ],
  ]);
});
it("propagates authorization or dpkg failure without silently claiming success", async () => {
  respond(new Error("authorization denied"));
  await expect(installDeb("/cache/update.deb")).rejects.toThrow("authorization denied");
});
