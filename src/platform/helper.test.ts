import { execFileSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { helperSync } from "./helper.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("node:fs", () => ({ existsSync: () => true }));
afterEach(() => vi.resetAllMocks());

it.each([
  [2, "ENOENT"],
  [3, "ENOENT"],
  [5, "EACCES"],
  [32, "EBUSY"],
  [33, "EBUSY"],
  [80, "EEXIST"],
  [183, "EEXIST"],
])("maps synchronous Windows error %s to %s", (native, code) => {
  const message = `Cannot create private file (Windows error ${native})`;
  vi.mocked(execFileSync).mockImplementationOnce(() => {
    throw Object.assign(new Error("Command failed"), { stderr: Buffer.from(`${message}\n`) });
  });
  expect(() => helperSync(["create-private", "fixture"])).toThrowError(
    expect.objectContaining({ code, message: `${code}: ${message}` }),
  );
});

it("preserves unclassified privacy failures without inventing a retryable code", () => {
  const message = "Code60-private object has an unsafe owner or ACL";
  vi.mocked(execFileSync).mockImplementationOnce(() => {
    throw Object.assign(new Error("Command failed"), { stderr: message });
  });
  try {
    helperSync(["verify-private", "fixture"]);
    throw new Error("Expected verification to fail");
  } catch (error) {
    expect(error).toHaveProperty("message", message);
    expect(error).not.toHaveProperty("code");
  }
});
