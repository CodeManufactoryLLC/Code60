import { useEffect, useRef } from "react";
import { fileLanguage, monaco, useMonacoTheme } from "./monaco-runtime.js";
import { monospaceFont } from "./typography.js";

export type PreviewViewState = monaco.editor.ICodeEditorViewState;

export default function MonacoPreview({
  text,
  path,
  viewState,
}: {
  text: string;
  path: string;
  viewState?: { current: PreviewViewState | null } | undefined;
}) {
  useMonacoTheme();
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const retainedView = useRef(viewState);
  useEffect(() => {
    if (!container.current) return;
    const instance = monaco.editor.create(container.current, {
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      fontFamily: monospaceFont,
      wordWrap: "on",
      contextmenu: false,
      links: false,
      stickyScroll: { enabled: false },
      ariaLabel: "Read-only file content",
    });
    editor.current = instance;
    return () => {
      if (retainedView.current) retainedView.current.current = instance.saveViewState();
      instance.dispose();
      editor.current = null;
    };
  }, []);
  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    const language = fileLanguage(path);
    const model = monaco.editor.createModel("", language);
    instance.setModel(model);
    return () => {
      if (editor.current === instance) instance.setModel(null);
      model.dispose();
    };
  }, [path]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A path change creates a new model that also needs its contents.
  useEffect(() => {
    const instance = editor.current;
    const model = instance?.getModel();
    if (!instance || !model) return;
    const view = retainedView.current?.current ?? instance.saveViewState();
    if (retainedView.current) retainedView.current.current = null;
    model.setValue(text);
    if (view) instance.restoreViewState(view);
  }, [text, path]);
  return <div className="file-preview-editor" ref={container} />;
}
