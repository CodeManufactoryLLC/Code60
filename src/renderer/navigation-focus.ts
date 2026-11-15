/** Wait for nested layout effects to reveal the destination, not for another frame. */
export function focusNavigation(
  id: string,
  root: Pick<Document, "getElementById" | "activeElement"> = document,
) {
  let current = true;
  queueMicrotask(() => {
    if (current && !root.activeElement?.closest('dialog[open], [role="menu"]'))
      root.getElementById(id)?.focus();
  });
  return () => {
    current = false;
  };
}
