import { expect, it } from "vitest";
import { parseRelayFileContext } from "./index.js";

const context = {
  subscriptionId: crypto.randomUUID(),
  sequence: 1,
  active: true,
  directories: [""],
  preview: "src/example.txt",
};
it("accepts only bounded, subscription-addressed relative Relay file contexts", () => {
  expect(parseRelayFileContext(context)).toEqual(context);
  for (const invalid of [
    { ...context, cwd: "/project" },
    { ...context, root: "/project" },
    { ...context, projectId: crypto.randomUUID() },
    { ...context, subscriptionId: "" },
    { ...context, sequence: 0 },
    { ...context, sequence: Number.MAX_SAFE_INTEGER + 1 },
    { ...context, directories: [] },
    { ...context, directories: ["", ""] },
    { ...context, directories: ["folder"] },
    { ...context, directories: ["", ...Array.from({ length: 64 }, (_, i) => String(i))] },
    ...[
      "/outside",
      "../outside",
      "folder/../outside",
      "folder\\outside",
      "",
      "x".repeat(4097),
      "\0",
    ].map((preview) => ({ ...context, preview })),
  ])
    expect(() => parseRelayFileContext(invalid)).toThrow();
});
