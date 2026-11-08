import { useEffect, useRef, useState } from "react";
import { fileLanguage, monaco, useMonacoTheme } from "./monaco-runtime.js";
import { monospaceFont } from "./state.js";

const views = new Map<string, monaco.editor.IDiffEditorViewState>();
export default function MonacoDiff({
  original,
  modified,
  path,
  address,
  onSelection,
  reveal,
}: {
  original: string;
  modified: string;
  path: string;
  address: string;
  reveal?: { side: "original" | "modified"; start: number; end: number } | undefined;
  onSelection(side: "original" | "modified", start: number, end: number): void;
}) {
  useMonacoTheme();
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const currentAddress = useRef(address);
  const callback = useRef(onSelection);
  callback.current = onSelection;
  const [sideBySide, setSideBySide] = useState(false);
  const [height, setHeight] = useState(240);
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
      originalAriaLabel: "Original review version",
      modifiedAriaLabel: "Modified review version",
    });
    editor.current = instance;
    const size = instance
      .getModifiedEditor()
      .onDidContentSizeChange((event) =>
        setHeight(Math.max(160, Math.min(480, event.contentHeight + 20))),
      );
    const subscriptions = (["original", "modified"] as const).map((side) => {
      const code =
        side === "original" ? instance.getOriginalEditor() : instance.getModifiedEditor();
      return code.onDidChangeCursorSelection((event) => {
        if (code.hasTextFocus())
          callback.current(side, event.selection.startLineNumber, event.selection.endLineNumber);
      });
    });
    return () => {
      for (const subscription of subscriptions) subscription.dispose();
      size.dispose();
      const view = instance.saveViewState();
      if (view) views.set(currentAddress.current, view);
      instance.dispose();
      editor.current = null;
    };
  }, []);
  useEffect(() => {
    editor.current?.updateOptions({
      renderSideBySide: sideBySide,
    });
    // Monaco reapplies inner options when layout changes; keep both editor labels explicit.
    editor.current?.getOriginalEditor().updateOptions({ ariaLabel: "Original review version" });
    editor.current?.getModifiedEditor().updateOptions({ ariaLabel: "Modified review version" });
  }, [sideBySide]);
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
  useEffect(() => {
    if (!reveal || !editor.current) return;
    const code =
      reveal.side === "original"
        ? editor.current.getOriginalEditor()
        : editor.current.getModifiedEditor();
    code.setSelection(
      new monaco.Range(
        reveal.start,
        1,
        reveal.end,
        code.getModel()?.getLineMaxColumn(reveal.end) ?? 1,
      ),
    );
    code.revealLinesInCenter(reveal.start, reveal.end);
    code.focus();
  }, [reveal]);
  return (
    <>
      <div className="review-diff-actions">
        <label>
          <input
            type="checkbox"
            checked={sideBySide}
            onChange={(event) => setSideBySide(event.target.checked)}
          />{" "}
          Side by side
        </label>
        <button type="button" onClick={() => editor.current?.goToDiff("previous")}>
          Previous change
        </button>
        <button type="button" onClick={() => editor.current?.goToDiff("next")}>
          Next change
        </button>
        <button
          type="button"
          onClick={() => {
            const code = editor.current?.getModifiedEditor();
            code?.focus();
            void code?.getAction("actions.find")?.run();
          }}
        >
          Find
        </button>
      </div>
      <div className="review-diff-editor" style={{ height }} ref={container} />
    </>
  );
}
