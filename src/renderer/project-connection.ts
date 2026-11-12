import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DatabaseMode, MenuCommand } from "../bridge/index.js";
import type { AppPagesProps } from "./app-page-props.js";
import { pathLabel } from "./path-label.js";
import { ScopeLifetime } from "./scope-lifetime.js";

type ConnectionProps = Pick<
  AppPagesProps,
  "api" | "state" | "busy" | "attempt" | "notify" | "accept" | "setError" | "orchestratorConfigured"
> & {
  enterApp(): void;
};
export function useProjectConnection({
  api,
  state,
  busy,
  attempt,
  notify,
  accept,
  setError,
  orchestratorConfigured,
  enterApp,
}: ConnectionProps) {
  const snapshot = state?.snapshot;
  const database = snapshot?.database ?? null;
  const directory = snapshot?.directory;
  const lifetime = useMemo(() => new ScopeLifetime("connection"), []);
  const observed = useRef(state);
  observed.current = state;
  useLayoutEffect(() => {
    lifetime.activate();
    return () => lifetime.dispose();
  }, [lifetime]);
  const [projectChoice, setProjectChoice] = useState<{
    path: string;
    database: string;
    project: string | null;
    generation: number;
  }>();
  const [picker, setPicker] = useState<"database" | "project">();
  useEffect(() => {
    if (
      projectChoice &&
      (projectChoice.database !== database ||
        projectChoice.project !== (directory ?? null) ||
        projectChoice.generation !== (state?.projectGeneration ?? 0) ||
        !orchestratorConfigured)
    )
      setProjectChoice(undefined);
  }, [projectChoice, database, directory, state?.projectGeneration, orchestratorConfigured]);
  useEffect(
    () =>
      api.onMenu((command: MenuCommand) => {
        setError("");
        setPicker(command === "database" || !database ? "database" : "project");
      }),
    [api.onMenu, database, setError],
  );

  const showPicker = (kind: "database" | "project") => {
    setError("");
    setPicker(kind === "project" && !database ? "database" : kind);
  };
  const connectDatabase = (mode: DatabaseMode) => {
    const mounted = lifetime.capture();
    const generation = state?.databaseGeneration ?? 0;
    const current = () =>
      mounted() && (observed.current?.databaseGeneration ?? 0) <= generation + 1;
    void attempt(async () => {
      if ((await api.connectDatabase(mode)) && current())
        setPicker((current) => (current === "database" ? undefined : current));
    }, current);
  };
  const projectOpened = async (current: () => boolean, path?: string) => {
    const latest = await api.snapshot();
    if (!current() || latest.database !== database || (path && latest.directory !== path)) return;
    const live = observed.current?.snapshot;
    if (
      live &&
      live.revision > latest.revision &&
      (live.database !== latest.database || live.directory !== latest.directory)
    )
      return;
    accept(latest);
    setPicker(undefined);
    setProjectChoice(undefined);
    if (latest.directory) {
      enterApp();
      notify(`Opened ${pathLabel(latest.directory)}.`);
    }
  };
  const projectCurrent = (target?: string) => {
    const current = lifetime.capture();
    const projectGeneration = state?.projectGeneration ?? 0;
    const databaseGeneration = state?.databaseGeneration ?? 0;
    return () => {
      const live = observed.current;
      if (!current() || !live || live.databaseGeneration !== databaseGeneration) return false;
      // One replacement may be this operation's own result, never a later A → B → A.
      return (
        live.projectGeneration === projectGeneration ||
        (live.projectGeneration === projectGeneration + 1 &&
          (!target || live.snapshot.directory === target))
      );
    };
  };
  const confirmProject = (path: string) => {
    const current = projectCurrent(path);
    void attempt(async () => {
      await api.openProject(path);
      if (current()) await projectOpened(current, path);
    }, current);
  };
  const projectActions = {
    onConnect: connectDatabase,
    onOpen: (path: string) => {
      if (busy || !database || !orchestratorConfigured) return;
      setError("");
      setProjectChoice({
        path,
        database,
        project: directory ?? null,
        generation: state?.projectGeneration ?? 0,
      });
    },
    onCreate: () => {
      if (busy) return;
      if (snapshot?.active) {
        setError("Finish or stop all runs before switching projects.");
        return;
      }
      const current = projectCurrent();
      void attempt(async () => {
        if ((await api.chooseFolder()) && current()) await projectOpened(current);
      }, current);
    },
    onRemove: (path: string) => {
      const mounted = lifetime.capture();
      const generation = state?.databaseGeneration;
      void attempt(
        () => api.removeProject(path),
        () => mounted() && observed.current?.databaseGeneration === generation,
      );
    },
  };
  return {
    picker,
    setPicker,
    projectChoice,
    setProjectChoice,
    showPicker,
    connectDatabase,
    confirmProject,
    projectActions,
  };
}
