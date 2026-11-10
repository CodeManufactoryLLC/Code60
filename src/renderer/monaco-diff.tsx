import { useEffect, useRef, useState } from "react";
import { fileLanguage, monaco, useMonacoTheme } from "./monaco-runtime.js";
import { monospaceFont } from "./state.js";

const views = new Map<string, monaco.editor.IDiffEditorViewState>();
export default function MonacoDiff({
  original,
  modified,
  path,
  address,
}: {
  original: string;
  modified: string;
  path: string;
  address: string;
}) {
  useMonacoTheme();
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const currentAddress = useRef(address);
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
    instance.getOriginalEditor().updateOptions({ ariaLabel: "Original review version" });
    instance.getModifiedEditor().updateOptions({ ariaLabel: "Modified review version" });
    const size = instance
      .getModifiedEditor()
      .onDidContentSizeChange((event) =>
        setHeight(Math.max(160, Math.min(480, event.contentHeight + 20))),
      );
    return () => {
      size.dispose();
      const view = instance.saveViewState();
      if (view) views.set(currentAddress.current, view);
      instance.dispose();
      editor.current = null;
    };
  }, []);
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
  return <div className="review-diff-editor" style={{ height }} ref={container} />;
}
