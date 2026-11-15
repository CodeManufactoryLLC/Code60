import { useRef, useState } from "react";
import { pageAvailable, pageDefinitions } from "./navigation.js";
import { NavigationHomePage } from "./navigation-home-page.js";

export function HomePage({
  database,
  relayAvailable,
  onOpenRelay,
  onOpenPage,
}: {
  database: string | null;
  relayAvailable: boolean;
  onOpenRelay(): Promise<void>;
  onOpenPage(id: "search" | "projects" | "apps" | "sessions"): void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const openRelay = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      await onOpenRelay();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  const cards = [
    {
      id: "relay",
      label: "Relay",
      icon: "app-steering-wheel" as const,
      available: relayAvailable && !pending,
      reason: pending ? "Opening Relay" : "Relay is unavailable",
      action: () => void openRelay(),
    },
    ...(["search", "projects", "apps", "sessions"] as const).map((id) => {
      const page = pageDefinitions[id];
      return {
        id,
        label: page.label,
        icon: page.icon,
        available: pageAvailable(id, database) && !pending,
        reason: !pageAvailable(id, database)
          ? "Connect to a database first"
          : "Wait for the current action to finish",
        action: () => onOpenPage(id),
      };
    }),
  ];
  return (
    <NavigationHomePage page="home" cards={cards} error={error} onOpen={(card) => card.action()} />
  );
}
