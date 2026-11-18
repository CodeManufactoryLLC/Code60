export function observeSidebarCardEdges(sidebar: HTMLElement) {
  const rowSelector =
    ".page-tab, .chat-sidebar-row, .project-chat-heading, .chat-page-heading, .sidebar-settings-heading, .project-sidebar-open, .project-session-new";
  const update = () => {
    for (const card of sidebar.querySelectorAll(".sidebar-navigation-card")) {
      for (const previous of card.querySelectorAll("[data-card-first], [data-card-last]")) {
        previous.removeAttribute("data-card-first");
        previous.removeAttribute("data-card-last");
      }
      const rows = [...card.querySelectorAll(rowSelector)].filter(
        (row) => !row.closest("[hidden]") && !row.parentElement?.closest(rowSelector),
      );
      rows[0]?.setAttribute("data-card-first", "");
      rows.at(-1)?.setAttribute("data-card-last", "");
    }
  };
  update();
  const observer = new MutationObserver(update);
  observer.observe(sidebar, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });
  return () => {
    observer.disconnect();
    for (const row of sidebar.querySelectorAll("[data-card-first], [data-card-last]")) {
      row.removeAttribute("data-card-first");
      row.removeAttribute("data-card-last");
    }
  };
}

export function observeWorkspaceInset(workspace: HTMLElement, notice: Element | null) {
  const app = workspace.parentElement;
  const property = "--workspace-top-inset";
  const update = () => {
    const top = Math.max(
      0,
      workspace.getBoundingClientRect().top - (app?.getBoundingClientRect().top ?? 0),
    );
    const value = `${top}px`;
    if (workspace.style.getPropertyValue(property) !== value)
      workspace.style.setProperty(property, value);
  };
  update();
  const observer = new ResizeObserver(update);
  observer.observe(workspace);
  if (app) observer.observe(app);
  const strip = app?.querySelector(":scope > .window-drag-strip");
  if (strip) observer.observe(strip);
  if (notice) observer.observe(notice);
  return () => {
    observer.disconnect();
    workspace.style.removeProperty(property);
  };
}
