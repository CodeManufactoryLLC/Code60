import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { defaultDeps } from "../src/core/index.js";
import { ExecutionHost } from "../src/desktop/execution-host.js";

const identity = vi.hoisted(() => ({ inode: 9_007_199_254_740_992n }));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  realpath: async (path: string) => path,
  stat: async (_path: string, options?: { bigint?: boolean }) => ({
    dev: options?.bigint ? 1n : 1,
    ino: options?.bigint ? identity.inode : Number(identity.inode),
    isDirectory: () => true,
  }),
}));

it("distinguishes replaced targets whose native file IDs collide as JavaScript numbers", async () => {
  const host = new ExecutionHost(
    defaultDeps(),
    {},
    {
      authorize() {},
      event() {},
      changed() {},
      warning() {},
    },
  );
  try {
    const target = await host.target(resolve("identity-fixture"));
    const original = identity.inode;
    identity.inode++;
    expect(Number(identity.inode)).toBe(Number(original));
    await expect(host.validateTarget(target)).rejects.toThrow("identity changed");
    await expect(host.target(target.cwd)).rejects.toThrow("identity changed");
  } finally {
    await host.shutdown(true);
  }
});
