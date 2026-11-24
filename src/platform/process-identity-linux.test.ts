import { expect, it } from "vitest";
import {
  linuxFamilyPids,
  parseLinuxProcessStat,
  parseLinuxProcessUid,
} from "./process-identity-linux.js";

const stat = (name = "node ) with spaces", parent = "123", ticks = "98765432123456789") =>
  `456 (${name}) S ${parent} ${Array(17).fill("0").join(" ")} ${ticks} 0 0\n`;
it("parses kernel start ticks without precision loss or ambiguity from the process name", () => {
  expect(parseLinuxProcessStat(stat(), 456)).toEqual({
    pid: 456,
    parent: 123,
    state: "S",
    ticks: "98765432123456789",
  });
  expect(parseLinuxProcessStat(stat("node\n)"), 456).parent).toBe(123);
});
it("rejects malformed, mismatched and unbounded process identities without returning contents", () => {
  for (const value of [
    "",
    "private fixture",
    stat().replace("456 (", "457 ("),
    stat("node", "-1"),
    stat("node", "2147483648"),
    stat("node", "123", "not-ticks"),
    "456 (node) S 1",
  ])
    expect(() => parseLinuxProcessStat(value, 456)).toThrow("ownership is unavailable");
  for (const pid of [0, -1, 1.1, Number.NaN, 2 ** 31])
    expect(() => parseLinuxProcessStat(stat(), pid)).toThrow("ownership is unavailable");
});
it("requires all four bounded kernel UID fields", () => {
  expect(parseLinuxProcessUid("Name:\tnode\nUid:\t1000\t1000\t1000\t1000\nGid:\t1000\n")).toEqual([
    1000, 1000, 1000, 1000,
  ]);
  for (const value of ["", "Uid: 1 2 3", "Uid: -1 1 1 1", "Uid: 4294967296 1 1 1"])
    expect(() => parseLinuxProcessUid(value)).toThrow("ownership is unavailable");
});
it("rejects a foreign-UID descendant and reused or duplicate owner identity before returning an exit set", () => {
  const owner = { pid: 10, parent: 1, uid: 1000, started: "boot:100", commandHash: "a".repeat(64) };
  const child = { pid: 11, parent: 10, uid: 1000, started: "boot:101" };
  expect(linuxFamilyPids(owner, [owner, child])).toEqual([10, 11]);
  for (const rows of [
    [owner, { ...child, uid: 2000 }],
    [{ ...owner, started: "boot:200" }, child],
    [owner, owner],
    [child],
  ])
    expect(() => linuxFamilyPids(owner, rows)).toThrow("ownership is unavailable");
  expect(() => linuxFamilyPids(owner, [owner], AbortSignal.abort(Error("cancelled")))).toThrow(
    "cancelled",
  );
});
