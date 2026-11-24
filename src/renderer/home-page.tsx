import { useRef, useState } from "react";
import { pageAvailable, pageDefinitions } from "./navigation.js";
import { NavigationHomePage } from "./navigation-home-page.js";

export function HomePage({
  page = "home",
  database,
  relayAvailable,
  onOpenRelay,
  onOpenPage,
}: {
  page?: "home" | "assistants";
  database: string | null;
  relayAvailable: boolean;
  onOpenRelay(): Promise<void>;
  onOpenPage(id: "custom-agents" | "search" | "projects" | "apps" | "sessions"): void;
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
      task: "Direct work across projects",
      icon: "app-steering-wheel" as const,
      available: relayAvailable && !pending,
      reason: pending ? "Opening Relay" : "Relay is unavailable",
      action: () => void openRelay(),
    },
    ...(page === "assistants"
      ? (["custom-agents"] as const)
      : (["custom-agents", "search", "projects", "apps", "sessions"] as const)
    ).map((id) => {
      const page = pageDefinitions[id];
      return {
        id,
        label: page.label,
        task: {
          "custom-agents": "Configure an assistant or open its conversation",
          search: "Find messages, plans and files",
          projects: "Open a repository or resume a conversation",
          apps: "Browse automation and management tools",
          sessions: "Inspect a worker run",
        }[id],
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
    <NavigationHomePage page={page} cards={cards} error={error} onOpen={(card) => card.action()} />
  );
}
