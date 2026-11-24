import { useEffect, useRef, useState } from "react";
import { Button as AppButton } from "./carbon/button.js";
import { fileLanguage, monaco, useMonacoTheme } from "./monaco-runtime.js";
import { monospaceFont } from "./typography.js";

const views = new Map<string, monaco.editor.IDiffEditorViewState>();
export default function MonacoDiff({
  original,
  modified,
  path,
  address,
  onAddToChat,
  originalLabel = "Original review version",
  modifiedLabel = "Modified review version",
}: {
  originalLabel?: string;
  modifiedLabel?: string;
  original: string;
  modified: string;
  path: string;
  address: string;
  onAddToChat?:
    | ((selection: { side: "original" | "modified"; start: number; end: number }) => void)
    | undefined;
}) {
  useMonacoTheme();
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const currentAddress = useRef(address);
  const [height, setHeight] = useState(240);
  const [selection, setSelection] = useState<{
    address: string;
    side: "original" | "modified";
    start: number;
    end: number;
  }>();
  useEffect(() => {
    if (!container.current) return;
    const instance = monaco.editor.createDiffEditor(container.current, {
      readOnly: true,
      domReadOnly: true,
      editContext: false,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: false,
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: monospaceFont,
      diffWordWrap: "on",
      scrollBeyondLastLine: false,
      links: false,
      contextmenu: false,
      stickyScroll: { enabled: false },
      originalAriaLabel: originalLabel,
      modifiedAriaLabel: modifiedLabel,
    });
    editor.current = instance;
    const selections = (["original", "modified"] as const).map((side) => {
      const source =
        side === "original" ? instance.getOriginalEditor() : instance.getModifiedEditor();
      return source.onDidChangeCursorSelection((event) => {
        const range = event.selection;
        setSelection(
          range.isEmpty()
            ? undefined
            : {
                address: currentAddress.current,
                side,
                start: range.startLineNumber,
                end:
                  range.endColumn === 1 && range.endLineNumber > range.startLineNumber
                    ? range.endLineNumber - 1
                    : range.endLineNumber,
              },
        );
      });
    });
    instance.getOriginalEditor().updateOptions({ ariaLabel: originalLabel });
    instance.getModifiedEditor().updateOptions({ ariaLabel: modifiedLabel });
    const size = instance
      .getModifiedEditor()
      .onDidContentSizeChange((event) =>
        setHeight(Math.max(160, Math.min(480, event.contentHeight + 20))),
      );
    return () => {
      size.dispose();
      for (const listener of selections) listener.dispose();
      const view = instance.saveViewState();
      if (view) views.set(currentAddress.current, view);
      instance.dispose();
      editor.current = null;
    };
  }, [originalLabel, modifiedLabel]);
  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    const before = monaco.editor.createModel(original, fileLanguage(path));
    const after = monaco.editor.createModel(modified, fileLanguage(path));
    instance.setModel({ original: before, modified: after });
    currentAddress.current = address;
    const view = views.get(address);
    if (view) instance.restoreViewState(view);
    return () => {
      if (editor.current === instance) {
        const view = instance.saveViewState();
        if (view) views.set(address, view);
        instance.setModel(null);
      }
      if (views.size > 200) views.delete(views.keys().next().value ?? "");
      before.dispose();
      after.dispose();
    };
  }, [address, original, modified, path]);
  return (
    <>
      {onAddToChat && selection?.address === address && (
        <div className="diff-selection-actions">
          <AppButton
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onAddToChat(selection)}
          >
            Add to chat
          </AppButton>
          <span>
            {selection.side} lines {selection.start}-{selection.end}
          </span>
        </div>
      )}
      <div className="review-diff-editor" style={{ height }} ref={container} />
    </>
  );
}
