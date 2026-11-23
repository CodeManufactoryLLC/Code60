import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { DetailPayload, DetailRequest } from "../bridge/index.js";
import { DetailSubscriptions } from "./detail-subscriptions.js";

const request = (): DetailRequest => ({
  subscriptionId: randomUUID(),
  scope: { kind: "project", projectId: randomUUID(), databaseEpoch: 1 },
});
const payload = (name = "A"): DetailPayload => ({
  kind: "target",
  targetId: randomUUID(),
  cwd: name,
  runs: [],
  events: [],
});
describe("detail subscription ownership", () => {
  it("reads only changed owners, preserves predecessor fences and still closes unchanged invalid owners", () => {
    const details = new DetailSubscriptions();
    let aVersion = 1;
    let bVersion = 1;
    let aAlive = true;
    const a = request();
    const b = request();
    const aRead = vi.fn(() => payload("A"));
    const bRead = vi.fn(() => payload("B"));
    const aEmit = vi.fn();
    const bEmit = vi.fn();
    details.subscribe(a, 1, {
      valid() {
        if (!aAlive) throw new Error("Closed");
      },
      version: () => aVersion,
      read: aRead,
      emit: aEmit,
    });
    details.subscribe(b, 1, { valid() {}, version: () => bVersion, read: bRead, emit: bEmit });
    details.read(a, 2);
    aRead.mockClear();
    details.publish(3);
    expect(details.revisions()).toEqual({ [a.subscriptionId]: 1, [b.subscriptionId]: 1 });
    expect(aRead).not.toHaveBeenCalled();
    expect(bRead).not.toHaveBeenCalled();
    bVersion++;
    details.publish(4);
    expect(details.revisions()).toEqual({ [a.subscriptionId]: 1, [b.subscriptionId]: 4 });
    expect(aRead).not.toHaveBeenCalled();
    expect(bEmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ revision: 4, previousRevision: 1 }),
    );
    aVersion++;
    details.publish(7);
    expect(aEmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ revision: 7, previousRevision: 1 }),
    );
    expect(bRead).toHaveBeenCalledOnce();
    aAlive = false;
    details.publish(9);
    expect(details.revisions()).toEqual({ [b.subscriptionId]: 4 });
    expect(aEmit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        revision: 9,
        previousRevision: 7,
        closed: true,
      }),
    );
    expect(aRead).toHaveBeenCalledOnce();
  });
  it("releases every registration even when a cleanup callback fails", () => {
    const released = vi.fn(() => {
      throw new Error("Failed cleanup");
    });
    const details = new DetailSubscriptions(released);
    const addresses = [request(), request(), request()];
    for (const address of addresses)
      details.subscribe(address, 1, { valid() {}, read: () => payload(), emit() {} });
    expect(() => details.clear()).not.toThrow();
    expect(released).toHaveBeenCalledTimes(3);
    for (const address of addresses)
      expect(() => details.capture(address.subscriptionId)).toThrow("no longer available");
  });
  it("invalidates captured lifetimes on release, terminal closure and reuse of the same UUID", () => {
    const released = vi.fn();
    const details = new DetailSubscriptions(released);
    const address = request();
    const source = { valid() {}, read: () => payload(), emit() {} };
    expect(() => details.capture(address.subscriptionId)).toThrow("no longer available");
    details.subscribe(address, 1, source);
    const captured = details.capture(address.subscriptionId);
    expect(captured.scope).toEqual(address.scope);
    captured.valid();
    details.unsubscribe(address.subscriptionId);
    expect(released).toHaveBeenCalledExactlyOnceWith(address.subscriptionId);
    details.subscribe(address, 2, source);
    expect(() => captured.valid()).toThrow("no longer available");
    const second = details.capture(address.subscriptionId);
    details.clear();
    expect(() => second.valid()).toThrow("no longer available");
    expect(released).toHaveBeenCalledTimes(2);
  });
  it("preserves the registered source and sequences full reads separately from broadcasts", () => {
    const details = new DetailSubscriptions();
    const address = request();
    const read = vi.fn(() => payload("A"));
    const emit = vi.fn();
    details.subscribe(address, 2, { valid() {}, read, emit });
    if (address.scope.kind !== "project") throw new Error("fixture");
    const reordered = {
      ...address,
      scope: {
        databaseEpoch: address.scope.databaseEpoch,
        projectId: address.scope.projectId,
        kind: "project" as const,
      },
    };
    details.subscribe(reordered, 2, { valid() {}, read: () => payload("replacement"), emit });
    expect(details.read(reordered, 3)).toMatchObject({ payload: { cwd: "A" } });
    expect(details.read(address, 4)).toMatchObject({
      ...address,
      revision: 4,
      previousRevision: null,
      closed: false,
      payload: { cwd: "A" },
    });
    expect(read).toHaveBeenLastCalledWith(true);
    details.publish(5);
    details.publish(5);
    details.publish(8);
    expect(emit.mock.calls.map(([frame]) => [frame.revision, frame.previousRevision])).toEqual([
      [5, 2],
      [8, 5],
    ]);
    expect(read).toHaveBeenLastCalledWith(false);
    const changed = { ...address, scope: { ...address.scope, projectId: randomUUID() } };
    expect(() => details.read(changed, 9)).toThrow("no longer available");
    expect(() => details.subscribe(changed, 9, { valid() {}, read, emit })).toThrow(
      "another owner",
    );
  });

  it("emits a terminal frame for an obsolete generation without reading a replacement", () => {
    const details = new DetailSubscriptions();
    const address = request();
    let alive = true;
    const valid = () => {
      if (!alive) throw new Error("closed");
    };
    const read = vi.fn(() => payload());
    const emit = vi.fn();
    details.subscribe(address, 1, { valid, read, emit });
    alive = false;
    details.publish(3);
    expect(emit).toHaveBeenCalledExactlyOnceWith({
      ...address,
      revision: 3,
      previousRevision: 1,
      closed: true,
    });
    expect(read).not.toHaveBeenCalled();
    expect(() => details.read(address, 3)).toThrow("no longer available");
  });

  it("bounds subscriptions at 128 and releases slots on unsubscribe and clear", () => {
    const details = new DetailSubscriptions();
    const first = request();
    const source = { valid() {}, read: () => payload(), emit() {} };
    details.subscribe(first, 1, source);
    details.subscribe(first, 1, source);
    for (let count = 1; count < 128; count++) details.subscribe(request(), 1, source);
    expect(() => details.subscribe(request(), 1, source)).toThrow("Too many");
    details.unsubscribe(first.subscriptionId);
    details.subscribe(request(), 1, source);
    details.clear();
    expect(() => details.read(first, 2)).toThrow("no longer available");
    details.subscribe(first, 3, source);
    details.clear();
    details.publish(4);
  });

  it("isolates failed listeners and rechecks ownership after reading", () => {
    const details = new DetailSubscriptions();
    const bad = request();
    const good = request();
    const goodListener = vi.fn();
    details.subscribe(bad, 1, {
      valid() {},
      read: () => payload(),
      emit() {
        throw new Error("gone");
      },
    });
    details.subscribe(good, 1, { valid() {}, read: () => payload(), emit: goodListener });
    details.publish(2);
    expect(goodListener).toHaveBeenCalledTimes(1);
    expect(() => details.read(bad, 2)).toThrow("no longer available");
    let alive = true;
    const address = request();
    details.subscribe(address, 2, {
      valid() {
        if (!alive) throw new Error("closed during read");
      },
      read() {
        alive = false;
        return payload();
      },
      emit() {},
    });
    expect(() => details.read(address, 3)).toThrow("closed during read");
  });
});
