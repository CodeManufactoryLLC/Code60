import type { WindowControl } from "../bridge/index.js";
import { Icon } from "./icons.js";

/** Electron omits native caption buttons on transparent Linux windows. */
export function WindowControls({ onAction }: { onAction(action: WindowControl): void }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: window actions are not form fields.
    <div className="window-controls" role="group" aria-label="Window controls">
      <button
        type="button"
        className="icon-button"
        aria-label="Minimize window"
        onClick={() => onAction("minimize")}
      >
        <Icon name="subtract" />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Maximize or restore window"
        onClick={() => onAction("maximize")}
      >
        <Icon name="maximize" />
      </button>
      <button
        type="button"
        className="icon-button window-close"
        aria-label="Close window"
        onClick={() => onAction("close")}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
