import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatScroll } from "./chat-scroll.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(initialResponse = 75) {
  let top = 0;
  let now = 0;
  let id = 0;
  let animated = true;
  let response = initialResponse;
  let layoutMoving = false;
  const frames = new Map<number, FrameRequestCallback>();
  const element = {
    scrollHeight: 1400,
    clientHeight: 400,
    clientWidth: 600,
    get scrollTop() {
      return top;
    },
    set scrollTop(value: number) {
      // Chromium rounds/clamps scroll offsets; the animation must still finish.
      top = Math.round(Math.max(0, Math.min(this.scrollHeight - this.clientHeight, value)));
    },
  };
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(performance, "now").mockImplementation(() => now);
  const position = { following: true, top: 0 };
  const controller = createChatScroll(
    element,
    position,
    () => animated,
    () => response,
    () => layoutMoving,
  );
  const advance = (elapsed = 16) => {
    now += elapsed;
    const pending = [...frames.values()];
    frames.clear();
    for (const frame of pending) frame(now);
    controller.onScroll();
  };
  const finish = () => {
    for (let index = 0; index < 100 && frames.size; index++) advance();
    expect(frames.size).toBe(0);
  };
  return {
    element,
    position,
    controller,
    frames,
    advance,
    finish,
    setResponse: (value: number) => {
      response = value;
    },
    setLayoutMoving: (value: boolean) => {
      layoutMoving = value;
    },
    reduce: () => {
      animated = false;
    },
  };
}

describe("main-chat smooth following", () => {
  it("keeps status anchored during already-smoothed message growth instead of applying a second lag", () => {
    const { element, controller, position, frames, advance, setLayoutMoving } = setup();
    controller.update(true);
    element.scrollHeight += 100;
    controller.update();
    expect(frames.size).toBe(1);
    setLayoutMoving(true);
    advance();
    expect(element.scrollTop).toBe(1100);
    expect(frames.size).toBe(0);
    for (const growth of [1, 8, 25, 60]) {
      element.scrollHeight += growth;
      controller.update();
      expect(element.scrollHeight - element.clientHeight - element.scrollTop).toBe(0);
      expect(frames.size).toBe(0);
    }
    controller.pause();
    element.scrollTop = 200;
    controller.onScroll();
    element.scrollHeight += 100;
    controller.update();
    expect(position.following).toBe(false);
    expect(element.scrollTop).toBe(200);
    setLayoutMoving(false);
    controller.resume();
    expect(frames.size).toBe(1);
    controller.dispose();
  });

  it("honors instant and 30-second response settings without rounding slow movement away", () => {
    const instant = setup(0);
    instant.controller.update();
    expect(instant.element.scrollTop).toBe(1000);
    expect(instant.frames.size).toBe(0);
    const slow = setup(30_000);
    slow.controller.update(true);
    slow.element.scrollHeight += 300;
    slow.controller.update();
    for (let index = 0; index < 4; index++) slow.advance();
    expect(slow.element.scrollTop).toBeGreaterThan(1000);
    expect(slow.element.scrollTop).toBeLessThan(1005);
    slow.setResponse(0);
    slow.controller.update();
    expect(slow.element.scrollTop).toBe(1300);
    expect(slow.frames.size).toBe(0);
  });

  it("cancels long dropdown reveals on manual input, disposal and stale details", () => {
    const { element, position, controller, frames, advance } = setup();
    controller.update(true);
    element.scrollHeight += 100;
    let valid = true;
    controller.reveal(1300, 30_000, () => valid);
    expect(element.scrollTop).toBe(1100);
    element.scrollHeight += 400;
    controller.update();
    advance();
    expect(element.scrollTop).toBe(1300);
    expect(position.following).toBe(false);
    controller.pause();
    expect(frames.size).toBe(0);
    controller.reveal(1300, 30_000, () => valid);
    valid = false;
    advance();
    expect(frames.size).toBe(0);
    valid = true;
    controller.reveal(1300, 30_000, () => valid);
    element.scrollTop = 1450;
    controller.onScroll();
    expect(position.following).toBe(true);
    expect(frames.size).toBe(1);
    controller.dispose();
    expect(frames.size).toBe(0);
  });

  it("restores history immediately, then eases growth without restarting on every chunk", () => {
    const { element, position, controller, advance, finish, frames } = setup();
    controller.update(true);
    expect(element.scrollTop).toBe(1000);
    element.scrollHeight += 300;
    controller.update();
    expect(element.scrollTop).toBe(1000);
    const firstFrame = [...frames.keys()];
    for (let index = 0; index < 20; index++) controller.update();
    expect([...frames.keys()]).toEqual(firstFrame);
    advance();
    expect(element.scrollTop).toBeGreaterThan(1000);
    expect(element.scrollTop).toBeLessThan(1300);
    expect(position.following).toBe(true);
    // Retarget the same loop during streaming, including a dropped/slow frame.
    element.scrollHeight += 500;
    controller.update();
    advance(120);
    expect(element.scrollTop).toBeLessThan(1800);
    finish();
    expect(element.scrollTop).toBe(1800);
    expect(position.top).toBe(1800);
  });

  it("handles content growth before the resize observer without snapping or losing follow", () => {
    const { element, position, controller, advance, finish } = setup();
    controller.update(true);
    element.scrollHeight += 300;
    controller.onScroll();
    expect(element.scrollTop).toBe(1000);
    advance();
    expect(position.following).toBe(true);
    finish();
    expect(element.scrollTop).toBe(1300);
  });

  it("upward input cancels an in-flight animation even inside the bottom threshold", () => {
    const { element, position, controller, frames, advance } = setup();
    controller.update(true);
    element.scrollHeight += 40;
    controller.update();
    advance();
    controller.pause();
    element.scrollTop -= 10;
    controller.onScroll();
    const reading = element.scrollTop;
    expect(position.following).toBe(false);
    expect(frames.size).toBe(0);
    element.scrollHeight += 200;
    controller.update();
    advance();
    expect(element.scrollTop).toBe(reading);
    // A new Send explicitly opts back into following.
    controller.resume();
    expect(position.following).toBe(true);
    expect(frames.size).toBe(1);
    controller.dispose();
    expect(frames.size).toBe(0);
  });

  it("preserves readers, allows manual dropdown reveal, and resumes on downward scrolling", () => {
    const { element, position, controller, finish } = setup();
    controller.update(true);
    element.scrollTop = 200;
    controller.onScroll();
    expect(position.following).toBe(false);
    element.scrollHeight += 200;
    controller.update();
    expect(element.scrollTop).toBe(200);
    // Dropdown reveal can move the viewport while its height is still changing.
    controller.reveal(300);
    controller.update();
    controller.onScroll();
    expect(position.top).toBe(300);
    element.scrollTop = 1150;
    controller.onScroll();
    expect(position.following).toBe(true);
    finish();
    expect(element.scrollTop).toBe(1200);
  });

  it("settles immediately for reduced motion or hidden documents, including mid-animation", () => {
    const { element, controller, reduce, advance, frames } = setup();
    controller.update();
    advance();
    reduce();
    advance();
    expect(element.scrollTop).toBe(1000);
    expect(frames.size).toBe(0);
    element.scrollHeight += 400;
    controller.update();
    expect(element.scrollTop).toBe(1400);
    expect(frames.size).toBe(0);
  });

  it("does not mistake activity reveal near the bottom for a request to follow", () => {
    const { element, position, controller } = setup();
    controller.update(true);
    controller.pause();
    element.scrollHeight += 100;
    controller.reveal(1040);
    controller.onScroll();
    expect(position.following).toBe(false);
    element.scrollHeight += 400;
    controller.update();
    expect(element.scrollTop).toBe(1040);
  });

  it("restores the saved reading position without animation and follows shrinking content", () => {
    const { element, position, controller, advance, finish, frames } = setup();
    position.following = false;
    position.top = 250;
    controller.update(true);
    expect(element.scrollTop).toBe(250);
    expect(frames.size).toBe(0);
    controller.resume();
    advance();
    element.scrollHeight = 700;
    controller.update();
    finish();
    expect(element.scrollTop).toBe(300);
    controller.pause();
    element.scrollTop = 300;
    controller.onScroll();
    controller.dispose();
  });

  it("releases follow for scrollbar movement during animation and tolerates already queued frames", () => {
    const { element, position, controller, advance, frames } = setup();
    controller.update();
    const queued = [...frames.values()][0];
    controller.pause();
    queued?.(16);
    expect(frames.size).toBe(0);
    controller.resume();
    advance();
    element.scrollTop = 50;
    controller.onScroll();
    expect(position.following).toBe(false);
    expect(frames.size).toBe(0);
  });
});
