import { afterEach, expect, it, vi } from "vitest";
import { GATEWAY_LIMITS, type Interaction } from "../bridge/index.js";
import { Interactions } from "./interactions.js";

afterEach(() => vi.useRealTimers());

it("binds a single-use decision to its active page and revokes later async requests", async () => {
  const emit = vi.fn<(owner: string, value: Interaction) => void>();
  const ended = vi.fn();
  const interactions = new Interactions([], emit, ended);
  expect(await interactions.run("absent", () => interactions.confirm("Title", "Detail"))).toBe(
    false,
  );
  interactions.attach("page");
  const pending = interactions.run("page", () => interactions.confirm("Title", "Detail"));
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
  expect(await interactions.run("page", () => interactions.confirm("Late", "Detail"))).toBe(false);
});

it("expires unanswered decisions and dismisses the browser dialog", async () => {
  vi.useFakeTimers();
  const ended = vi.fn();
  const interactions = new Interactions([], () => {}, ended);
  interactions.attach("page");
  const pending = interactions.run("page", () => interactions.confirm("Title", "Detail"));
  const id = interactions.list("page")[0]?.id as string;
  await vi.advanceTimersByTimeAsync(GATEWAY_LIMITS.interactionMs);
  expect(await pending).toBe(false);
  expect(ended).toHaveBeenCalledWith("page", id);
  expect(interactions.list("page")).toEqual([]);
  await expect(interactions.choices("page", { id })).rejects.toThrow("expired");
});
