/** Wait for nested layout effects to reveal the destination, not for another frame. */
export function focusNavigation(
  id: string,
  root: Pick<Document, "getElementById" | "activeElement"> = document,
) {
  let current = true;
  const previous = root.activeElement;
  queueMicrotask(() => {
    const active = root.activeElement;
    if (
      !current ||
      (active !== previous && active?.tagName !== "BODY") ||
      active?.closest('dialog[open], [role="menu"]')
    )
      return;
    // Search matches and composers can deliberately focus the new page in a child layout effect.
    if (active?.closest(".page-panel") && !active.closest("[hidden], [inert]")) return;
    const target = root.getElementById(id);
    if (target !== active) target?.focus();
  });
  return () => {
    current = false;
  };
}
