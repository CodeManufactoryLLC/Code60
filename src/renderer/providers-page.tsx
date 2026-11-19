import { useEffect, useId, useState } from "react";
import type { DesktopApi, ModelDefaultAction, Snapshot } from "../bridge/index.js";
import { AgentLogo } from "./agent-logo.js";
import { NavigationCards } from "./navigation-cards.js";
import { PrimaryProviderMark } from "./neobrutalism/provider-controls.js";
import { PageTitle } from "./page-title.js";
import type { ProviderManagement } from "./provider-management.js";
import { ProviderMenu } from "./provider-menu.js";
import { SettingsCard } from "./settings-layout.js";

function OrchestrationPermissions({ api, enabled }: { api: DesktopApi; enabled: boolean }) {
  const id = useId();
  const [autoApproval, setAutoApproval] = useState(enabled);
  useEffect(() => setAutoApproval(enabled), [enabled]);
  const [savingApproval, setSavingApproval] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  return (
    <SettingsCard title="Permissions">
      <label className="settings-row">
        Code60 auto-approval
        <input
          type="checkbox"
          role="switch"
          checked={autoApproval}
          aria-checked={autoApproval}
          disabled={savingApproval}
          aria-describedby={`${id}-approval-help`}
          onChange={async (event) => {
            const next = event.currentTarget.checked;
            setAutoApproval(next);
            setSavingApproval(true);
            setApprovalError("");
            try {
              await api.setOrchestrationAutoApproval(next);
            } catch {
              setAutoApproval(enabled);
              setApprovalError("Could not save Code60 auto-approval. Try again.");
            } finally {
              setSavingApproval(false);
            }
          }}
        />
      </label>
      <p className="field-hint" id={`${id}-approval-help`}>
        Turn off to review each new permission request in the chat or worker that requested it.
      </p>
      {approvalError && <p role="alert">{approvalError}</p>}
    </SettingsCard>
  );
}

export function ProvidersPage({
  api,
  snapshot,
  management,
  providerId,
  onOpen,
  active = true,
}: {
  api: DesktopApi;
  snapshot: Snapshot | undefined;
  management: ProviderManagement;
  providerId?: string | undefined;
  onOpen(id: string): void;
  active?: boolean;
}) {
  const setup = snapshot?.agentSetup;
  const providers = (setup?.enabled ?? []).flatMap((id) => {
    const provider = setup?.providers.find((provider) => provider.id === id);
    return provider ? [{ ...provider, label: provider.name, available: true }] : [];
  });
  const provider = providers.find(({ id }) => id === providerId);
  const menu = (item: (typeof providers)[number]) => (
    <ProviderMenu
      provider={item.id}
      name={item.name}
      setup={setup}
      management={management}
      active={active}
    />
  );
  const defaults =
    provider && snapshot?.modelDefaults?.providers[provider.id as ModelDefaultAction["provider"]];
  return (
    <main
      className={`home-page providers-page${provider ? " provider-details" : ""}`}
      aria-label={provider?.name ?? "Providers"}
    >
      <div className="table-controls">
        <PageTitle page={provider ? "provider" : "providers"} className="table-title">
          {provider?.name ?? "Providers"}
        </PageTitle>
        {provider && menu(provider)}
      </div>
      {provider ? (
        <div className="provider-detail-content">
          <div className="provider-identity">
            <AgentLogo id={provider.logo} size={72} />
            <span>Verified provider</span>
            {provider.id === setup?.primary && <PrimaryProviderMark />}
          </div>
          <SettingsCard title="Default models">
            {(["orchestrator", "worker"] as const).map((role) => {
              const values = defaults?.[role];
              return values?.length ? (
                <div className="settings-row" key={role}>
                  <span>
                    {role === "orchestrator" ? "Orchestrator" : "Worker"}
                    <small>{values.map((value) => value.name).join(" · ")}</small>
                  </span>
                  <button
                    type="button"
                    disabled={management.pending || !api.modelDefault}
                    aria-label={`Clear ${provider.id} ${role} model default`}
                    onClick={() =>
                      void management.clearDefault({
                        type: "clear",
                        provider: provider.id as ModelDefaultAction["provider"],
                        role,
                      })
                    }
                  >
                    Clear
                  </button>
                </div>
              ) : null;
            })}
            {!defaults?.orchestrator?.length && !defaults?.worker?.length && (
              <p className="settings-empty">No saved model defaults.</p>
            )}
          </SettingsCard>
          {management.error && <p role="alert">{management.error}</p>}
        </div>
      ) : (
        <NavigationCards
          cards={providers}
          pending={management.pending}
          create={{
            label: "Add Provider",
            title: management.addReason ?? undefined,
            disabled: Boolean(management.addReason),
            onClick: management.add,
          }}
          onOpen={(provider) => onOpen(provider.id)}
          renderArtwork={(provider) => <AgentLogo id={provider.logo} size={72} />}
          renderActions={menu}
          renderStatus={(provider) =>
            provider.id === setup?.primary ? <PrimaryProviderMark /> : null
          }
        >
          {management.error && <p role="alert">{management.error}</p>}
          {snapshot && (
            <OrchestrationPermissions api={api} enabled={snapshot.orchestration.allowAll} />
          )}
        </NavigationCards>
      )}
    </main>
  );
}
