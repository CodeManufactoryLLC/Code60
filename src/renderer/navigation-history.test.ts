import { describe, expect, it, vi } from "vitest";
import {
  type Current,
  type Destination,
  destination,
  NavigationRecorder,
  recordDestination,
} from "./navigation-history.js";

const chat = (id: string): Destination => ({ page: "chat", chat: id });
const chatless: Destination = { page: "chat" };
const sessions: Destination = { page: "sessions" };
const settings: Destination = { page: "settings", section: "agents" };
const logs: Destination = { page: "logs" };
const always = () => true;
const isChat = (id: string) => (entry: Destination) => entry.page === "chat" && entry.chat === id;

/** A recorder whose restores take effect immediately, like page and worker selection. */
function recorder(start: Destination) {
  let where = start;
  const changes = vi.fn();
  const timers = {
    set: vi.fn(
      (_callback: () => void, _ms: number) => 0 as unknown as ReturnType<typeof setTimeout>,
    ),
    clear: vi.fn(),
  };
  const history = new NavigationRecorder(start, changes, timers);
  const visit = (next: Destination) => {
    where = next;
    history.observe(next);
  };
  const go = (direction: -1 | 1, available: (entry: Destination) => boolean = always) =>
    history.go(direction, available, (entry) => visit(entry));
  const expire = () => {
    const callback = timers.set.mock.calls.at(-1)?.[0];
    if (!callback) throw new Error("No timer was started");
    callback();
  };
  return { history, visit, go, expire, changes, timers, where: () => where };
}

/** A restore that resolves when the test says so, like selecting an orchestrator. */
function deferred() {
  let resolve = () => {};
  let reject = (_cause: Error) => {};
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise((resolve) => setTimeout(resolve));

describe("destinations", () => {
  it("identifies Settings pages and specific chats, ignoring unrelated state", () => {
    expect(destination("settings", "updates", "run-1")).toEqual({
      page: "settings",
      section: "updates",
    });
    expect(destination("chat", "agents", "run-1")).toEqual(chat("run-1"));
    expect(destination("chat", "agents", undefined)).toEqual(chatless);
    expect(destination("events", "agents", "run-1")).toEqual({ page: "events" });
  });
});

describe("navigation history", () => {
  it("goes back through mixed chats and pages, then forward again", () => {
    const nav = recorder(chat("orchestrator"));
    nav.visit(chat("worker"));
    nav.visit(sessions);
    expect(nav.history.canGo(1, always)).toBe(false);

    nav.go(-1);
    expect(nav.where()).toEqual(chat("worker"));
    nav.go(-1);
    expect(nav.where()).toEqual(chat("orchestrator"));
    expect(nav.history.canGo(-1, always)).toBe(false);

    nav.go(1);
    expect(nav.where()).toEqual(chat("worker"));
    nav.go(1);
    expect(nav.where()).toEqual(sessions);
    expect(nav.history.canGo(1, always)).toBe(false);
    expect(nav.history.history.entries).toHaveLength(3);
  });

  it("records chat switches that stay on the Chat page", () => {
    const nav = recorder(chat("a"));
    nav.visit(chat("b"));
    nav.visit(chat("worker-1"));
    nav.visit(chat("worker-2"));
    expect(nav.history.history.entries).toEqual([
      chat("a"),
      chat("b"),
      chat("worker-1"),
      chat("worker-2"),
    ]);
  });

  it("records Settings pages separately", () => {
    const nav = recorder(settings);
    nav.visit({ page: "settings", section: "text" });
    nav.go(-1);
    expect(nav.where()).toEqual(settings);
  });

  it("does not duplicate the current destination", () => {
    const nav = recorder(sessions);
    nav.visit(sessions);
    nav.visit(chat("a"));
    nav.visit(chat("a"));
    expect(nav.history.history.entries).toEqual([sessions, chat("a")]);
    expect(nav.changes).toHaveBeenCalledTimes(1);
  });

  it("clears forward history when a different destination is chosen after Back", () => {
    const nav = recorder(chat("a"));
    nav.visit(sessions);
    nav.visit({ page: "events" });
    nav.go(-1);
    nav.visit(logs);
    expect(nav.history.history.entries).toEqual([chat("a"), sessions, logs]);
    expect(nav.history.canGo(1, always)).toBe(false);
  });

  it("keeps forward history when the destination Back reached is chosen again", () => {
    const nav = recorder(chat("a"));
    nav.visit(sessions);
    nav.go(-1);
    nav.visit(chat("a"));
    expect(nav.history.canGo(1, always)).toBe(true);
  });

  it("skips unavailable chats and duplicates they leave behind", () => {
    const nav = recorder(sessions);
    nav.visit(chat("archived"));
    nav.visit(sessions);
    nav.visit(chat("live"));
    const available = (entry: Destination) => entry.chat !== "archived";
    nav.go(-1, available);
    expect(nav.where()).toEqual(sessions);
    expect(nav.history.canGo(-1, available)).toBe(false);
    expect(nav.history.canGo(-1, always)).toBe(true);
  });

  it("does nothing when no destination is available", () => {
    const nav = recorder(chat("a"));
    const restore = vi.fn();
    nav.history.go(-1, always, restore);
    nav.history.go(1, always, restore);
    expect(restore).not.toHaveBeenCalled();
  });

  it("turns Chat without a conversation into the conversation once it appears", () => {
    const nav = recorder(chatless);
    nav.visit(chat("a"));
    expect(nav.history.history.entries).toEqual([chat("a")]);
    expect(recordDestination(nav.history.history, sessions).entries).toEqual([chat("a"), sessions]);
  });

  it("keeps the most recent 100 destinations", () => {
    const nav = recorder(chat("0"));
    for (let index = 1; index <= 150; index += 1) nav.visit(chat(String(index)));
    const { entries, index } = nav.history.history;
    expect(entries).toHaveLength(100);
    expect(entries[0]).toEqual(chat("51"));
    expect(index).toBe(99);
  });
});

describe("asynchronous navigation", () => {
  it("ignores the destinations a selection passes through until the chat appears", () => {
    const nav = recorder(sessions);
    const [settle] = nav.history.expect(isChat("b"), [sessions, chatless, chat("a"), chat("w")]);
    nav.visit(chat("a"));
    nav.visit(chat("w"));
    settle(true);
    nav.visit(chat("b"));
    expect(nav.history.history.entries).toEqual([sessions, chat("b")]);
    expect(nav.timers.clear).toHaveBeenCalled();
  });

  it("does not wait for a selection that is already shown", () => {
    // Review: clicking the selected orchestrator must not suppress later visits.
    const nav = recorder(chat("a"));
    const [settle, current] = nav.history.expect(isChat("a"), [chat("a")]);
    nav.visit(settings);
    nav.visit(logs);
    settle(true);
    expect(current()).toBe(true);
    expect(nav.history.history.entries).toEqual([chat("a"), settings, logs]);
    expect(nav.timers.set).not.toHaveBeenCalled();
  });

  it("records a different destination at once and stops waiting", () => {
    const nav = recorder(sessions);
    const [settle, current] = nav.history.expect(isChat("b"), [sessions, chat("a")]);
    nav.visit(chat("a"));
    nav.visit(settings);
    expect(current()).toBe(false);
    nav.visit(logs);
    settle(true);
    nav.visit(chat("b"));
    expect(nav.history.history.entries).toEqual([sessions, settings, logs, chat("b")]);
  });

  it("records where the user is when the request fails", () => {
    const nav = recorder(sessions);
    const [settle] = nav.history.expect(isChat("b"), [chat("a")]);
    nav.visit(chat("a"));
    const failed = vi.fn();
    settle(false, failed);
    expect(failed).toHaveBeenCalled();
    expect(nav.history.history.entries).toEqual([sessions, chat("a")]);
    settle(false, failed);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it("records where the user is if the destination never appears", () => {
    const nav = recorder(sessions);
    const [settle] = nav.history.expect(isChat("b"), [chat("a")]);
    nav.visit(chat("a"));
    settle(true);
    nav.expire();
    expect(nav.history.history.entries).toEqual([sessions, chat("a")]);
  });

  it("lets a newer request replace an older one", () => {
    const nav = recorder(sessions);
    const [first, firstCurrent] = nav.history.expect(isChat("a"), [sessions]);
    nav.history.expect(isChat("b"), [sessions, chat("a")]);
    expect(firstCurrent()).toBe(false);
    nav.visit(chat("a"));
    first(false);
    nav.visit(chat("b"));
    expect(nav.history.history.entries).toEqual([sessions, chat("b")]);
  });

  it("does not add steps while restoring a chat through the main process", async () => {
    const nav = recorder(chat("a"));
    nav.visit(chat("b"));
    const restore = deferred();
    nav.history.go(-1, always, () => restore.promise, [chat("b-worker")]);
    nav.visit(chat("b-worker"));
    expect(nav.history.history.index).toBe(0);
    nav.visit(chat("a"));
    restore.resolve();
    await flush();
    expect(nav.history.history).toEqual({ entries: [chat("a"), chat("b")], index: 0 });
    expect(nav.history.canGo(1, always)).toBe(true);
  });

  it("tells a slow restore that a newer navigation superseded it", async () => {
    // Review: an earlier Back must not override the user's latest destination.
    const nav = recorder(chat("a"));
    nav.visit(chat("b"));
    const restore = deferred();
    let current: Current = () => true;
    nav.history.go(-1, always, (_entry, isCurrent) => {
      current = isCurrent;
      return restore.promise;
    });
    nav.visit(settings);
    expect(current()).toBe(false);
    restore.resolve();
    await flush();
    expect(nav.history.history).toEqual({ entries: [chat("a"), settings], index: 1 });
  });

  it("keeps forward history when a chatless entry resolves to a conversation", () => {
    // Review: traversing to a chatless entry must not delete the destinations after it.
    const nav = recorder(chatless);
    nav.visit(settings);
    nav.history.go(-1, always, () => nav.visit(chat("new")));
    expect(nav.history.history).toEqual({ entries: [chat("new"), settings], index: 0 });
    expect(nav.history.canGo(1, always)).toBe(true);
  });

  it("keeps forward history when a restored destination never fully appears", async () => {
    const nav = recorder(chatless);
    nav.visit(settings);
    const restore = deferred();
    nav.history.go(-1, always, () => restore.promise, [logs]);
    nav.visit(logs);
    restore.resolve();
    await flush();
    nav.expire();
    expect(nav.history.history).toEqual({ entries: [logs, settings], index: 0 });
  });

  it("returns to the previous position when restoring fails", async () => {
    const nav = recorder(chat("a"));
    nav.visit(chat("b"));
    nav.history.go(-1, always, () => Promise.reject(new Error("gone")));
    expect(nav.history.history.index).toBe(0);
    await flush();
    expect(nav.history.history).toEqual({ entries: [chat("a"), chat("b")], index: 1 });
  });

  it("returns to the previous position when restoring throws", () => {
    const nav = recorder(chat("a"));
    nav.visit(chat("b"));
    expect(() =>
      nav.history.go(-1, always, () => {
        throw new Error("broken");
      }),
    ).toThrow("broken");
    expect(nav.history.history.index).toBe(1);
  });

  it("stops waiting when disposed", () => {
    const nav = recorder(sessions);
    nav.history.expect(isChat("b"), [chat("a")]);
    nav.history.dispose();
    nav.visit(chat("a"));
    expect(nav.history.history.entries).toEqual([sessions, chat("a")]);
  });
});
