/** Follow the visible conversation column, including live file-panel resizing. */
export function observeBreadcrumbRightInset(body: HTMLElement): () => void {
  const workspace = body.closest<HTMLElement>(".app-workspace");
  const conversations = body.querySelector<HTMLElement>(".chat-conversations");
  if (!workspace || !conversations) return () => {};
  const property = "--breadcrumb-right-inset";
  const riseProperty = "--right-panel-rise";
  const heightProperty = "--breadcrumb-card-height";
  const header = workspace.querySelector<HTMLElement>(".workspace-header");
  let disposed = false;
  const update = () => {
    if (disposed) return;
    const bounds = workspace
      .querySelector<HTMLElement>(".workspace-header")
      ?.getBoundingClientRect();
    const inset = bounds
      ? Math.max(
          0,
          Math.min(bounds.width, bounds.right - conversations.getBoundingClientRect().right),
        )
      : 0;
    const value = `${inset}px`;
    if (workspace.style.getPropertyValue(property) !== value)
      workspace.style.setProperty(property, value);
    const card = workspace.querySelector<HTMLElement>(".workspace-breadcrumbs");
    const heightValue = `${card?.getBoundingClientRect().height ?? 58}px`;
    if (workspace.style.getPropertyValue(heightProperty) !== heightValue)
      workspace.style.setProperty(heightProperty, heightValue);
    const rise = card
      ? Math.max(0, body.getBoundingClientRect().top - card.getBoundingClientRect().top)
      : 0;
    const riseValue = `${rise}px`;
    if (workspace.style.getPropertyValue(riseProperty) !== riseValue)
      workspace.style.setProperty(riseProperty, riseValue);
  };
  const observer = new ResizeObserver(update);
  observer.observe(conversations);
  observer.observe(workspace);
  if (header) observer.observe(header);
  update();
  return () => {
    disposed = true;
    observer.disconnect();
    workspace.style.removeProperty(property);
    workspace.style.removeProperty(riseProperty);
    workspace.style.removeProperty(heightProperty);
  };
}
