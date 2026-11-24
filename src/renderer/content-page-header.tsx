import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DropdownMenu } from "./carbon/dropdown-menu.js";

export interface PageAction {
  id: string;
  label: string;
  disabled?: boolean | undefined;
  reason?: string | undefined;
  checked?: boolean;
  describedBy?: string;
  run(): void;
}

interface HeaderOwner {
  target: HTMLElement | null;
  disabled: boolean;
}
const emptyOwner: HeaderOwner = { target: null, disabled: false };

function headerOwner(element: HTMLElement): HeaderOwner {
  if (element.parentElement?.closest('[hidden], [inert]:not([data-navigation-pending="true"])'))
    return emptyOwner;
  const card = element.closest(".chat-conversations, .page-panel");
  return {
    target: card?.querySelector<HTMLElement>(":scope > .content-page-header-slot") ?? null,
    disabled: !!element.closest("fieldset:disabled"),
  };
}

/** Retained views publish only into their own card and release it before paint. */
export function observeContentHeader(element: HTMLElement, publish: (owner: HeaderOwner) => void) {
  let disposed = false;
  const update = () => {
    if (!disposed) publish(headerOwner(element));
  };
  const observer = new MutationObserver(update);
  for (let parent = element.parentElement; parent; parent = parent.parentElement)
    observer.observe(parent, {
      attributes: true,
      attributeFilter: ["hidden", "inert", "disabled"],
    });
  update();
  return () => {
    disposed = true;
    observer.disconnect();
  };
}

function useContentHeader(source: RefObject<HTMLElement | null>, enabled: boolean) {
  const [owner, setOwner] = useState(emptyOwner);
  const publish = useCallback(
    (next: HeaderOwner) =>
      setOwner((previous) =>
        previous.target === next.target && previous.disabled === next.disabled ? previous : next,
      ),
    [],
  );
  useLayoutEffect(() => {
    if (!enabled || !source.current) {
      publish(emptyOwner);
      return;
    }
    return observeContentHeader(source.current, publish);
  }, [source, enabled, publish]);
  useLayoutEffect(() => {
    publish(enabled && source.current ? headerOwner(source.current) : emptyOwner);
  });
  return owner;
}

export function ContentHeaderSlot({ fallback }: { fallback?: string }) {
  return (
    <div className="content-page-header-slot">
      {fallback && (
        <header className="content-page-heading content-page-header-fallback">
          <h1 className="content-page-title">
            <span className="page-title-text">{fallback}</span>
          </h1>
        </header>
      )}
    </div>
  );
}

export function ContentPageHeader({
  title,
  id,
  as: Heading = "h2",
  ownerKey,
  actions = [],
  triggerRef,
  portal,
  pending = false,
}: {
  title: string;
  id?: string | undefined;
  as?: "h1" | "h2";
  ownerKey: string;
  actions?: readonly PageAction[] | undefined;
  triggerRef?: RefObject<HTMLButtonElement | null> | undefined;
  portal: boolean | undefined;
  pending?: boolean | undefined;
}) {
  const source = useRef<HTMLSpanElement>(null);
  const owner = useContentHeader(source, portal === true);
  const active = portal === undefined || !!owner.target;
  const content = (
    <header className="content-page-heading" inert={pending || undefined}>
      <Heading id={id} className="content-page-title">
        <span className="page-title-text">{title}</span>
      </Heading>
      {actions.length > 0 && (
        <DropdownMenu
          key={ownerKey}
          label={`${title} actions`}
          iconOnly
          active={active && !pending}
          disabled={false}
          triggerRef={triggerRef}
          items={actions.map((action) => ({
            ...action,
            disabled: owner.disabled || action.disabled,
            reason: owner.disabled ? "Connect to a database first" : action.reason,
          }))}
        />
      )}
    </header>
  );
  return (
    <>
      <span ref={source} hidden aria-hidden="true" />
      {portal === undefined ? content : owner.target ? createPortal(content, owner.target) : null}
    </>
  );
}
