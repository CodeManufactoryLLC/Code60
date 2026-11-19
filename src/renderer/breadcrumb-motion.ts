interface Item {
  appearance: string;
  node: HTMLElement;
  copy: HTMLElement;
  rect: DOMRect;
  animation?: Animation;
  dx: number;
  dy: number;
  entering?: boolean;
}

/** Retain appearance across authority changes, without retaining any old controls. */
export function matchBreadcrumbItems(
  previous: ReadonlyMap<string, { appearance: string }>,
  next: ReadonlyMap<string, { appearance: string }>,
): Map<string, string> {
  const matches = new Map<string, string>();
  const used = new Set<string>();
  // Reserve exact identities first, so an identical-looking sibling cannot steal one.
  for (const key of next.keys()) {
    if (previous.has(key)) {
      matches.set(key, key);
      used.add(key);
    }
  }
  for (const [key, item] of next) {
    if (matches.has(key)) continue;
    const before = [...previous].find(
      ([oldKey, old]) => !used.has(oldKey) && old.appearance === item.appearance,
    );
    if (before) {
      matches.set(key, before[0]);
      used.add(before[0]);
    }
  }
  return matches;
}

/** Presentation only: the new trail is immediately authoritative; exits are inert snapshots. */
export function observeBreadcrumbMotion(card: HTMLElement): () => void {
  const media = window.matchMedia("(prefers-reduced-motion: reduce), (forced-colors: active)");
  const selector = ":scope > nav:not(.breadcrumb-exit) > ol > [data-breadcrumb-key]";
  let previous = new Map<string, Item>();
  let signature = "";
  let width = card.getBoundingClientRect().width;
  let height = card.getBoundingClientRect().height;
  let disposed = false;
  let heightAnimation: Animation | undefined;
  const cleanups = new Set<() => void>();
  const unavailable = () => media.matches || document.visibilityState !== "visible";
  const heightMoving = () =>
    heightAnimation?.playState === "running" || heightAnimation?.playState === "paused";
  const reset = () => {
    for (const cleanup of [...cleanups]) cleanup();
  };
  const snapshot = (): Map<string, Item> =>
    new Map(
      [...card.querySelectorAll<HTMLElement>(selector)].map((node) => [
        node.dataset.breadcrumbKey ?? "",
        {
          appearance: JSON.stringify([
            node.textContent,
            [...node.querySelectorAll<HTMLElement>("[data-icon]")].map((icon) => icon.dataset.icon),
            node.getAttribute("aria-current"),
          ]),
          node,
          copy: node.cloneNode(true) as HTMLElement,
          rect: node.getBoundingClientRect(),
          dx: 0,
          dy: 0,
        },
      ]),
    );
  const animate = (
    node: HTMLElement,
    frames: Keyframe[],
    options: KeyframeAnimationOptions,
    done = () => {},
  ) => {
    const animation = node.animate(frames, options);
    const cleanup = () => {
      animation.onfinish = null;
      animation.cancel();
      node.removeAttribute("data-breadcrumb-transition");
      cleanups.delete(cleanup);
      done();
    };
    cleanups.add(cleanup);
    animation.onfinish = cleanup;
    return animation;
  };
  const update = () => {
    if (disposed) return;
    const nodes = [...card.querySelectorAll<HTMLElement>(selector)];
    // A portal handoff can remove the old trail before publishing its replacement
    // in the same paint. Keep its geometry until the destination is available.
    if (!nodes.length) return;
    const nextSignature = nodes
      .map(
        (node) =>
          `${node.dataset.breadcrumbKey}:${node.textContent}:${node.getAttribute("aria-current")}`,
      )
      .join("|");
    if (nextSignature === signature) return;
    signature = nextSignature;
    const opacities = new Map<string, number>();
    const positions = new Map(
      [...previous].map(([key, item]) => {
        const progress = Number(item.animation?.effect?.getComputedTiming().progress ?? 1);
        opacities.set(
          key,
          item.node.isConnected
            ? Number(getComputedStyle(item.node).opacity)
            : item.entering
              ? progress
              : 1,
        );
        return [
          key,
          item.node.isConnected
            ? item.node.getBoundingClientRect()
            : ({
                ...item.rect.toJSON(),
                left: item.rect.left + item.dx * (1 - progress),
                top: item.rect.top + item.dy * (1 - progress),
              } as DOMRect),
        ] as const;
      }),
    );
    const oldHeight = heightMoving() ? card.getBoundingClientRect().height : height;
    reset();
    const next = snapshot();
    const matches = matchBreadcrumbItems(previous, next);
    const retained = new Set(matches.values());
    const bounds = card.getBoundingClientRect();
    const style = getComputedStyle(card);
    const time = style.getPropertyValue("--motion").trim();
    const duration = Number.parseFloat(time) * (time.endsWith("ms") ? 1 : 1000);
    if (
      previous.size &&
      next.size &&
      !unavailable() &&
      typeof card.animate === "function" &&
      duration > 0 &&
      Number.isFinite(duration)
    ) {
      const options = { duration, easing: style.getPropertyValue("--ease").trim() || "ease-out" };
      for (const [key, item] of next) {
        const oldKey = matches.get(key);
        const before = oldKey === undefined ? undefined : positions.get(oldKey);
        const opacity = oldKey === undefined ? 0 : (opacities.get(oldKey) ?? 1);
        item.dx = before ? before.left - item.rect.left : -6;
        item.dy = before ? before.top - item.rect.top : 0;
        if (!before || Math.abs(item.dx) > 0.5 || Math.abs(item.dy) > 0.5 || opacity < 1) {
          item.entering = !before;
          item.node.dataset.breadcrumbTransition = before ? "move" : "enter";
          item.animation = animate(
            item.node,
            [
              { translate: `${item.dx}px ${item.dy}px`, opacity },
              { translate: "0px 0px", opacity: 1 },
            ],
            options,
          );
        }
      }
      for (const [key, item] of previous) {
        if (retained.has(key)) continue;
        const rect = positions.get(key) ?? item.rect;
        const ghost = document.createElement("nav");
        ghost.className = "page-breadcrumbs breadcrumb-exit";
        ghost.setAttribute("aria-hidden", "true");
        ghost.inert = true;
        const list = document.createElement("ol");
        list.append(item.copy);
        ghost.append(list);
        for (const element of ghost.querySelectorAll("*")) {
          element.removeAttribute("id");
          element.removeAttribute("aria-current");
          element.removeAttribute("data-breadcrumb-key");
          if (element.matches("h1, h2")) {
            const span = document.createElement("span");
            span.className = element.className;
            span.append(...element.childNodes);
            element.replaceWith(span);
          }
        }
        Object.assign(ghost.style, {
          left: `${rect.left - bounds.left - card.clientLeft + card.scrollLeft}px`,
          top: `${rect.top - bounds.top - card.clientTop + card.scrollTop}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        });
        card.append(ghost);
        animate(
          ghost,
          [
            { opacity: opacities.get(key) ?? 1, translate: "0px 0px" },
            { opacity: 0, translate: "6px 0px" },
          ],
          options,
          () => ghost.remove(),
        );
      }
      if (Math.abs(oldHeight - bounds.height) > 0.5) {
        card.dataset.breadcrumbHeightMotion = "true";
        heightAnimation = animate(
          card,
          [{ height: `${oldHeight}px` }, { height: `${bounds.height}px` }],
          options,
          () => card.removeAttribute("data-breadcrumb-height-motion"),
        );
      }
    }
    previous = next;
    width = bounds.width;
    height = bounds.height;
  };
  const onMutation = (records: MutationRecord[]) => {
    if (
      records.every(
        (record) =>
          (record.target as Element).closest?.(".breadcrumb-exit") ||
          (record.type === "childList" &&
            [...record.addedNodes, ...record.removedNodes].every(
              (node) => node instanceof Element && node.matches(".breadcrumb-exit"),
            )),
      )
    )
      return;
    // Mutation delivery precedes paint. Deferring this to an animation frame can
    // paint the destination at full opacity/height, then rewind it on the next frame.
    update();
  };
  const mutations = new MutationObserver(onMutation);
  mutations.observe(card, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["data-breadcrumb-key", "aria-current"],
  });
  const settle = () => {
    reset();
    previous = snapshot();
    height = card.getBoundingClientRect().height;
  };
  const resize = new ResizeObserver(() => {
    const nextWidth = card.getBoundingClientRect().width;
    if (Math.abs(nextWidth - width) >= 0.5) {
      width = nextWidth;
      settle();
    } else if (!heightMoving()) {
      const nextHeight = card.getBoundingClientRect().height;
      if (Math.abs(nextHeight - height) >= 0.5) settle();
    }
  });
  resize.observe(card);
  media.addEventListener("change", settle);
  document.addEventListener("visibilitychange", settle);
  update();
  return () => {
    disposed = true;
    mutations.disconnect();
    resize.disconnect();
    media.removeEventListener("change", settle);
    document.removeEventListener("visibilitychange", settle);
    reset();
    previous.clear();
  };
}
