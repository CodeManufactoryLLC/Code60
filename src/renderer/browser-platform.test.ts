import { afterEach, expect, it, vi } from "vitest";
import { copyText, randomId } from "./browser-platform.js";

afterEach(() => vi.unstubAllGlobals());
it("produces cryptographic v4 UUIDs without the secure-context randomUUID method", () => {
  const source = { getRandomValues: crypto.getRandomValues.bind(crypto) };
  const ids = new Set(Array.from({ length: 100 }, () => randomId(source)));
  expect(ids.size).toBe(100);
  for (const id of ids)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
it("acknowledges supported clipboard writes and propagates fallback denial", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await copyText("exact source");
  expect(writeText).toHaveBeenCalledWith("exact source");
  const remove = vi.fn();
  const focus = vi.fn();
  class Element {
    closest() {
      return null;
    }
    focus = focus;
  }
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("document", {
    activeElement: new Element(),
    getSelection: () => null,
    createElement: () => ({
      value: "",
      style: {},
      setAttribute() {},
      select() {},
      focus() {
        Object.defineProperty(document, "activeElement", { value: this, configurable: true });
      },
      remove,
    }),
    body: { append() {} },
    execCommand: () => false,
  });
  await expect(copyText("secret")).rejects.toThrow("manually");
  expect(remove).toHaveBeenCalledOnce();
  expect(focus).toHaveBeenCalledOnce();
  vi.stubGlobal("document", {
    ...document,
    execCommand: () => {
      throw new Error("private browser detail");
    },
  });
  await expect(copyText("secret")).rejects.toThrow("Select the text and copy it manually");
  expect(remove).toHaveBeenCalledTimes(2);
});
