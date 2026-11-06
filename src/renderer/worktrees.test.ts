import { describe, expect, it } from "vitest";
import { formatWorktreeSize } from "./worktrees.js";

describe("worktree sizes", () => {
  it("formats logical sizes in binary units", () => {
    expect(formatWorktreeSize(0)).toBe("0 B");
    expect(formatWorktreeSize(1023)).toBe("1023 B");
    expect(formatWorktreeSize(1024)).toBe("1 KiB");
    expect(formatWorktreeSize(1024 ** 2)).toBe("1 MiB");
    expect(formatWorktreeSize(1024 ** 3)).toBe("1 GiB");
  });

  it("labels unavailable or invalid measurements as unknown", () => {
    for (const size of [null, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatWorktreeSize(size)).toBe("Unknown");
    }
  });
});
