import { expect, it } from "vitest";
import { readResume } from "./resume-destination.js";

const storage = (raw: string) => ({ getItem: () => raw }) as unknown as Storage;
it.each([
  "garbage",
  "null",
  '{"page":"toString"}',
  '{"page":"files"}',
  '{"page":"settings","section":"bogus"}',
  '{"page":"provider","provider":{}}',
])("ignores invalid saved routes %s", (raw) =>
  expect(readResume(storage(raw), "db")).toBeUndefined(),
);
it("only returns the identity fields for the saved destination", () => {
  expect(
    readResume(storage('{"page":"project","project":"a","chat":"other","action":"run"}'), "db"),
  ).toEqual({ page: "project", project: "a" });
});
it("reopens a former provider detail destination on Providers", () => {
  expect(readResume(storage('{"page":"provider","provider":"claude"}'), "db")).toEqual({
    page: "providers",
  });
});
