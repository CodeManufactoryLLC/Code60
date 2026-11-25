import type { ApplicationClient, ModelDefaultAction, Snapshot } from "../bridge/index.js";
import { AgentLogo } from "./agent-logo.js";
import { Button } from "./carbon/button.js";
import { Icon } from "./icons.js";
import { PageTitle } from "./page-title.js";
import type { ProviderManagement } from "./provider-management.js";
import { ProviderMenu } from "./provider-menu.js";

export function ProvidersPage({
  api,
  snapshot,
  management,
  active = true,
}: {
  api: ApplicationClient;
  snapshot: Snapshot | undefined;
  management: ProviderManagement;
  active?: boolean;
}) {
  const setup = snapshot?.agentSetup;
  return (
    <main className="home-page providers-page" aria-label="Providers">
      <div className="table-controls">
        <PageTitle page="providers" className="table-title" />
      </div>
      <div className="home-content">
        <div className="navigation-create">
          <Button
            variant="primary"
            disabled={Boolean(management.addReason)}
            title={management.addReason ?? undefined}
            onClick={management.add}
          >
            Add Provider <Icon name="add" />
          </Button>
        </div>
        {management.error && <p role="alert">{management.error}</p>}
        <ul className="navigation-list" aria-label="Connected providers">
          {setup?.enabled.map((id) => {
            const provider = setup.providers.find((item) => item.id === id);
            if (!provider) return null;
            const providerId = id as ModelDefaultAction["provider"];
            const defaults = snapshot?.modelDefaults?.providers[providerId];
            return (
              <li key={id} className="provider-row">
                <div className="provider-row-header">
                  <AgentLogo id={provider.logo} />
                  <h2>
                    {provider.name}
                    {id === setup.primary && " (Primary)"}
                  </h2>
                  <ProviderMenu
                    provider={id}
                    name={provider.name}
                    setup={setup}
                    management={management}
                    active={active}
                  />
                </div>
                {(["orchestrator", "worker"] as const).map((role) => {
                  const values = defaults?.[role];
                  if (!values?.length) return null;
                  return (
                    <div className="settings-row" key={role}>
                      <span>
                        {role === "orchestrator" ? "Orchestrator" : "Worker"} model default
                        <small>{values.map((value) => value.name).join(" · ")}</small>
                      </span>
                      <Button
                        disabled={management.pending || !api.modelDefault}
                        aria-label={`Clear ${id} ${role} model default`}
                        onClick={() =>
                          void management.clearDefault({
                            type: "clear",
                            provider: providerId,
                            role,
                          })
                        }
                      >
                        Clear
                      </Button>
                    </div>
                  );
                })}
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
