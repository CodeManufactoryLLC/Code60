import { useRef, useState } from "react";
import type {
  AgentSetupSnapshot,
  ApplicationClient,
  ModelDefaultAction,
  ProviderAction,
  Snapshot,
} from "../bridge/index.js";

export function providerActionReasons(
  setup: AgentSetupSnapshot | undefined,
  provider: string,
  pending = false,
) {
  const blocked = pending
    ? "Wait for the provider change to finish"
    : !setup?.management
      ? "Provider management is unavailable"
      : setup.management.blockedReason;
  const membership = setup?.enabled.includes(provider)
    ? null
    : "Connect and verify this provider first";
  return {
    disconnect:
      provider === setup?.primary
        ? "Set another provider as primary first"
        : (blocked ?? membership),
    primary:
      provider === setup?.primary
        ? "This is already the primary provider"
        : (blocked ?? membership),
  };
}

export function useProviderManagement(api: ApplicationClient, snapshot: Snapshot | undefined) {
  const [mode, setMode] = useState<"primary" | "add" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const setup = snapshot?.agentSetup;
  const addReason = !setup
    ? "Provider setup is unavailable"
    : pending
      ? "Wait for the provider change to finish"
      : setup.session
        ? "Finish or cancel provider setup first"
        : setup.providers.every((provider) => setup.enabled.includes(provider.id))
          ? "All supported providers are connected"
          : null;
  async function run(operation: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The provider change could not be saved. Retry.",
      );
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return {
    mode,
    pending,
    error,
    addReason,
    add: () => {
      if (addReason) return;
      setError("");
      setMode(setup?.complete ? "add" : "primary");
    },
    closeSetup: () => setMode(null),
    act: (request: ProviderAction) => {
      const reasons = providerActionReasons(setup, request.provider, inFlight.current);
      if (request.type === "disconnect" ? reasons.disconnect : reasons.primary) return;
      return run(() => api.providerAction(request));
    },
    clearDefault: (request: ModelDefaultAction) =>
      run(async () => {
        if (!api.modelDefault) throw new Error("Model defaults are unavailable");
        await api.modelDefault(request);
      }),
  };
}
export type ProviderManagement = ReturnType<typeof useProviderManagement>;
