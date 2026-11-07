import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DesktopApi, FileSnapshot, Snapshot } from "../bridge/index.js";
import { type FileBrowser, useFiles } from "./files.js";

const context = { project: "/project", root: "/project", directories: [""], preview: "a.ts" };
const files: FileSnapshot = {
  context,
  directories: [],
  preview: { path: "a.ts", text: "old file", size: 8, modifiedAt: null, error: null },
};
function Probe({
  snapshot,
  preview,
  active,
  capture,
}: {
  snapshot: Snapshot;
  preview: string | null;
  active: boolean;
  capture(browser: FileBrowser): void;
}) {
  capture(useFiles({} as DesktopApi, snapshot, active, preview));
  return null;
}
function read(current: FileSnapshot, preview: string | null, active = true, project = "/project") {
  let browser: FileBrowser | undefined;
  const snapshot = {
    database: "/db",
    directory: project,
    files: current,
    polling: { sources: [] },
  } as unknown as Snapshot;
  renderToStaticMarkup(
    <Probe
      snapshot={snapshot}
      active={active}
      preview={preview}
      capture={(value) => {
        browser = value;
      }}
    />,
  );
  return browser;
}

describe("active file snapshots", () => {
  it("never presents an old tab's content while the next file is loading", () => {
    expect(read(files, "a.ts")?.files?.preview?.text).toBe("old file");
    expect(read(files, "b.ts")?.files).toBeNull();
    expect(read(files, null)?.files).toBeNull();
  });
  it("rejects late results from another project or an inactive panel", () => {
    expect(read(files, "a.ts", true, "/other-project")?.files).toBeNull();
    expect(read(files, "a.ts", false)?.files).toBeNull();
  });
  it("rejects results for a previous set of expanded directories", () => {
    expect(
      read({ ...files, context: { ...context, directories: ["", "src"] } }, "a.ts")?.files,
    ).toBeNull();
    const explorer = { ...files, context: { ...context, preview: null }, preview: null };
    expect(read(explorer, null)?.files).toBe(explorer);
  });
});
