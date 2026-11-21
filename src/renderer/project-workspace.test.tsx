import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { DesktopApi, Snapshot } from "../bridge/index.js";
import { updateFileTabs } from "./file-tabs.js";
import { useFiles } from "./files.js";
import { ProjectScope, useProjectScope } from "./project-scope.js";
import { useProjectWorkspace } from "./project-workspace.js";
import type { DesktopState } from "./snapshot-state.js";
import { initialTabs, type PageId } from "./tabs.js";
import { useTranscripts } from "./transcripts.js";

vi.mock("./project-scope.js", async (original) => ({
  ...(await original<typeof import("./project-scope.js")>()),
  useProjectScope: vi.fn(),
}));
vi.mock("./files.js", () => ({ useFiles: vi.fn(() => ({})) }));
vi.mock("./transcripts.js", async (original) => ({
  ...(await original<typeof import("./transcripts.js")>()),
  useTranscripts: vi.fn(() => ({ events: {}, errors: {}, pending: 0 })),
}));

const api = {} as DesktopApi;
const snapshot = {
  database: "/db",
  directory: "/project",
  databaseEpoch: 1,
  projectInstanceId: "project",
  openProjects: [{ id: "project", path: "/project", workerIds: ["worker"] }],
  chat: { kind: "project", projectId: "project", plans: [] },
  runs: [{ record: { id: "worker", status: "finished" } }],
  liveIds: [],
} as unknown as Snapshot;
let scope: ProjectScope;
beforeEach(() => {
  vi.clearAllMocks();
  scope = new ProjectScope("/db", "/project", "instance");
  scope.set("workerSelection", { workspace: scope.workspace, id: "worker" });
  scope.set("fileTabs", (tabs) => updateFileTabs(tabs, { type: "browse" }));
  vi.mocked(useProjectScope).mockReturnValue({
    scope,
    retainedScopes: [scope],
    ...scope.snapshot(),
    setSelected: vi.fn(),
    setWorkerSelection: vi.fn(),
    setVisitedWorkers: vi.fn(),
    setChatRequest: vi.fn(),
    setFileTabs: vi.fn(),
  } as unknown as ReturnType<typeof useProjectScope>);
});

let renderedWorkspace: ReturnType<typeof useProjectWorkspace>;
function Probe({ active, pending, splash }: { active: PageId; pending: boolean; splash: boolean }) {
  const workspace = useProjectWorkspace({
    api,
    state: { snapshot, events: {}, projectGeneration: 1 } as DesktopState,
    tabs: { ...initialTabs, active },
    splash,
    navigationPending: pending,
    setTabs: vi.fn(),
    setError: vi.fn(),
    notify: vi.fn(),
    setBusy: vi.fn(),
    onWorkerSelection: vi.fn(),
  });
  renderedWorkspace = workspace;
  if (!workspace.project.explorerOpen) workspace.project.setExplorerOpen(true);
  return null;
}

it.each<[PageId, boolean, boolean, boolean, boolean]>([
  ["chat", false, false, true, true],
  ["chat", true, false, false, false],
  ["chat", false, true, false, false],
  ["search", false, false, true, false],
  ...(
    [
      "home",
      "projects",
      "project",
      "apps",
      "tables",
      "settings",
      "advanced",
      "experiments",
    ] as const
  ).map((id): [PageId, boolean, boolean, boolean, boolean] => [id, false, false, false, false]),
])(
  "gates retained workspace reads for %s, pending %s, splash %s",
  (active, pending, splash, transcriptsActive, filesActive) => {
    renderToStaticMarkup(<Probe active={active} pending={pending} splash={splash} />);
    expect(vi.mocked(useFiles).mock.lastCall?.[2]).toBe(filesActive);
    expect(
      vi
        .mocked(useTranscripts)
        .mock.calls.slice(-2)
        .map((args) => args[2]),
    ).toEqual([transcriptsActive, transcriptsActive]);
    expect(vi.mocked(useFiles).mock.lastCall?.[5]).toBe(scope.files());
    expect(vi.mocked(useTranscripts).mock.calls.at(-2)?.[6]).toBe(scope.transcripts(api));
    expect(scope.snapshot().workerSelection?.id).toBe("worker");
    expect(scope.snapshot().fileTabs.entries).toHaveLength(1);
  },
);

it("forwards retry reads through the combined transcript view", async () => {
  const read = vi.fn().mockResolvedValue({});
  vi.mocked(useTranscripts).mockReturnValue({
    events: {},
    errors: {},
    pending: 0,
    read,
    retry: vi.fn(),
  });
  renderToStaticMarkup(<Probe active="search" pending={false} splash={false} />);
  await renderedWorkspace.transcripts.read(true);
  expect(read.mock.calls).toEqual([[true], [true]]);
});
