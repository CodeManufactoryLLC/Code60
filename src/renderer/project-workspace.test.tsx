import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { ApplicationClient, Snapshot } from "../bridge/index.js";
import { useFiles } from "./files.js";
import { ProjectScope, useProjectScope } from "./project-scope.js";
import { useProjectWorkspace } from "./project-workspace.js";
import { sessionPanelId } from "./session-panel.js";
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

const api = {} as ApplicationClient;
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
  scope.panel(sessionPanelId("worker", undefined)).act({ type: "browse" });
  vi.mocked(useProjectScope).mockReturnValue({
    scope,
    retainedScopes: [scope],
    ...scope.snapshot(),
    setSelected: vi.fn(),
    setWorkerSelection: vi.fn(),
    setVisitedWorkers: vi.fn(),
    setChatRequest: vi.fn(),
  } as unknown as ReturnType<typeof useProjectScope>);
});

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
  if (!workspace.project.explorerOpen) workspace.project.setExplorerOpen(true);
  return null;
}

it.each<[PageId, boolean, boolean, boolean, boolean]>([
  ["chat", false, false, true, true],
  ["chat", true, false, false, false],
  ["chat", false, true, false, false],
  ["search", false, false, false, false],
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
    expect(vi.mocked(useFiles).mock.lastCall?.[4]).toBe(
      scope.panel(sessionPanelId("worker", undefined)).files,
    );
    expect(vi.mocked(useTranscripts).mock.calls.at(-2)?.[6]).toBe(scope.transcripts(api));
    expect(scope.snapshot().workerSelection?.id).toBe("worker");
    expect(scope.panel(sessionPanelId("worker", undefined)).snapshot().entries).toHaveLength(1);
  },
);

function ReviewProbe({
  api,
  capture,
  archived = false,
}: {
  api: ApplicationClient;
  archived?: boolean;
  capture(workspace: ReturnType<typeof useProjectWorkspace>): void;
}) {
  capture(
    useProjectWorkspace({
      api,
      state: {
        snapshot: {
          ...snapshot,
          chats: [{ archived, run: { id: "chat-a" } }, { run: { id: "chat-b" } }],
          chat: { ...snapshot.chat, run: { id: "chat-b" } },
          reviews: [
            { id: "review", chatId: "chat-a", title: "Task", revisions: [{ id: "revision" }] },
          ],
        },
        events: {},
        projectGeneration: 1,
      } as unknown as DesktopState,
      tabs: { ...initialTabs, active: "chat" },
      splash: false,
      navigationPending: false,
      setTabs: vi.fn(),
      setError: vi.fn(),
      notify: vi.fn(),
      setBusy: vi.fn(),
      onWorkerSelection: vi.fn(),
    }),
  );
  return null;
}

it("opens a review in its owning chat without changing the selected worker's tabs", () => {
  const api = { orchestrationChatAction: vi.fn(async () => {}) } as unknown as ApplicationClient;
  const destination = scope.panel(sessionPanelId(undefined, "chat-a"));
  const worker = scope.panel(sessionPanelId("worker", undefined));
  const before = worker.snapshot();
  let workspace: ReturnType<typeof useProjectWorkspace> | undefined;
  renderToStaticMarkup(
    <ReviewProbe
      api={api}
      capture={(value) => {
        workspace = value;
      }}
    />,
  );
  workspace?.openReview("review");
  expect(destination.snapshot()).toMatchObject({
    active: 1,
    entries: [{ kind: "revision", reviewId: "review", revisionId: "revision" }],
  });
  expect(worker.snapshot()).toBe(before);
  expect(scope.panel(sessionPanelId(undefined, "chat-b")).snapshot().entries).toEqual([]);
  expect(api.orchestrationChatAction).toHaveBeenCalledWith({ type: "select", id: "chat-a" });
});

it("opens archived-owner evidence in the reachable selected panel without selecting or unarchiving its owner", () => {
  const api = { orchestrationChatAction: vi.fn(async () => {}) } as unknown as ApplicationClient;
  let workspace: ReturnType<typeof useProjectWorkspace> | undefined;
  renderToStaticMarkup(
    <ReviewProbe
      api={api}
      archived
      capture={(value) => {
        workspace = value;
      }}
    />,
  );
  workspace?.openReview("review");
  expect(scope.panel(sessionPanelId(undefined, "chat-b")).snapshot().entries).toMatchObject([
    { kind: "revision", reviewId: "review", revisionId: "revision" },
  ]);
  expect(scope.panel(sessionPanelId(undefined, "chat-a")).snapshot().entries).toEqual([]);
  expect(api.orchestrationChatAction).not.toHaveBeenCalled();
});

it("discards delayed Browse Files when a different worker is selected in the same project", async () => {
  let release!: (value: Snapshot) => void;
  const api = {
    snapshot: vi.fn(
      () =>
        new Promise<Snapshot>((resolve) => {
          release = resolve;
        }),
    ),
  } as unknown as ApplicationClient;
  let workspace: ReturnType<typeof useProjectWorkspace> | undefined;
  renderToStaticMarkup(
    <ReviewProbe
      api={api}
      capture={(value) => {
        workspace = value;
      }}
    />,
  );
  const panel = scope.panel(sessionPanelId("worker", undefined));
  const before = panel.snapshot();
  const browsing = workspace?.browseFiles();
  workspace?.selectWorker(undefined);
  release(snapshot);
  await browsing;
  expect(panel.snapshot()).toBe(before);
});
