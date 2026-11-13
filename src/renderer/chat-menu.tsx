import { AnchoredMenu } from "./anchored-menu.js";

export function ChatMenu({
  onAction,
  ...props
}: {
  x: number;
  y: number;
  onAction(action: "open" | "rename" | "archive"): void;
  onClose(): void;
}) {
  return (
    <AnchoredMenu
      {...props}
      label="Chat actions"
      items={(
        [
          ["open", "Open"],
          ["rename", "Rename"],
          ["archive", "Archive"],
        ] as const
      ).map(([action, label]) => ({ label, run: () => onAction(action) }))}
    />
  );
}
