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
  '{"page":"projects"}',
  '{"page":"project","project":"a"}',
])("ignores invalid saved routes %s", (raw) =>
  expect(readResume(storage(raw), "db")).toBeUndefined(),
);
it("only returns the identity fields for the saved destination", () => {
  expect(
    readResume(storage('{"page":"chat","chat":"chat-a","project":"a","action":"run"}'), "db"),
  ).toEqual({ page: "chat", chat: "chat-a" });
});
it("reopens a former provider detail destination on Providers", () => {
  expect(readResume(storage('{"page":"provider","provider":"claude"}'), "db")).toEqual({
    page: "providers",
  });
});
