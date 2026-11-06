import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/basic-languages/monaco.contribution.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { useEffect, useRef } from "react";
import { monospaceFont } from "./state.js";
import { useCssColors } from "./table-appearance.js";

// Vite emits a local worker: previews never depend on a CDN or language server.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export default function MonacoPreview({ text, path }: { text: string; path: string }) {
  const color = useCssColors();
  const container = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
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
      instance.dispose();
      editor.current = null;
    };
  }, []);
  useEffect(() => {
    const mode = document.documentElement.dataset.theme;
    const dark =
      mode === "dark" || (mode !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    const forced = matchMedia("(forced-colors: active)").matches;
    // Monaco requires hex colors; the shared CSS resolver returns concrete RGB values.
    const hex = (name: string) =>
      `#${(color(name).match(/\d+/g) ?? [])
        .slice(0, 3)
        .map((channel) => Number(channel).toString(16).padStart(2, "0"))
        .join("")}`;
    monaco.editor.defineTheme("code60-preview", {
      base: forced ? (dark ? "hc-black" : "hc-light") : dark ? "vs-dark" : "vs",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": hex("--surface"),
        "editor.foreground": hex("--text"),
        "editorGutter.background": hex("--surface"),
        "editorLineNumber.foreground": hex("--muted"),
        "editorLineNumber.activeForeground": hex("--text"),
        "editor.lineHighlightBackground": hex("--surface"),
        "editor.selectionBackground": hex("--accent-bg"),
        "editor.inactiveSelectionBackground": hex("--accent-bg"),
        "editorWidget.background": hex("--surface"),
        "editorWidget.foreground": hex("--text"),
        "editorWidget.border": hex("--border"),
        "input.background": hex("--field-fill"),
        "input.foreground": hex("--text"),
        "input.border": hex("--border"),
        "scrollbarSlider.background": hex("--scrollbar-thumb"),
        "scrollbarSlider.hoverBackground": hex("--scrollbar-thumb-hover"),
        "scrollbarSlider.activeBackground": hex("--scrollbar-thumb-hover"),
      },
    });
    monaco.editor.setTheme("code60-preview");
  }, [color]);
  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    const name = path.split("/").at(-1) ?? path;
    const extension = name.includes(".") ? `.${name.split(".").at(-1)}` : "";
    const language =
      monaco.languages
        .getLanguages()
        .find(
          (language) =>
            language.filenames?.includes(name) ||
            (!!extension && language.extensions?.includes(extension)),
        )?.id ?? "plaintext";
    const model = monaco.editor.createModel("", language);
    instance.setModel(model);
    return () => {
      instance.setModel(null);
      model.dispose();
    };
  }, [path]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A path change creates a new model that also needs its contents.
  useEffect(() => {
    const instance = editor.current;
    const model = instance?.getModel();
    if (!instance || !model) return;
    const view = instance.saveViewState();
    model.setValue(text);
    if (view) instance.restoreViewState(view);
  }, [text, path]);
  return <div className="file-preview-editor" ref={container} />;
}
