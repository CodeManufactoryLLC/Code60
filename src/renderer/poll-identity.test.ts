import { expect, it } from "vitest";
import type { Polling } from "../bridge/index.js";
import { pollRequestIdentity } from "./poll-identity.js";

it("keeps Refresh on the displayed target and database address", () => {
  const scoped = (id: string, epoch: number) =>
    ({
      sources: [
        { key: "config", scope: { kind: "application", id: "configuration" } },
        { key: "history", scope: { kind: "target", id } },
        { key: "configurations", scope: { kind: "database", id: String(epoch) } },
      ],
    }) as Polling;
  const first = scoped("a", 7);
  expect(pollRequestIdentity(first)).toEqual({ projectId: "a", databaseEpoch: 7 });
  expect(pollRequestIdentity(scoped("b", 8))).toEqual({ projectId: "b", databaseEpoch: 8 });
  expect(pollRequestIdentity(first)).toEqual({ projectId: "a", databaseEpoch: 7 });
  expect(pollRequestIdentity({ paused: false, sources: [] })).toBeUndefined();
  expect(
    pollRequestIdentity({
      paused: false,
      sources: [first.sources[2] as Polling["sources"][number]],
    }),
  ).toEqual({ projectId: undefined, databaseEpoch: 7 });
});
