import type { AppPagesProps } from "./app-page-props.js";
import { Modal } from "./modal.js";
import { ProjectConfirmation } from "./project-confirmation.js";
import type { useProjectConnection } from "./project-connection.js";
import { LaunchConfirmation, NewRun, NewSession } from "./run-dialogs.js";
import type { useUpdateNotice } from "./updates.js";
import { DatabaseDialog, ProjectDialog } from "./workspace-dialogs.js";

type DialogProps = Pick<
  AppPagesProps,
  | "api"
  | "state"
  | "project"
  | "busy"
  | "error"
  | "setError"
  | "attempt"
  | "notify"
  | "updates"
  | "orchestratorConfigured"
> & {
  connection: ReturnType<typeof useProjectConnection>;
  updateNotice: ReturnType<typeof useUpdateNotice>;
  openUpdates(): void;
};
export function AppDialogs({
  api,
  state,
  project,
  busy,
  error,
  setError,
  attempt,
  notify,
  updates,
  orchestratorConfigured,
  connection,
  updateNotice,
  openUpdates,
}: DialogProps) {
  const snapshot = state?.snapshot;
  const database = snapshot?.database ?? null;
  const directory = snapshot?.directory;
  const {
    setup,
    setSetup,
    configurationEditor,
    setConfigurationEditor,
    confirmation,
    setConfirmation,
    setSelected,
  } = project;
  const {
    picker,
    setPicker,
    projectChoice,
    setProjectChoice,
    projectActions,
    connectDatabase,
    confirmProject,
  } = connection;
  return (
    <>
      {picker === "database" && (
        <DatabaseDialog
          database={database}
          busy={busy}
          error={error}
          onClose={() => setPicker(undefined)}
          onChoose={connectDatabase}
        />
      )}
      {updateNotice.notice && (
        <Modal title="Update available" busy={false} onClose={updateNotice.dismiss}>
          <p>Code60 {updateNotice.notice} is available.</p>
          <p>Download now, or keep working and download later from the footer or Settings.</p>
          <div className="button-group">
            <button type="button" onClick={updateNotice.dismiss}>
              Later
            </button>
            <button
              type="button"
              onClick={() => {
                updateNotice.dismiss();
                openUpdates();
                void updates.act("download");
              }}
            >
              Download now
            </button>
          </div>
        </Modal>
      )}
      {picker === "project" && snapshot && (
        <ProjectDialog
          {...projectActions}
          projects={snapshot.projects}
          database={database}
          busy={busy}
          error={error}
          onClose={() => setPicker(undefined)}
        />
      )}
      {projectChoice &&
        projectChoice.database === database &&
        projectChoice.project === (directory ?? null) &&
        projectChoice.generation === (state?.projectGeneration ?? 0) &&
        orchestratorConfigured && (
          <ProjectConfirmation
            path={projectChoice.path}
            busy={busy}
            blocked={Boolean(snapshot?.active)}
            error={error}
            onCancel={() => {
              setProjectChoice(undefined);
              setError("");
            }}
            onConfirm={() => {
              if (snapshot?.active) return;
              confirmProject(projectChoice.path);
            }}
          />
        )}
      {setup && snapshot && (
        <NewSession
          snapshot={snapshot}
          busy={busy}
          error={error}
          onClose={() => setSetup(false)}
          onStart={async (request) => {
            await attempt(async () => {
              const ids = await api.start(request);
              const first = ids[0];
              if (!first) return;
              setSelected(first);
              setSetup(false);
              setConfirmation({ launchId: first, count: ids.length });
            });
          }}
        />
      )}
      {configurationEditor && snapshot && (
        <NewRun
          snapshot={snapshot}
          busy={busy}
          error={error}
          configurationName={configurationEditor === "new" ? "" : configurationEditor.name}
          initial={configurationEditor === "new" ? undefined : configurationEditor.settings}
          onClose={() => setConfigurationEditor(undefined)}
          onStart={async (request, name) => {
            const { prompt: _prompt, configurationId: _id, ...settings } = request;
            if (
              await attempt(() =>
                api.saveConfiguration({
                  name: name ?? "",
                  settings,
                  ...(configurationEditor === "new" ? {} : { id: configurationEditor.id }),
                }),
              )
            ) {
              setConfigurationEditor(undefined);
              notify("Run configuration saved.");
            }
          }}
        />
      )}
      {confirmation && (
        <LaunchConfirmation
          count={confirmation.count}
          busy={busy}
          error={error}
          onClose={() => {
            setConfirmation(undefined);
            setError("");
          }}
          onSave={async (name) => {
            const saved = await attempt(() =>
              api.saveConfiguration({ name, launchId: confirmation.launchId }),
            );
            if (saved) notify("Run configuration saved.");
            return saved;
          }}
        />
      )}
    </>
  );
}
