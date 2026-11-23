import { expect, it, vi } from "vitest";
import { WebLinks } from "./web-links.js";

it("opens only the normalized destination after confirmation, and cancellation does nothing", async () => {
  const confirm = vi.fn(async () => false);
  const open = vi.fn(async () => {});
  const links = new WebLinks({ confirm, open });
  expect(await links.open({ url: "HTTPS://Example.COM" })).toBe(false);
  expect(confirm).toHaveBeenCalledWith("https://example.com/");
  expect(open).not.toHaveBeenCalled();
  confirm.mockResolvedValue(true);
  expect(await links.open({ url: "https://example.com/path" })).toBe(true);
  expect(open).toHaveBeenCalledExactlyOnceWith("https://example.com/path");
  await expect(links.open({ url: "file:///tmp/test" })).rejects.toThrow();
  expect(confirm).toHaveBeenCalledTimes(2);
});

it("allows only one pending confirmation and releases the guard after cancellation", async () => {
  let decide!: (value: boolean) => void;
  const confirm = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        decide = resolve;
      }),
  );
  const open = vi.fn(async () => {});
  const links = new WebLinks({ confirm, open });
  const first = links.open({ url: "https://example.com/one" });
  expect(await links.open({ url: "https://example.com/two" })).toBe(false);
  expect(confirm).toHaveBeenCalledTimes(1);
  decide(false);
  expect(await first).toBe(false);
  const next = links.open({ url: "https://example.com/two" });
  decide(true);
  expect(await next).toBe(true);
  expect(open).toHaveBeenCalledExactlyOnceWith("https://example.com/two");
});

it("reports fixed failures without leaking URLs or raw errors and permits retry", async () => {
  const confirm = vi.fn(async () => true);
  const open = vi.fn<(url: string) => Promise<void>>(async () => {
    throw new Error("private details");
  });
  const links = new WebLinks({ confirm, open });
  await expect(links.open({ url: "https://example.com" })).rejects.toThrow(
    "Could not open link. Try again.",
  );
  open.mockResolvedValue(undefined);
  expect(await links.open({ url: "https://example.com" })).toBe(true);
  confirm.mockRejectedValueOnce(new Error("private details"));
  await expect(links.open({ url: "https://example.com" })).rejects.toThrow(
    "Could not open link. Try again.",
  );
  expect(await links.open({ url: "https://example.com" })).toBe(true);
});
