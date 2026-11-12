import { type ComponentProps, cloneElement, type ReactElement, useId, useRef } from "react";
import type { FilePanel } from "./file-panel.js";

/** Mounted inspectors belong to open project instances, not the selected path. */
export function RetainedProjectPanels({
  id,
  liveIds,
  children,
}: {
  id: string;
  liveIds: readonly string[];
  children: ReactElement<ComponentProps<typeof FilePanel>>;
}) {
  const views = useRef(new Map<string, ReactElement<ComponentProps<typeof FilePanel>>>());
  const prefix = useId();
  views.current.set(id, children);
  const live = new Set(liveIds);
  for (const key of views.current.keys()) if (!live.has(key)) views.current.delete(key);
  return [...views.current].map(([key, view], index) => (
    <div key={key} className="retained-project-panel" hidden={key !== id} inert={key !== id}>
      {key === id
        ? view
        : cloneElement(view, { active: false, panelId: `${prefix}-files-${index}` })}
    </div>
  ));
}
