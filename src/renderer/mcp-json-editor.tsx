import { jsonDefaults } from "monaco-editor/languages/features/json/register.js";
import { randomId } from "./browser-platform.js";
import "monaco-editor/editor/contrib/suggest/browser/suggestController.js";
import "monaco-editor/editor/contrib/snippet/browser/snippetController2.js";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard.js";
import "monaco-editor/editor/browser/coreCommands.js";
import { useEffect, useRef } from "react";
import { MCP_COMPLETION_SCHEMA, type McpTextIssue } from "../bridge/index.js";
import { monaco, useMonacoTheme } from "./monaco-runtime.js";
import { monospaceFont } from "./typography.js";

jsonDefaults.setDiagnosticsOptions({
  validate: false,
  enableSchemaRequest: false,
  schemas: [
    {
      uri: "code60://schemas/mcp-v1",
      fileMatch: ["inmemory://code60-mcp/*"],
      schema: MCP_COMPLETION_SCHEMA,
    },
  ],
});
jsonDefaults.setModeConfiguration({
  completionItems: true,
  documentFormattingEdits: false,
  documentRangeFormattingEdits: false,
  hovers: false,
  tokens: true,
  diagnostics: false,
  foldingRanges: true,
});
export interface McpEditorView {
  current: monaco.editor.ICodeEditorViewState | null;
}
export default function McpJsonEditor({
  text,
  issues,
  reveal,
  active,
  editable,
  canSave,
  view,
  onChange,
  onSave,
}: {
  text: string;
  issues: readonly McpTextIssue[];
  reveal?: { issue: McpTextIssue; key: string } | undefined;
  active: boolean;
  editable: boolean;
  canSave: boolean;
  view: McpEditorView;
  onChange(text: string): void;
  onSave(): void;
}) {
  useMonacoTheme();
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const current = useRef({ text, issues, onChange, onSave, canSave, editable });
  current.current = { text, issues, onChange, onSave, canSave, editable };
  useEffect(() => {
    if (!active || !root.current) return;
    const instance = monaco.editor.create(root.current, {
      model: null,
      automaticLayout: true,
      ariaLabel: "MCP configuration JSON",
      minimap: { enabled: false },
      fontFamily: monospaceFont,
      fontSize: 13,
      scrollBeyondLastLine: false,
      links: false,
      contextmenu: false,
      readOnly: !current.current.editable,
      stickyScroll: { enabled: false },
      editContext: false,
    });
    const model = monaco.editor.createModel(
      current.current.text,
      "json",
      monaco.Uri.parse(`inmemory://code60-mcp/${randomId()}.json`),
    );
    instance.setModel(model);
    editor.current = instance;
    if (view.current) instance.restoreViewState(view.current);
    const changed = model.onDidChangeContent(() => current.current.onChange(model.getValue()));
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (current.current.canSave) current.current.onSave();
    });

    return () => {
      view.current = instance.saveViewState();
      changed.dispose();
      editor.current = null;
      instance.dispose();
      model.dispose();
    };
  }, [active, view]);
  useEffect(() => {
    if (!active) return;
    const instance = editor.current;
    const model = instance?.getModel();
    if (!instance || !model) return;
    if (model.getValue() !== text) {
      const saved = instance.saveViewState();
      model.setValue(text);
      if (saved) instance.restoreViewState(saved);
    }
    instance.updateOptions({ readOnly: !editable });
    monaco.editor.setModelMarkers(
      model,
      "code60-mcp",
      issues.map((i) => ({
        severity: monaco.MarkerSeverity.Error,
        message: i.message,
        code: i.code,
        startLineNumber: i.line,
        startColumn: i.column,
        endLineNumber: i.endLine,
        endColumn: i.endColumn,
      })),
    );
  }, [text, issues, editable, active]);
  useEffect(() => {
    if (!active || !reveal || !editor.current) return;
    const position = { lineNumber: reveal.issue.line, column: reveal.issue.column };
    editor.current.setPosition(position);
    editor.current.revealPositionInCenter(position);
    editor.current.focus();
  }, [active, reveal]);

  return <div ref={root} className="mcp-json-editor" />;
}
