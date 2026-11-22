import type { DesktopApi, ModelDefaultAction, Snapshot } from "../bridge/index.js";
import { AgentLogo } from "./agent-logo.js";
import { NavigationCards } from "./navigation-cards.js";
import { PrimaryProviderMark } from "./neobrutalism/provider-controls.js";
import { PageTitle } from "./page-title.js";
import type { ProviderManagement } from "./provider-management.js";
import { providerActionReasons } from "./provider-management.js";
import { ProviderMenu } from "./provider-menu.js";
import { SettingsCard } from "./settings-layout.js";

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
  const reasons = provider
    ? providerActionReasons(setup, provider.id, management.pending)
    : undefined;
  const defaults =
    provider && snapshot?.modelDefaults?.providers[provider.id as ModelDefaultAction["provider"]];
  return (
    <main
      className={`home-page providers-page${provider ? " provider-details" : ""}`}
      aria-label={provider?.name ?? "Providers"}
    >
      <div className="table-controls">
        <PageTitle
          page={provider ? "provider" : "providers"}
          target={provider ? { kind: "provider", id: provider.id } : undefined}
          className="table-title"
          actions={
            provider
              ? [
                  {
                    id: "disconnect",
                    label: "Disconnect",
                    disabled: Boolean(reasons?.disconnect),
                    reason: reasons?.disconnect ?? undefined,
                    run: () => void management.act({ type: "disconnect", provider: provider.id }),
                  },
                  {
                    id: "primary",
                    label: "Set as Primary",
                    disabled: Boolean(reasons?.primary),
                    reason: reasons?.primary ?? undefined,
                    run: () => void management.act({ type: "set-primary", provider: provider.id }),
                  },
                ]
              : []
          }
        >
          {provider?.name ?? "Providers"}
        </PageTitle>
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
        </NavigationCards>
      )}
    </main>
  );
}
