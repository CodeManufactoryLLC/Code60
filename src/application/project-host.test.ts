import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { ProjectHost } from "./project-host.js";

describe("ProjectHost", () => {
  it("retains independent runtimes across navigation and captures async work", async () => {
    const host = new ProjectHost(() => ({ count: 0 }));
    const a = host.open("/a");
    const b = host.open("/b");
    host.select(a);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = host.run(a, async () => {
      await gate;
      host.current.state.count++;
      return host.current.id;
    });
    host.select(b);
    release();
    expect(await pending).toBe(a.id);
    expect(host.current).toBe(b);
    expect(a.state.count).toBe(1);
    expect(b.state.count).toBe(0);
    expect(host.open("/a")).toBe(a);
  });

  it("binds emitted callbacks to their owner and ignores disposed callbacks", () => {
    const host = new ProjectHost(() => ({ count: 0 }));
    const a = host.open("/a");
    const b = host.open("/b");
    const emitter = new EventEmitter();
    host.run(a, () =>
      emitter.on(
        "event",
        host.bind(() => {
          host.current.state.count++;
        }),
      ),
    );
    host.select(b);
    emitter.emit("event");
    expect(a.state.count).toBe(1);
    expect(b.state.count).toBe(0);
    host.remove(a);
    emitter.emit("event");
    expect(a.state.count).toBe(1);
    const reopened = host.open("/a");
    expect(reopened.id).not.toBe(a.id);
    expect(() => host.assertCurrent(a)).toThrow("no longer open");
  });

  it("revokes database instances even when a path is reopened", () => {
    const host = new ProjectHost(() => ({}));
    const a = host.open("/a");
    const fallback = host.fallback;
    host.replaceDatabase();
    expect(host.databaseEpoch).toBe(1);
    expect(() => host.assertCurrent(a)).toThrow("no longer open");
    expect(() => host.assertCurrent(fallback)).toThrow("no longer open");
    expect(host.open("/a").id).not.toBe(a.id);
    expect(host.all()).toHaveLength(2);
  });
});
