import { expect, it } from "vitest";
import { parseWebLink } from "./index.js";

it("normalizes bounded absolute HTTP(S) URLs without broadening the request", () => {
  expect(parseWebLink({ url: "HTTPS://Example.COM/path?q=one#two" })).toEqual({
    url: "https://example.com/path?q=one#two",
  });
  expect(parseWebLink({ url: "http://localhost:3000/" }).url).toBe("http://localhost:3000/");
  const prefix = "https://example.com/";
  expect(parseWebLink({ url: prefix + "a".repeat(8192 - prefix.length) }).url).toHaveLength(8192);
});

it.each([
  null,
  {},
  { url: 1 },
  { url: "https://example.com", extra: true },
  { url: "javascript:alert(1)" },
  { url: "data:text/html,hi" },
  { url: "file:///tmp/test" },
  { url: "mailto:user@example.com" },
  { url: "//example.com" },
  { url: "/tmp/test" },
  { url: "https:example.com" },
  { url: "https:///example.com" },
  { url: "https://" },
  { url: "https://user:pass@example.com/" },
  { url: "https://user@example.com/" },
  { url: "https://example.com\\@other.com" },
  { url: "https://exam\nple.com" },
  { url: " https://example.com" },
  { url: "https://example.com/\u0000" },
  { url: `https://example.com/${"x".repeat(8192)}` },
  { url: `https://example.com/${"é".repeat(2000)}` },
])("rejects unsafe or malformed web link requests: %j", (value) => {
  expect(() => parseWebLink(value)).toThrow();
});
