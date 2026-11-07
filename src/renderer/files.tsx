import { hotkeysCoreFeature, syncDataLoaderFeature } from "@headless-tree/core";
import { useTree } from "@headless-tree/react";
import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  DesktopApi,
  FileContext,
  FileDirectory,
  FileEntry,
  Snapshot,
} from "../bridge/index.js";
import { Icon } from "./icons.js";
import type { PreviewViewState } from "./monaco-preview.js";
import { pathLabel } from "./path-label.js";

const MonacoPreview = lazy(() => import("./monaco-preview.js"));
const rootId = "/";
const emptyDirectories: FileDirectory[] = [];
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export function useFiles(
  api: DesktopApi,
  snapshot: Snapshot | undefined,
  active: boolean,
  preview: string | null,
) {
  const project = snapshot?.directory ?? null;
  const workspace = `${snapshot?.database}:${project}`;
  const [selection, setSelection] = useState<{ workspace: string; path: string }>();
  const [expansions, setExpansions] = useState<Record<string, string[]>>({});
  const [error, setError] = useState("");
  const [selectionWorkspace, setSelectionWorkspace] = useState(workspace);
  if (selectionWorkspace !== workspace) {
    setSelectionWorkspace(workspace);
    setSelection(undefined);
    setError("");
  }
  const root = project;
  const selectedFile = selection?.workspace === workspace ? selection.path : null;
  const expansionKey = JSON.stringify([workspace, root]);
  const expanded = expansions[expansionKey] ?? [];
  const context: FileContext | null =
    project && root
      ? {
          project,
          root,
          directories:
            preview !== null
              ? [""]
              : [
                  "",
                  ...expanded.filter((path) => {
                    const parts = path.split("/");
                    return parts
                      .slice(0, -1)
                      .every((_, index) => expanded.includes(parts.slice(0, index + 1).join("/")));
                  }),
                ],
          preview,
        }
      : null;
  const requestJson = JSON.stringify({
    workspace,
    context: active ? context : null,
  });
  const requests = useRef(Promise.resolve());
  useEffect(() => {
    let current = true;
    setError("");
    // Root authorization is asynchronous. Serialize context changes so a slow
    // earlier selection cannot become the backend context after a newer tab.
    requests.current = requests.current.then(async () => {
      if (!current) return;
      try {
        await api.setFileContext(
          (JSON.parse(requestJson) as { context: FileContext | null }).context,
        );
      } catch (cause) {
        if (current) setError(message(cause));
      }
    });
    return () => {
      current = false;
    };
  }, [api, requestJson]);
  const directorySnapshot =
    snapshot?.files?.context.project === project && snapshot.files.context.root === root
      ? snapshot.files
      : null;
  const files =
    active &&
    directorySnapshot &&
    JSON.stringify(directorySnapshot.context) === JSON.stringify(context)
      ? directorySnapshot
      : null;
  const roots = project ? [{ path: project, label: `Project · ${pathLabel(project)}` }] : [];
  const selectFile = (path: string) => setSelection({ workspace, path });
  const setExpanded = (next: string[] | ((previous: string[]) => string[])) => {
    const paths = typeof next === "function" ? next(expanded) : next;
    if (paths.length > 63) {
      setError("Folder limit reached. Collapse a folder before expanding another.");
      return;
    }
    setError("");
    setExpansions((previous) => ({ ...previous, [expansionKey]: paths }));
  };
  return {
    root,
    preview,
    selectedFile,
    expanded,
    setExpanded,
    files,
    directories: directorySnapshot?.directories ?? emptyDirectories,
    roots,
    selectFile,
    error:
      error || snapshot?.polling.sources.find((source) => source.key === "files")?.lastError || "",
    loading:
      snapshot?.polling.sources.find((source) => source.key === "files")?.status === "polling",
    workspace,
  };
}
export type FileBrowser = ReturnType<typeof useFiles>;

export function FilesPage({
  browser,
  onOpenProject,
  active = true,
  hidden,
  onHidden,
  onOpenFile,
}: {
  browser: FileBrowser;
  onOpenProject(): void;
  active?: boolean;
  hidden: boolean;
  onHidden(value: boolean): void;
  onOpenFile(path: string): void;
}) {
  const [settings, setSettings] = useState(false);
  // A project/page switch must never leave an unrelated modal over the next page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: workspace changes dismiss the modal.
  useEffect(() => setSettings(false), [browser.workspace, active]);
  return (
    <section className="files-page" aria-label="File Explorer">
      <header className="files-header">
        <div className="files-title">
          <h2>File Explorer</h2>
          <button
            type="button"
            className="icon-button"
            aria-label="File Explorer settings"
            aria-haspopup="dialog"
            title="File Explorer settings"
            onClick={() => setSettings(true)}
          >
            <Icon name="settings" />
          </button>
        </div>
        {browser.root && (
          <div className="files-controls">
            <label>
              Root
              <select aria-label="File root" value={browser.root} onChange={() => {}}>
                {!browser.roots.some((root) => root.path === browser.root) && (
                  <option value={browser.root}>Unavailable · {browser.root}</option>
                )}
                {browser.roots.map((root) => (
                  <option key={root.path} value={root.path}>
                    {root.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </header>
      {!browser.root && (
        <div className="files-status">
          <button type="button" onClick={onOpenProject}>
            Open project
          </button>
        </div>
      )}
      {browser.error && (
        <p className="error-banner" role="alert">
          {browser.error}
        </p>
      )}
      {browser.root && (
        <FileTree
          key={`${browser.workspace}:${browser.root}`}
          browser={browser}
          hidden={hidden}
          onOpenFile={onOpenFile}
        />
      )}
      {settings && active && (
        <FileSettings hidden={hidden} onHidden={onHidden} onClose={() => setSettings(false)} />
      )}
    </section>
  );
}

function FileSettings({
  hidden,
  onHidden,
  onClose,
}: {
  hidden: boolean;
  onHidden(value: boolean): void;
  onClose(): void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const checkbox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    element?.showModal();
    checkbox.current?.focus();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="setup-dialog picker-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id={id}>File Explorer settings</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close File Explorer settings"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <label className="files-hidden">
        <input
          ref={checkbox}
          type="checkbox"
          checked={hidden}
          onChange={(event) => onHidden(event.target.checked)}
        />
        Show hidden files
      </label>
      <div className="modal-footer">
        <button type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </dialog>
  );
}

function FileTree({
  browser,
  hidden,
  onOpenFile,
}: {
  browser: FileBrowser;
  hidden: boolean;
  onOpenFile(path: string): void;
}) {
  const entries = useMemo(
    () =>
      new Map(
        browser.directories.flatMap((dir) =>
          dir.entries.map((entry) => [entry.path, entry] as const),
        ),
      ),
    [browser.directories],
  );
  const tree = useTree<FileEntry>({
    rootItemId: rootId,
    state: { expandedItems: browser.expanded },
    setExpandedItems: browser.setExpanded,
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().kind === "directory",
    dataLoader: {
      getItem: (id) => entries.get(id) ?? { path: id, name: id, kind: "directory" },
      getChildren: (id) =>
        (browser.directories.find((dir) => dir.path === (id === rootId ? "" : id))?.entries ?? [])
          .filter((entry) => hidden || !entry.name.startsWith("."))
          .map((entry) => entry.path),
    },
    onPrimaryAction: (item) => {
      if (item.getItemData().kind === "file") onOpenFile(item.getId());
    },
    features: [syncDataLoaderFeature, hotkeysCoreFeature],
  });
  // Headless Tree caches its flattened structure; external listings and filters invalidate it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: These inputs change the configured synchronous data loader.
  useEffect(() => {
    tree.rebuildTree();
  }, [tree, browser.directories, hidden]);
  const issues = browser.directories.filter((dir) => dir.error || dir.truncated);
  return (
    <>
      {browser.loading && (
        <p className="files-status" role="status">
          Loading files…
        </p>
      )}
      {issues.map((dir) => (
        <p className="files-status" role="status" key={dir.path}>
          {dir.path || "/"}: {dir.error ?? "Folder listing limit reached."}
        </p>
      ))}
      <div {...tree.getContainerProps("Project files")} className="file-tree">
        {tree.getItems().map((item) => (
          <button
            {...item.getProps()}
            role="treeitem"
            type="button"
            key={item.getId()}
            className="file-tree-item"
            style={{ paddingLeft: 12 + item.getItemMeta().level * 18 }}
            aria-selected={browser.selectedFile === item.getId()}
            aria-disabled={!["directory", "file"].includes(item.getItemData().kind)}
          >
            <Icon
              name={
                item.isFolder()
                  ? item.isExpanded()
                    ? "chevron--down"
                    : "chevron--right"
                  : "document"
              }
            />
            <span>{item.getItemName()}</span>
            {item.getItemData().kind === "symlink" && <span className="muted">Symbolic link</span>}
            {item.getItemData().kind === "other" && <span className="muted">Unsupported file</span>}
          </button>
        ))}
      </div>
      {browser.files && !browser.loading && tree.getItems().length === 0 && issues.length === 0 && (
        <p className="files-status">No files.</p>
      )}
    </>
  );
}

export function FileInspector({
  browser,
  viewState,
}: {
  browser: FileBrowser;
  viewState?: { current: PreviewViewState | null } | undefined;
}) {
  const path = browser.preview;
  if (path === null) return null;
  const preview = browser.files?.preview?.path === path ? browser.files.preview : null;
  return (
    <aside className="file-inspector" aria-label="File preview">
      <div className="file-inspector-context">
        <span>
          {browser.roots.find((root) => root.path === browser.root)?.label ?? browser.root}
        </span>
        <code>{path}</code>
      </div>
      {preview && (
        <details className="file-metadata">
          <summary>File information</summary>
          <dl>
            <dt>Size</dt>
            <dd>{preview.size === null ? "Unknown" : `${preview.size.toLocaleString()} bytes`}</dd>
            <dt>Modified</dt>
            <dd>
              {preview.modifiedAt ? new Date(preview.modifiedAt).toLocaleString() : "Unknown"}
            </dd>
            <dt>Mode</dt>
            <dd>Read-only</dd>
          </dl>
        </details>
      )}
      {browser.error || preview?.error ? (
        <p className="error-banner" role="alert">
          {browser.error || preview?.error}
        </p>
      ) : preview?.text !== null && preview?.text !== undefined ? (
        <Suspense
          fallback={
            <p className="files-status" role="status">
              Loading preview…
            </p>
          }
        >
          <MonacoPreview text={preview.text} path={path} viewState={viewState} />
        </Suspense>
      ) : (
        <p className="files-status" role="status">
          Loading preview…
        </p>
      )}
    </aside>
  );
}
