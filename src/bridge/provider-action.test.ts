import { expect, it } from "vitest";
import { parseProviderAction } from "./index.js";

it("accepts only a bounded provider identity and the two fixed membership actions", () => {
  for (const type of ["set-primary", "disconnect"])
    expect(parseProviderAction({ type, provider: "codex" })).toEqual({ type, provider: "codex" });
  for (const value of [
    null,
    {},
    { type: "connect", provider: "codex" },
    { type: "disconnect", provider: "../codex" },
    { type: "set-primary", provider: "x".repeat(101) },
    { type: "set-primary", provider: "codex", command: ["node"] },
    { type: "disconnect", provider: "codex", cwd: "/tmp" },
  ])
    expect(() => parseProviderAction(value)).toThrow();
});
