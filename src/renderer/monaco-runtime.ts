import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/basic-languages/monaco.contribution.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { useEffect } from "react";
import { useCssColors } from "./table-appearance.js";

// Vite emits a local worker: previews never depend on a CDN or language server.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export { monaco };
export function useMonacoTheme() {
  const color = useCssColors();
  useEffect(() => {
    const dark = document.documentElement.dataset.colorScheme === "dark";
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
        "editor.background": hex("--chat-neutral"),
        "editor.foreground": hex("--text"),
        "editorGutter.background": hex("--chat-neutral"),
        "editorLineNumber.foreground": hex("--muted"),
        "editorLineNumber.activeForeground": hex("--text"),
        "editor.lineHighlightBackground": hex("--chat-neutral"),
        "editor.selectionBackground": hex("--accent-bg"),
        "editor.inactiveSelectionBackground": hex("--accent-bg"),
        "editorWidget.background": hex("--chat-neutral"),
        "editorWidget.foreground": hex("--text"),
        "editorWidget.border": hex("--border"),
        "input.background": hex("--field-fill"),
        "input.foreground": hex("--text"),
        "input.border": hex("--border"),
        "toolbar.hoverBackground": "#00000000",
        "toolbar.hoverOutline": "#00000000",
        "toolbar.activeBackground": "#00000000",
        "inputOption.hoverBackground": "#00000000",
        "inputOption.activeBackground": "#00000000",
        "inputOption.activeBorder": "#00000000",
        "inputOption.activeForeground": hex("--accent"),
        "scrollbarSlider.background": hex("--scrollbar-thumb"),
        "scrollbarSlider.hoverBackground": hex("--scrollbar-thumb-hover"),
        "scrollbarSlider.activeBackground": hex("--scrollbar-thumb-hover"),
      },
    });
    monaco.editor.setTheme("code60-preview");
  }, [color]);
}
export function fileLanguage(path: string): string {
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
  return language;
}
