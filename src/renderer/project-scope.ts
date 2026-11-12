import type { Rectangle } from "@glideapps/glide-data-grid";
import { useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import type { RunConfiguration } from "../bridge/index.js";
import type { OpenChat } from "./chats.js";
import { emptyFileTabs, type FileTabs } from "./file-tabs.js";
import { ScopeLifetime } from "./scope-lifetime.js";

interface ProjectUi {
  selected: string | undefined;
  setup: boolean;
  configurationEditor: RunConfiguration | "new" | undefined;
  selectedConfiguration: string | undefined;
  configurationMenu: { id: string; bounds: Rectangle } | undefined;
  worktreeMenu: { id: string; bounds: Rectangle; workspace: string } | undefined;
  pollMenu: { id: string; bounds: Rectangle } | undefined;
  confirmation: { launchId: string; count: number } | undefined;
  menu: { id: string; bounds: Rectangle; contextual?: boolean | undefined } | undefined;
  gitSetupProject: string | undefined;
  workerSelection: { workspace: string; id: string } | undefined;
  visitedWorkers: { workspace: string; ids: string[] };
  chatRequest: OpenChat | undefined;
  fileTabs: FileTabs;
}
type Change<T> = T | ((previous: T) => T);

/** Disposal is explicit. Visibility/navigation is deliberately not part of this owner. */
export class ProjectScope extends ScopeLifetime {
  private state: ProjectUi;
  private listeners = new Set<() => void>();
  readonly openedPlans = new Map<string, number>();
  readonly ensuredChangesReview = new Map<string, string>();
  constructor(
    readonly database: string | null,
    readonly project: string | null | undefined,
    private epoch = 0,
  ) {
    super(JSON.stringify([database, project ?? null]));
    const workspace = this.workspace;
    this.state = {
      selected: undefined,
      setup: false,
      configurationEditor: undefined,
      selectedConfiguration: undefined,
      configurationMenu: undefined,
      worktreeMenu: undefined,
      pollMenu: undefined,
      confirmation: undefined,
      menu: undefined,
      gitSetupProject: undefined,
      workerSelection: undefined,
      visitedWorkers: { workspace, ids: [] },
      chatRequest: undefined,
      fileTabs: emptyFileTabs(workspace),
    };
  }
  get workspace() {
    return `${this.database}:${this.project}`;
  }
  get viewKey() {
    return JSON.stringify([this.identity, this.epoch]);
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  set<K extends keyof ProjectUi>(key: K, change: Change<ProjectUi[K]>) {
    if (!this.capture()()) return;
    const value =
      typeof change === "function"
        ? (change as (previous: ProjectUi[K]) => ProjectUi[K])(this.state[key])
        : change;
    if (Object.is(value, this.state[key])) return;
    this.state = { ...this.state, [key]: value };
    for (const listener of this.listeners) listener();
  }
}

export function useProjectScope(
  database: string | null,
  project: string | null | undefined,
  epoch = 0,
) {
  const scope = useMemo(
    () => new ProjectScope(database, project, epoch),
    [database, project, epoch],
  );
  useLayoutEffect(() => {
    scope.activate();
    return () => scope.dispose();
  }, [scope]);
  const state = useSyncExternalStore(scope.subscribe, scope.snapshot);
  const setters = useMemo(
    () => ({
      setSelected: (change: Change<ProjectUi["selected"]>) => scope.set("selected", change),
      setSetup: (change: Change<ProjectUi["setup"]>) => scope.set("setup", change),
      setConfigurationEditor: (change: Change<ProjectUi["configurationEditor"]>) =>
        scope.set("configurationEditor", change),
      setSelectedConfiguration: (change: Change<ProjectUi["selectedConfiguration"]>) =>
        scope.set("selectedConfiguration", change),
      setConfigurationMenu: (change: Change<ProjectUi["configurationMenu"]>) =>
        scope.set("configurationMenu", change),
      setWorktreeMenu: (change: Change<ProjectUi["worktreeMenu"]>) =>
        scope.set("worktreeMenu", change),
      setPollMenu: (change: Change<ProjectUi["pollMenu"]>) => scope.set("pollMenu", change),
      setConfirmation: (change: Change<ProjectUi["confirmation"]>) =>
        scope.set("confirmation", change),
      setMenu: (change: Change<ProjectUi["menu"]>) => scope.set("menu", change),
      setGitSetupProject: (change: Change<ProjectUi["gitSetupProject"]>) =>
        scope.set("gitSetupProject", change),
      setWorkerSelection: (change: Change<ProjectUi["workerSelection"]>) =>
        scope.set("workerSelection", change),
      setVisitedWorkers: (change: Change<ProjectUi["visitedWorkers"]>) =>
        scope.set("visitedWorkers", change),
      setChatRequest: (change: Change<ProjectUi["chatRequest"]>) =>
        scope.set("chatRequest", change),
      setFileTabs: (change: Change<ProjectUi["fileTabs"]>) => scope.set("fileTabs", change),
    }),
    [scope],
  );
  return { scope, ...state, ...setters };
}
