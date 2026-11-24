import { afterEach, expect, it, vi } from "vitest";
import { GATEWAY_LIMITS, type Interaction } from "../bridge/index.js";
import { Interactions } from "./interactions.js";

afterEach(() => vi.useRealTimers());

it("binds a single-use decision to its active page and revokes later async requests", async () => {
  const emit = vi.fn<(owner: string, value: Interaction) => void>();
  const ended = vi.fn();
  const interactions = new Interactions([], emit, ended);
  expect(await interactions.run("absent", () => interactions.confirm("clear-logs", "Detail"))).toBe(
    false,
  );
  interactions.attach("page");
  const pending = interactions.run("page", () => interactions.confirm("clear-logs", "Detail"));
  expect(emit.mock.calls[0]?.[1]).toMatchObject({
    kind: "confirm",
    presentation: "clear-logs",
    title: "Clear logs?",
  });
  const id = emit.mock.calls[0]?.[1].id as string;
  await expect(interactions.answer("other", { id, accepted: true })).rejects.toThrow("expired");
  await interactions.answer("page", { id, accepted: true });
  expect(await pending).toBe(true);
  expect(ended).toHaveBeenCalledWith("page", id);
  await expect(interactions.answer("page", { id, accepted: true })).rejects.toThrow("expired");
  const detached = interactions.run("page", () => interactions.pick("folder"));
  expect(interactions.list("page")).toHaveLength(1);
  expect(interactions.list("other")).toHaveLength(0);
  interactions.detach("page");
  expect(await detached).toBeNull();
  expect(await interactions.run("page", () => interactions.confirm("clear-logs", "Detail"))).toBe(
    false,
  );
});

it("expires unanswered decisions and dismisses the browser dialog", async () => {
  vi.useFakeTimers();
  const ended = vi.fn();
  const interactions = new Interactions([], () => {}, ended);
  interactions.attach("page");
  const pending = interactions.run("page", () => interactions.confirm("clear-logs", "Detail"));
  const id = interactions.list("page")[0]?.id as string;
  await vi.advanceTimersByTimeAsync(GATEWAY_LIMITS.interactionMs);
  expect(await pending).toBe(false);
  expect(ended).toHaveBeenCalledWith("page", id);
  expect(interactions.list("page")).toEqual([]);
  await expect(interactions.choices("page", { id })).rejects.toThrow("expired");
});

it("captures authenticated page ownership across awaits and rejects detached or absent owners", async () => {
  const interactions = new Interactions([], () => {});
  expect(() => interactions.page()).toThrow("detached");
  expect(() => interactions.run("absent", () => interactions.page())).toThrow("detached");
  interactions.attach("first");
  interactions.attach("second");
  await Promise.all(
    ["first", "second"].map((owner) =>
      interactions.run(owner, async () => {
        await Promise.resolve();
        expect(interactions.page()).toBe(owner);
      }),
    ),
  );
  interactions.detach("first");
  expect(() => interactions.run("first", () => interactions.page())).toThrow("detached");
  expect(interactions.run("second", () => interactions.page())).toBe("second");
  interactions.close();
  expect(() => interactions.run("second", () => interactions.page())).toThrow("detached");
});

it("derives private setup ownership from active asynchronous page context and revokes detached pages", async () => {
  const interactions = new Interactions([], () => {});
  expect(() => interactions.currentOwner()).toThrow("no longer active");
  expect(() => interactions.run("unattached", () => interactions.currentOwner())).toThrow(
    "no longer active",
  );
  interactions.attach("page-a");
  interactions.attach("page-b");
  const owners = await Promise.all(
    ["page-a", "page-b"].map((owner) =>
      interactions.run(owner, async () => {
        await Promise.resolve();
        return interactions.currentOwner();
      }),
    ),
  );
  expect(owners).toEqual(["page-a", "page-b"]);
  interactions.run("page-a", () => {
    interactions.detach("page-a");
    expect(() => interactions.currentOwner()).toThrow("no longer active");
  });
  expect(interactions.run("page-b", () => interactions.currentOwner())).toBe("page-b");
  interactions.close();
  expect(() => interactions.run("page-b", () => interactions.currentOwner())).toThrow(
    "no longer active",
  );
});
