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
