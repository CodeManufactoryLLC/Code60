import { expect, it } from "vitest";
import { pathLabel } from "./path-label.js";

it.each([
  ["/home/user/project", "project"],
  ["C:\\Users\\Test User\\雪\\", "雪"],
  ["D:/work/project", "project"],
  ["/", "/"],
])("labels native paths without Node capabilities: %s", (path, label) => {
  expect(pathLabel(path)).toBe(label);
});
