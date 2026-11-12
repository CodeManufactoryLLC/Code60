import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatMessageLayout, createMessageLayout } from "./chat-message-layout.js";

afterEach(() => vi.unstubAllGlobals());

function setup(incoming = true, motion = true) {
  const bounds = { width: 600, height: 100 };
  const reads: number[] = [];
  let resized = () => {};
  const disconnect = vi.fn();
  const listeners = new Map<string, EventListener>();
  const element = {
    style: { height: "auto" },
    dataset: {} as Record<string, string>,
    getBoundingClientRect() {
      const height = Number.parseFloat(this.style.height);
      reads.push(height);
      return { height, width: 600 };
    },
    addEventListener(name: string, listener: EventListener) {
      listeners.set(name, listener);
    },
    removeEventListener(name: string) {
      listeners.delete(name);
    },
  };
  const content = { getBoundingClientRect: () => bounds };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resized = () =>
          callback(
            [{ contentRect: bounds } as unknown as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const layout = createMessageLayout(
    element as unknown as HTMLElement,
    content as HTMLElement,
    incoming,
    () => motion,
  );
  return {
    element,
    bounds,
    reads,
    layout,
    disconnect,
    listeners,
    resize: () => resized(),
  };
}

describe("message space and status-row motion", () => {
  it("establishes zero occupied height before a fresh message grows, without translating the status", () => {
    const { element, reads, bounds, resize, listeners } = setup();
    expect(reads).toEqual([0]);
    expect(element.style.height).toBe("100px");
    expect(element.dataset.layoutAnimating).toBe("true");
    expect(element.dataset.layoutImmediate).toBe("false");
    bounds.height = 180;
    resize();
    expect(element.style.height).toBe("180px");
    expect(element.dataset.layoutAnimating).toBe("true");
    listeners.get("transitionend")?.({
      target: element,
      propertyName: "height",
    } as unknown as Event);
    expect(element.dataset.layoutAnimating).toBeUndefined();
  });

  it("does not replay history but smooths later streamed growth in that same message", () => {
    const { element, reads, bounds, resize } = setup(false);
    expect(reads).toEqual([]);
    expect(element.dataset.layoutAnimating).toBeUndefined();
    expect(element.dataset.layoutImmediate).toBe("true");
    resize();
    expect(element.dataset.layoutAnimating).toBeUndefined();
    bounds.height = 240;
    resize();
    expect(element.style.height).toBe("240px");
    expect(element.dataset.layoutAnimating).toBe("true");
  });

  it("skips disabled motion and settles immediately on width reflow or visibility changes", () => {
    const reduced = setup(true, false);
    expect(reduced.reads).toEqual([]);
    expect(reduced.element.dataset.layoutAnimating).toBeUndefined();
    reduced.bounds.height = 200;
    reduced.resize();
    expect(reduced.element.style.height).toBe("200px");
    expect(reduced.element.dataset.layoutImmediate).toBe("true");
    const normal = setup();
    normal.bounds.width = 400;
    normal.bounds.height = 250;
    normal.resize();
    expect(normal.element.dataset.layoutAnimating).toBeUndefined();
    expect(normal.element.style.height).toBe("250px");
    normal.bounds.height = 280;
    normal.resize();
    expect(normal.element.dataset.layoutAnimating).toBe("true");
    normal.layout.settle();
    expect(normal.element.dataset.layoutAnimating).toBeUndefined();
    expect(normal.element.dataset.layoutImmediate).toBe("true");
    normal.layout.dispose();
    expect(normal.element.style.height).toBe("auto");
    expect(normal.listeners.size).toBe(0);
    expect(normal.disconnect).toHaveBeenCalledOnce();
  });

  it("keeps complete source in semantic articles without wrapping activity details", () => {
    const html = renderToStaticMarkup(
      <ChatMessageLayout incoming={false} active>
        <article aria-label="Assistant">Exact message text</article>
      </ChatMessageLayout>,
    );
    expect(html).toContain('class="chat-message-layout"');
    expect(html).toContain('<article aria-label="Assistant">Exact message text</article>');
  });
});
